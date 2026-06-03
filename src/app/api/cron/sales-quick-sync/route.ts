import { NextRequest, NextResponse } from "next/server";

// Lightweight, HIGH-FREQUENCY sales mirror refresh.
//
// The dashboard reads sales from the synced Supabase copy (fast) rather than the
// live Google Sheet (slow). To keep that copy fresh, this cron re-syncs ONLY the
// sales sheet every ~10 minutes. The heavier ads/ManyChat sync stays on the
// hourly cron (ads-tracker-sync) — running all of that every 10 min would be
// wasteful and risk Meta rate limits. Keeping this one sales-only makes it cheap
// enough to run often, so the dashboard is never more than a few minutes behind.

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

// First day of LAST month (ET). Re-syncing from here every run guarantees the
// whole current month (and the prior one) is always fully mirrored, so a missed
// run can never leave a permanent hole.
function firstOfPreviousMonthIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
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

export async function GET(req: NextRequest) {
  // Vercel cron sends Authorization: Bearer ${CRON_SECRET} when CRON_SECRET is set.
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const dateTo = params.get("dateTo") || todayIso();
  const lookback = Math.min(
    Math.max(Number(params.get("lookbackDays") || DEFAULT_LOOKBACK_DAYS), 0),
    MAX_LOOKBACK_DAYS
  );
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
  const res = await fetch(`${getBaseUrl(req)}/api/sync/sales-tracker-rows`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
      "x-cron-secret": process.env.CRON_SECRET ?? "",
    },
    body: JSON.stringify({ dateFrom, dateTo }),
  });
  const body = await res.json().catch(async () => ({ raw: await res.text().catch(() => "") }));

  return NextResponse.json({
    ok: res.ok,
    dateFrom,
    dateTo,
    elapsed_ms: Date.now() - startedAt,
    result: body,
  });
}
