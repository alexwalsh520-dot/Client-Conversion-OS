import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Dedicated, resumable transcription worker with its OWN function budget, so draining the transcript
// backlog can never starve the content pipeline (Fathom, mining, buyer-DNA all live on other functions).
// It repeatedly calls the transcribe worker (each call does one bounded batch, prioritising never-
// transcribed posts, then junk under the word floor with a capped retry) until either nothing is left to
// do or the wall-clock budget runs out. Everything is idempotent, so the next run picks up where this left
// off. Once the library is fully transcribed each run returns fast (the worker finds no work).
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  const H = { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" };
  const budgetMs = 270000;
  const started = Date.now();
  const batches: Array<Record<string, unknown>> = [];
  let totals = { transcribed: 0, requeued_junk: 0, gave_up_no_speech: 0, stored: 0, failed: 0 };

  // Each batch is bounded by the worker's own maxDuration; we stop starting new ones near the budget.
  while (Date.now() - started < budgetMs - 130000) {
    const s = Date.now();
    try {
      const r = await fetch(`${origin}/api/content/transcribe?limit=20`, { method: "POST", headers: H, signal: AbortSignal.timeout(125000) });
      const body = (await r.json().catch(() => null)) as Record<string, number> | null;
      batches.push({ status: r.status, ms: Date.now() - s, ...(body || {}) });
      if (body) {
        for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += Number(body[k] || 0);
        // Nothing transcribed, stored, or failed this batch = the queue is drained; stop looping.
        if (!body.transcribed && !body.stored && !body.failed && !body.requeued_junk && !body.gave_up_no_speech) break;
      } else break;
    } catch (e) {
      batches.push({ ms: Date.now() - s, error: e instanceof Error ? e.message : "failed" });
      break;
    }
  }
  return NextResponse.json({ ok: true, cron: "transcribe-blitz", total_ms: Date.now() - started, totals, batches });
}
