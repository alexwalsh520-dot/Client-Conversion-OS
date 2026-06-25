import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { transcribeFromUrl, transcriberConfigured } from "@/lib/transcribe";
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

// Transcribe a batch of un-transcribed reels for a creator (bounded so it never times out).
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!transcriberConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "no_key", message: "Transcription is off — add GROQ_API_KEY to enable reel transcription." },
      { status: 200 }
    );
  }
  const url = new URL(req.url);
  const creator = (url.searchParams.get("creator") || "").toLowerCase();
  const limit = Math.min(Number(url.searchParams.get("limit") || 15), 30);
  const slugs = (CONTENT_CREATORS as readonly string[]).includes(creator) ? [creator] : [...CONTENT_CREATORS];

  const sb = getServiceSupabase();
  let done = 0, failed = 0;
  for (const slug of slugs) {
    const { data: rows } = await sb
      .from("creator_content")
      .select("id, video_url")
      .eq("client_key", slug)
      .eq("transcript_status", "pending")
      .not("video_url", "is", null)
      .order("taken_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    for (const r of rows || []) {
      const res = await transcribeFromUrl(r.video_url as string);
      if (res.ok && res.text) {
        await sb.from("creator_content").update({
          transcript: res.text, transcript_status: "done", transcript_words: wc(res.text), updated_at: new Date().toISOString(),
        }).eq("id", r.id);
        done++;
      } else {
        await sb.from("creator_content").update({
          transcript_status: res.reason === "too_large" ? "na" : "failed", updated_at: new Date().toISOString(),
        }).eq("id", r.id);
        failed++;
      }
    }
  }
  return NextResponse.json({ ok: true, transcribed: done, failed, note: `Run again to continue (batches of ${limit}).` });
}
