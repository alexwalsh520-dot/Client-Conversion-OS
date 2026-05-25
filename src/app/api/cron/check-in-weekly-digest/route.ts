/**
 * GET /api/cron/check-in-weekly-digest
 *
 * Fires every Sunday at 4 PM PKT (11:00 UTC on Sunday) per the schedule
 * in vercel.json. Builds the weekly Check-In digest, asks Claude for a
 * 300-400 word executive summary, and emails the whole thing to Saeed.
 *
 * Authentication mirrors the other cron routes: trust the `x-vercel-cron`
 * header (set by Vercel's cron infrastructure) OR a `Bearer CRON_SECRET`
 * Authorization header (so the route can be triggered manually for testing).
 */

import { NextRequest, NextResponse } from "next/server";
import { buildAndSendWeeklyDigest } from "@/lib/check-in/weekly-digest";

export const runtime = "nodejs";
export const maxDuration = 300; // Claude can take 20-60s; budget plenty

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const auth = req.headers.get("authorization");
  return Boolean(
    process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await buildAndSendWeeklyDigest();
    return NextResponse.json({
      ok: result.email.ok,
      emailId: result.email.id,
      emailError: result.email.error,
      submissionsCount: result.digest.submissions.length,
      attentionCount: result.digest.attentionClients.length,
      missingCount: result.digest.totalMissingClients,
      activeClientsTotal: result.digest.totalActiveClientsWithDaysLeft,
      netAvgScore: result.digest.netAvgScore,
      summaryPreview: result.summary.slice(0, 200),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/check-in-weekly-digest] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
