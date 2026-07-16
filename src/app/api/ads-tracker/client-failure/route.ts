import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Beacon endpoint: the Ads tab POSTs here ONLY when it falls back to the amber "live data unavailable"
// banner (a real failed live fetch with nothing live on screen). Each row is one such event, so an
// empty table means the tab has been healthy. The daily attribution-reconcile cron reports the last
// 24h count, turning "it broke again" from a mystery into a number. Best-effort and forgiving: a bad
// body or a write hiccup never surfaces to the user.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown, max = 500) => (v == null ? null : String(v).slice(0, max));
    await getServiceSupabase().from("ads_client_failures").insert({
      account: str(body.account, 40),
      date_from: str(body.dateFrom, 20),
      date_to: str(body.dateTo, 20),
      error: str(body.error, 500),
      duration_ms: Number.isFinite(Number(body.durationMs)) ? Math.round(Number(body.durationMs)) : null,
      view: str(body.view, 20),
      user_agent: str(req.headers.get("user-agent"), 300),
    });
  } catch {
    /* diagnostics are best-effort; never fail the beacon */
  }
  // 204 regardless, so navigator.sendBeacon / a fire-and-forget fetch never logs an error.
  return new NextResponse(null, { status: 204 });
}
