import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { transcribeBytes, transcriberConfigured } from "@/lib/transcribe";
import { putToR2, storeThumb, r2Configured } from "@/lib/content-storage";
import { CONTENT_CREATORS } from "@/lib/instagram-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WORD_RE = /[a-z][a-z']{2,}/g;
function wc(t: string) { return (t.toLowerCase().match(WORD_RE) || []).length; }

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
  const slugs = (CONTENT_CREATORS as readonly string[]).includes(creator) ? [creator] : [...CONTENT_CREATORS];

  const sb = getServiceSupabase();
  let transcribed = 0, stored = 0, failed = 0;

  for (const slug of slugs) {
    // Reels that still need a transcript OR a durable copy.
    const { data: rows } = await sb
      .from("creator_content")
      .select("id, ig_media_id, video_url, thumbnail_url, transcript_status, stored_video_url")
      .eq("client_key", slug)
      .not("video_url", "is", null)
      .or("transcript_status.eq.pending,stored_video_url.is.null")
      .order("taken_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    for (const r of rows || []) {
      const needTranscript = r.transcript_status === "pending" && canTranscribe;
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
        const vurl = await putToR2(`content/${slug}/${r.ig_media_id}.mp4`, bytes, "video/mp4");
        if (vurl) { update.stored_video_url = vurl; stored++; }
        const turl = await storeThumb(slug, r.ig_media_id as string, r.thumbnail_url as string | null);
        if (turl) update.stored_thumb_url = turl;
      }
      if (needTranscript) {
        const t = await transcribeBytes(bytes);
        if (t.ok && t.text) { update.transcript = t.text; update.transcript_status = "done"; update.transcript_words = wc(t.text); transcribed++; }
        else { update.transcript_status = t.reason === "too_large" ? "na" : "failed"; failed++; }
      }
      await sb.from("creator_content").update(update).eq("id", r.id);
    }
  }
  return NextResponse.json({ ok: true, transcribed, stored, failed, note: `Batch of ${limit}; run again to continue.` });
}
