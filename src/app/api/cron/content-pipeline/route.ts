import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Keeps the Content tab ALWAYS up to date on its own — no manual refresh anywhere.
// Each run does a bounded pass of the whole pipeline (idempotent + compute-once, so
// it only ever processes NEW reels/calls/DMs). Runs on a schedule (vercel.json) and
// Fathom calls also arrive in real time via the webhook.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  const H = { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" };
  const hit = async (path: string) => {
    try {
      const r = await fetch(`${origin}${path}`, { method: "POST", headers: H });
      return { path, status: r.status, body: await r.json().catch(() => null) };
    } catch (e) {
      return { path, error: e instanceof Error ? e.message : "failed" };
    }
  };

  const steps: unknown[] = [];
  // 1. Pull newest reels (refreshes video urls so transcription/storage works).
  steps.push(await hit("/api/content/ingest"));
  // 1b. Tyson's IG Graph token is dead — pull his reels via Apify (public scrape).
  steps.push(await hit("/api/content/ingest-apify?creator=tyson"));
  // 2. Transcribe + permanently store any reels still missing either.
  steps.push(await hit("/api/content/transcribe?limit=20"));
  // 3. Pull recent Fathom calls (webhook handles real-time; this catches any gaps).
  steps.push(await hit("/api/content/fathom-backfill?pages=3"));
  // 4. Mine new calls + DMs into the content store (compute-once) + refresh audience read.
  steps.push(await hit("/api/content/mine?creator=tyson&limit=8"));
  steps.push(await hit("/api/content/mine?creator=antwan&limit=8"));

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), steps });
}
