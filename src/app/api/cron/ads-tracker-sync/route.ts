import { NextRequest, NextResponse } from "next/server";
import { refreshStandardWindows } from "@/lib/ads-tracker/snapshot";

export const maxDuration = 300;

// Lookback is a SAFETY FLOOR, not the whole story. The real rule (below) is
// "always re-read from the 1st of last month through today" so the full current
// month is rebuilt on every run and a missed sync can never leave a permanent
// hole. A rolling 10-day window used to silently drop everything older than 10
// days — that lost ~2/3 of a month's sales from the dashboard.
const DEFAULT_LOOKBACK_DAYS = 10;
const MAX_LOOKBACK_DAYS = 120;

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// First day of LAST month, in ET. Re-syncing from here every run guarantees the
// entire current month (and the one before it) is always fully present, so the
// database is a complete mirror of recent sales rather than a fragile window.
function firstOfPreviousMonthIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value); // 1-12
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isIsoDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getBaseUrl(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_ENV === "production") return "https://client-conversion-os.vercel.app";
  return new URL(req.url).origin;
}

async function callSyncRoute(baseUrl: string, route: string, body: unknown) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
      "x-cron-secret": process.env.CRON_SECRET ?? "",
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(async () => ({ raw: await res.text().catch(() => "") }));
  return { ok: res.ok, status: res.status, body: payload };
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const dateTo = params.get("dateTo") || todayIso();
  const lookback = Math.min(Math.max(Number(params.get("lookbackDays") || DEFAULT_LOOKBACK_DAYS), 0), MAX_LOOKBACK_DAYS);
  // Default window = whichever reaches FURTHER back: the 1st of last month
  // (guarantees the full current month is always rebuilt) or the lookback floor.
  // An explicit dateFrom/lookbackDays param still overrides for manual backfills.
  const lookbackFrom = shiftDate(dateTo, -lookback);
  const monthFrom = firstOfPreviousMonthIso();
  const dateFrom = params.get("dateFrom") || (monthFrom < lookbackFrom ? monthFrom : lookbackFrom);

  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo) || dateFrom > dateTo) {
    return NextResponse.json(
      { error: "Invalid dateFrom/dateTo. Use YYYY-MM-DD and dateFrom <= dateTo." },
      { status: 400 }
    );
  }

  const startedAt = Date.now();
  const body = { dateFrom, dateTo };
  const baseUrl = getBaseUrl(req);
  const [salesRows, adsTracker] = await Promise.all([
    callSyncRoute(baseUrl, "/api/sync/sales-tracker-rows", body),
    callSyncRoute(baseUrl, "/api/sync/ads-tracker", body),
  ]);

  // Runs after the sales mirror so newly-stored rows can be classified. Failure
  // here must never block the core sync, so it is awaited separately.
  const manychatOrigin = await callSyncRoute(baseUrl, "/api/sync/manychat-origin", body);

  // Now that the underlying data is fresh, recompute the dashboard snapshots so the Ads tab
  // serves one fast, identical, labeled result. Give it whatever time is left under the 300s
  // route budget (minus ~30s headroom for the stamp write + response). Never blocks the core sync.
  const warmBudgetMs = Math.max(60000, 270000 - (Date.now() - startedAt));
  const snapshots = await refreshStandardWindows(warmBudgetMs).catch(() => ({ computed: 0, failed: 0, skipped: 0, ms: 0 }));

  // Incrementally stamp recent sales into the attribution facts layer. Nothing reads it for display
  // yet; this just keeps the (dollar-for-dollar reconciled) stamps current for when the fast read
  // path is switched on. Never blocks the sync.
  try {
    await fetch(`${baseUrl}/api/ads-tracker/reconcile-facts?store=1`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  } catch { /* tolerate */ }

  return NextResponse.json({
    ok: salesRows.ok && adsTracker.ok,
    dateFrom,
    dateTo,
    elapsed_ms: Date.now() - startedAt,
    snapshots,
    results: {
      "/api/sync/sales-tracker-rows": salesRows,
      "/api/sync/ads-tracker": adsTracker,
      "/api/sync/manychat-origin": manychatOrigin,
    },
  });
}
