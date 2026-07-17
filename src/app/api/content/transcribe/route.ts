import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { transcribeBytes, transcriberConfigured } from "@/lib/transcribe";
import { putToR2, storeThumb, r2Configured } from "@/lib/content-storage";
import { CONTENT_CREATORS } from "@/lib/instagram-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Count real words: any run of letters/digits. The old regex (/[a-z][a-z']{2,}/g) skipped every
// 1-2 letter word AND every number, so a full 40-word transcript scored ~4 and looked like junk.
const WORD_RE = /[A-Za-z0-9]+/g;
function wc(t: string) { return (t.match(WORD_RE) || []).length; }

// A transcript is junk if it is too short to be a real spoken reel. Whisper hallucinates canned
// phrases ("Thanks for watching.", "Check this out.") on music-only / silent video, which land here.
const MIN_WORDS = 20;
const MAX_ATTEMPTS = 3; // after this many junk results we stop re-queuing and mark it no_speech (terminal)

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

// One pass per reel: download the video ONCE, store it + the thumb to R2 (so they never
// expire), and transcribe it. Processes reels missing a transcript OR a stored copy.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const canTranscribe = transcriberConfigured();
  const canStore = r2Configured();
  if (!canTranscribe && !canStore) {
    return NextResponse.json({ ok: false, reason: "no_key", message: "Add GROQ_API_KEY (transcription) and/or R2 config (durable storage)." }, { status: 200 });
  }

  const url = new URL(req.url);
  const creator = (url.searchParams.get("creator") || "").toLowerCase();
  const limit = Math.min(Number(url.searchParams.get("limit") || 12), 25);
  // Transcribe ONE specific reel on demand (e.g. from the canvas), bypassing the batch priority queue.
  const targetId = url.searchParams.get("id");
  const slugs = (CONTENT_CREATORS as readonly string[]).includes(creator) ? [creator] : [...CONTENT_CREATORS];

  const sb = getServiceSupabase();
  let transcribed = 0, stored = 0, failed = 0, requeued_junk = 0, gave_up = 0;

  const SEL = "id, client_key, ig_media_id, video_url, thumbnail_url, transcript_status, transcript_words, transcript_attempts, stored_video_url";
  for (const slug of (targetId ? ["__target__"] : slugs)) {
    // Work list, in priority order (never-transcribed first, then re-queued junk):
    //  - pending / failed  = never got a good transcript yet
    //  - stored_video_url null = still needs a durable copy
    //  - done but transcript_words < MIN_WORDS and attempts < MAX = junk to re-transcribe (capped, so a
    //    genuinely silent video can never loop forever; it becomes no_speech after MAX attempts)
    // no_speech / na are terminal and never selected. transcript_words asc nullsFirst puts posts that
    // were never transcribed (null words) ahead of the low-word junk, so fresh coverage is never starved.
    const { data: rows } = targetId
      ? await sb.from("creator_content").select(SEL).eq("id", targetId).not("video_url", "is", null).limit(1)
      : await sb
          .from("creator_content")
          .select(SEL)
          .eq("client_key", slug)
          .not("video_url", "is", null)
          .or(`transcript_status.eq.pending,transcript_status.eq.failed,stored_video_url.is.null,and(transcript_status.eq.done,transcript_words.lt.${MIN_WORDS},transcript_attempts.lt.${MAX_ATTEMPTS})`)
          .order("transcript_words", { ascending: true, nullsFirst: true })
          .order("taken_at", { ascending: false, nullsFirst: false })
          .limit(limit);

    for (const r of rows || []) {
      const pathSlug = (r.client_key as string) || slug;
      const isJunk = r.transcript_status === "done" && (r.transcript_words ?? 0) < MIN_WORDS;
      // Targeted mode always (re)transcribes the requested reel; batch mode uses the status rules.
      const needTranscript = canTranscribe && (!!targetId || r.transcript_status === "pending" || r.transcript_status === "failed" || isJunk);
      const needStore = !r.stored_video_url && canStore;
      if (!needTranscript && !needStore) continue;

      let bytes: ArrayBuffer | null = null;
      try {
        const res = await fetch(r.video_url as string, { cache: "no-store" });
        if (res.ok) bytes = await res.arrayBuffer();
      } catch { /* url likely expired; caller re-ingests to refresh */ }
      if (!bytes) { failed++; continue; }

      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (needStore) {
        const vurl = await putToR2(`content/${pathSlug}/${r.ig_media_id}.mp4`, bytes, "video/mp4");
        if (vurl) { update.stored_video_url = vurl; stored++; }
        const turl = await storeThumb(pathSlug, r.ig_media_id as string, r.thumbnail_url as string | null);
        if (turl) update.stored_thumb_url = turl;
      }
      if (needTranscript) {
        const attempts = (r.transcript_attempts ?? 0) + 1;
        update.transcript_attempts = attempts;
        const t = await transcribeBytes(bytes);
        if (t.ok && t.text) {
          const words = wc(t.text);
          update.transcript = t.text; update.transcript_words = words;
          if (words >= MIN_WORDS) { update.transcript_status = "done"; transcribed++; }
          else if (attempts >= MAX_ATTEMPTS) { update.transcript_status = "no_speech"; gave_up++; } // terminal: video has no real speech
          else { update.transcript_status = "done"; requeued_junk++; } // stays selectable until attempts run out
        } else {
          update.transcript_status = t.reason === "too_large" ? "na" : (attempts >= MAX_ATTEMPTS ? "na" : "failed");
          failed++;
        }
      }
      await sb.from("creator_content").update(update).eq("id", r.id);
      // Targeted mode: hand the transcript straight back to the caller.
      if (targetId) {
        return NextResponse.json({
          ok: true,
          id: r.id,
          transcribed: transcribed > 0 || requeued_junk > 0,
          words: (update.transcript_words as number) ?? null,
          status: update.transcript_status ?? null,
          transcript: (update.transcript as string) ?? null,
        });
      }
    }
    if (targetId) return NextResponse.json({ ok: false, error: "reel not found, no video, or download failed" }, { status: 200 });
  }
  return NextResponse.json({ ok: true, transcribed, requeued_junk, gave_up_no_speech: gave_up, stored, failed, note: `Batch of ${limit}; resumable, run again to continue. Priority: never-transcribed first, then junk under ${MIN_WORDS} words (capped at ${MAX_ATTEMPTS} attempts).` });
}
