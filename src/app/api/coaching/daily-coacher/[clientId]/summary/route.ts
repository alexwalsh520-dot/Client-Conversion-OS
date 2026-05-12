/**
 * Daily Coacher: persistent client summary endpoint.
 *
 * GET  → return the cached summary + staleness flag (computed by comparing
 *        daily_coacher_summary_updated_at against the newest input timestamp).
 *        Cheap. The view calls this on load and decides whether to trigger
 *        a regen.
 *
 * POST → regenerate the summary from scratch (gather all 5 inputs → Claude
 *        → persist to clients.daily_coacher_summary). Used by both the lazy
 *        on-load path and the manual "Refresh summary" button.
 *
 * Auth: requires a logged-in CCOS user (any role). Same pattern as the
 * other coaching API routes. We don't restrict by coach_name — the view
 * itself only links coaches to their own clients via the existing roster
 * filter, matching CCOS's current trust model.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  gatherSummaryInputs,
  isSummaryStale,
} from "@/lib/daily-coacher/summary-inputs";
import { regenerateAndPersistSummary } from "@/lib/daily-coacher/summary-generator";

export const runtime = "nodejs";
// Generation typically completes in 8-15s. 60s gives headroom for slow
// Fathom transcript fetches on first-touch + Claude latency spikes.
export const maxDuration = 60;

function parseClientId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// ---------------------------------------------------------------------------
// GET: current summary + staleness
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ clientId: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { clientId: clientIdRaw } = await ctx.params;
  const clientId = parseClientId(clientIdRaw);
  if (!clientId) {
    return NextResponse.json({ error: "invalid clientId" }, { status: 400 });
  }

  const inputs = await gatherSummaryInputs(clientId);
  if (!inputs) {
    return NextResponse.json({ error: "client not found" }, { status: 404 });
  }

  return NextResponse.json({
    clientId,
    summary: inputs.client.daily_coacher_summary ?? null,
    summaryUpdatedAt: inputs.client.daily_coacher_summary_updated_at ?? null,
    latestInputAt: inputs.latestInputAt,
    stale: isSummaryStale(inputs),
  });
}

// ---------------------------------------------------------------------------
// POST: regenerate + persist
// ---------------------------------------------------------------------------

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ clientId: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { clientId: clientIdRaw } = await ctx.params;
  const clientId = parseClientId(clientIdRaw);
  if (!clientId) {
    return NextResponse.json({ error: "invalid clientId" }, { status: 400 });
  }

  try {
    const result = await regenerateAndPersistSummary(clientId);
    if (!result) {
      return NextResponse.json({ error: "client not found" }, { status: 404 });
    }
    return NextResponse.json({
      clientId,
      summary: result.summary,
      summaryUpdatedAt: new Date().toISOString(),
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheCreationInputTokens: result.cacheCreationInputTokens,
        cacheReadInputTokens: result.cacheReadInputTokens,
      },
    });
  } catch (err) {
    console.error(
      `[api/coaching/daily-coacher/${clientId}/summary POST] generation failed:`,
      err
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "summary generation failed" },
      { status: 500 }
    );
  }
}
