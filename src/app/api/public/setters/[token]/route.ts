// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC, NO-LOGIN SETTER RESPONSE-TIMES API — the data boundary for the
// setter-facing live view at /p/setters/<token>.
//
// Setters open a shared token link (no CCOS login) to watch their own response
// times live — especially at the midday check-in. The contract:
//
//   * Access is decided SOLELY by the token row in public_share_links
//     (kind = 'setters', not revoked). No client/scope param is honored.
//   * The payload is a SANITIZED cut of the Sales Hub response-time metrics:
//     per-setter and team aggregates + hourly buckets ONLY. No lead names,
//     no conversation rows, no ManyChat deep links, no pipeline diagnostics —
//     none of that belongs on a public surface.
//   * ?date=YYYY-MM-DD lets a setter look back at a recent shift, clamped to
//     the last 30 days and never the future. Default: today in ET.
//   * Revoked / missing tokens return a clean error with no data.
//
// This route lives under api/public, which is on the src/proxy.ts allow-list,
// so auth is replaced by the token check below. Read-only, service role
// server-side only.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  getResponseTimeMetrics,
  type ResponseTimeGroup,
} from "@/lib/sales-hub/response-times";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const LOOKBACK_DAYS = 30;

function etTodayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Only aggregate numbers leave this route — strip anything else a group might
// ever grow (defensive copy instead of spreading the whole object).
function publicGroup(group: ResponseTimeGroup) {
  return {
    id: group.id,
    label: group.label,
    averageSeconds: group.averageSeconds,
    medianSeconds: group.medianSeconds,
    sampleCount: group.sampleCount,
    fastestSeconds: group.fastestSeconds,
    slowestSeconds: group.slowestSeconds,
    missedCount: group.missedCount,
    hourly: group.hourly.map((h) => ({
      hour: h.hour,
      count: h.count,
      avgSeconds: h.avgSeconds,
      medianSeconds: h.medianSeconds,
      missedCount: h.missedCount,
    })),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // 1) The token is the only credential. It must be a live 'setters' link.
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("kind, revoked")
      .eq("token", token)
      .maybeSingle();
    if (error || !data || data.revoked || data.kind !== "setters") {
      return NextResponse.json(
        { error: "This link is not available." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "This link is not available." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  // 2) Resolve the shift date — default today (ET), clamped to the recent past.
  const today = etTodayIso();
  const requested = req.nextUrl.searchParams.get("date") || today;
  const earliest = shiftDate(today, -LOOKBACK_DAYS);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested)
    ? requested > today
      ? today
      : requested < earliest
        ? earliest
        : requested
    : today;

  // 3) Same engine as the Sales Hub Response Times section — one shift's window.
  try {
    const metrics = await getResponseTimeMetrics({
      client: "all",
      dateFrom: date,
      dateTo: date,
    });

    return NextResponse.json(
      {
        date,
        today,
        generatedAt: new Date().toISOString(),
        missThresholdSeconds: metrics.missThresholdSeconds,
        latestMessageAt: metrics.summary.latestMessageAt,
        staleMessageFeed: metrics.summary.staleMessageFeed,
        businessHours: metrics.setup.businessHours,
        team: publicGroup(metrics.summary),
        // Named setters only — the internal "Unassigned" bucket is a pipeline
        // diagnostic, not something a setter can act on.
        setters: metrics.setters
          .filter((group) => group.id !== "unassigned")
          .map(publicGroup),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("[public/setters] metrics failed", err);
    return NextResponse.json(
      { error: "Could not load response times right now. Try refreshing." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
