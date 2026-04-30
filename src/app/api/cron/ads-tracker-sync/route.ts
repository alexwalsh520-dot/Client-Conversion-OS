import { NextRequest, NextResponse } from "next/server";

const DEFAULT_LOOKBACK_DAYS = 10;
const MAX_LOOKBACK_DAYS = 30;

function todayIso() {
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

function isIsoDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getBaseUrl(req: NextRequest) {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
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
  const dateFrom = params.get("dateFrom") || shiftDate(dateTo, -lookback);

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

  return NextResponse.json({
    ok: salesRows.ok && adsTracker.ok,
    dateFrom,
    dateTo,
    elapsed_ms: Date.now() - startedAt,
    results: {
      "/api/sync/sales-tracker-rows": salesRows,
      "/api/sync/ads-tracker": adsTracker,
    },
  });
}
