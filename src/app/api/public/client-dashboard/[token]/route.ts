// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC, NO-LOGIN CLIENT BUSINESS DASHBOARD API — the data boundary for the
// client-facing dashboard at /p/client-dashboard/<token>.
//
// The client's ONE central place for their numbers: marketing (ad spend,
// impressions, clicks, cost-per efficiency), sales (booked / taken / closed /
// cash / New MRR, Sales Hub formulas verbatim), and the live calendar of
// upcoming booked calls. The contract mirrors /api/public/client-metrics:
//
//   * Access is decided SOLELY by the token row in public_share_links
//     (kind = 'client-dashboard', not revoked). The client scope comes from
//     the token row's client_key — no client param is honored, so a tampered
//     query string cannot reach another client's numbers.
//   * SALES source of truth is the Google Sheets sales tracker, read LIVE via
//     fetchSheetData; rows attributed via the Offer column (creatorKeyFromText).
//     Metric formulas are the Sales Hub's computeMetrics verbatim. New MRR
//     comes from the tracker's subscriptions block (fetchMonthTabMrrRows),
//     scoped by the same Offer detector.
//   * MARKETING comes from ads_meta_insights_daily (the hourly Meta sync),
//     summed over the window. Spend is stored in the creator's billing
//     currency and converted to USD per-day via fx_rates — never sales.
//     Marketing degrades to null on failure; sales must still render.
//   * upcomingCalls is the LIVE CALENDAR: booked, non-cancelled appointments
//     from ghl_appointments on this client's pinned sales calendars (dm +
//     outbound only — reschedule calendars are client-ambiguous and excluded).
//   * Only facts the client already owns leave this route: their spend, their
//     call rows (date, name, setter, closer, status, cash on wins), their
//     calendar (prospect name + time). No notes, no links, no other client.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  fetchSheetData,
  fetchMonthTabMrrRows,
  type SheetRow,
} from "@/lib/google-sheets";
import { engineCalendar } from "@/lib/metrics-engine/calendars";
import { safeFetchAllRows } from "@/lib/metrics-engine/db";
import {
  creatorCurrency,
  loadUsdRateMap,
  convertCentsToUsd,
  nonUsdCurrenciesForClients,
} from "@/lib/fx/rates";
import {
  creatorKeyFromText,
  isCreatorKey,
  CREATORS_BY_KEY,
  type CreatorKey,
} from "@/lib/creators";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

// The tracker's first month tab is JANUARY 2026.
const EARLIEST_DATE = "2026-01-01";
// Widest window one request may span — keeps the tab fan-out bounded.
const MAX_RANGE_DAYS = 366;
// How far past today the window may reach (calls get booked ahead).
const MAX_FUTURE_DAYS = 92;
// How far forward the live calendar looks.
const CALENDAR_LOOKAHEAD_DAYS = 45;

// Per-token rate limit (per instance): plenty for a dashboard someone leaves
// open, hostile to token-guessing scripts.
const RATE_LIMIT = { windowMs: 10_000, max: 30 };
const rateBuckets = new Map<string, { windowStart: number; count: number }>();

function rateLimited(token: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(token);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT.windowMs) {
    rateBuckets.set(token, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT.max;
}

function etTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Full calendar month around a date — the default window. */
function monthBounds(date: string): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const month = date.slice(0, 7);
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function clampDate(value: string, min: string, max: string): string {
  return value < min ? min : value > max ? max : value;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Client-readable labels for the tracker's outcome vocabulary.
const OUTCOME_LABELS: Record<string, string> = {
  "NS/RS": "No Show / Resched",
  "NS-RS": "No Show / Resched",
  "NO SHOW": "No Show",
  CANCELLED: "Cancelled",
  "NOT A FIT/NO OFFER": "Not a Fit",
  "NOT A FIT": "Not a Fit",
  LOST: "Lost",
  PCFU: "Follow-Up",
};

type Stage = "upcoming" | "taken" | "closed" | "no";

interface UpcomingCall {
  id: string;
  name: string;
  startTime: string; // ISO instant
}

interface MarketingBlock {
  spend: number; // USD dollars
  impressions: number;
  linkClicks: number;
  ctr: number | null;
  cpc: number | null;
  costPerBooked: number | null;
  costPerAcquisition: number | null;
  roas: number | null;
}

/**
 * The live calendar: booked, non-cancelled appointments on this client's
 * pinned SALES calendars (dm + outbound), from now forward. Degrades to []
 * on any failure — the rest of the payload must still render.
 */
async function fetchUpcomingCalls(clientKey: CreatorKey): Promise<UpcomingCall[]> {
  try {
    const sb = getServiceSupabase();
    const nowIso = new Date().toISOString();
    const horizonIso = new Date(
      Date.now() + CALENDAR_LOOKAHEAD_DAYS * 86_400_000,
    ).toISOString();
    const { data, error } = await sb
      .from("ghl_appointments")
      .select("appointment_id, calendar_id, contact_name, start_time, status, event_type")
      .gte("start_time", nowIso)
      .lte("start_time", horizonIso)
      .order("start_time", { ascending: true })
      .limit(500);
    if (error || !data) return [];
    return data
      .filter((r) => {
        const cal = engineCalendar(r.calendar_id);
        if (!cal || cal.client !== clientKey) return false;
        // Sales calendars only; reschedule calendars are client-ambiguous and
        // onboarding calls aren't part of the sales-call story.
        if (cal.side !== "dm" && cal.side !== "outbound") return false;
        return !`${r.status || ""} ${r.event_type || ""}`.toLowerCase().includes("cancel");
      })
      .map((r) => ({
        id: String(r.appointment_id),
        name: (r.contact_name || "").trim() || "Booked Call",
        startTime: new Date(r.start_time).toISOString(),
      }));
  } catch {
    return [];
  }
}

/**
 * Raw marketing totals over the window: spend (USD), impressions, link clicks
 * from ads_meta_insights_daily. Returns null on any failure so the dashboard's
 * sales half still renders.
 */
async function fetchMarketingTotals(
  clientKey: CreatorKey,
  from: string,
  to: string,
): Promise<{ spend: number; impressions: number; linkClicks: number } | null> {
  try {
    const db = getServiceSupabase();
    const { rows } = await safeFetchAllRows<{
      date: string;
      spend_cents: number | null;
      impressions: number | null;
      link_clicks: number | null;
    }>((lo, hi) =>
      db
        .from("ads_meta_insights_daily")
        .select("date, spend_cents, impressions, link_clicks")
        .eq("client_key", clientKey)
        // Only rows re-bucketed into ET days — same filter as the metrics
        // engine / ads-v2 readers, so this dashboard never disagrees with them.
        .eq("raw_payload->>reporting_timezone", "America/New_York")
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true })
        .range(lo, hi),
    );

    // Spend is stored in the creator's billing currency (Jake = AUD) and
    // converted to USD per the day it moved. Impressions/clicks need no FX.
    const currency = creatorCurrency(clientKey);
    const rateMap = await loadUsdRateMap(
      db,
      nonUsdCurrenciesForClients([clientKey]),
      from,
      to,
    );

    let spendCents = 0;
    let impressions = 0;
    let linkClicks = 0;
    for (const r of rows) {
      spendCents += convertCentsToUsd(r.spend_cents || 0, currency, r.date, rateMap);
      impressions += r.impressions || 0;
      linkClicks += r.link_clicks || 0;
    }
    return { spend: spendCents / 100, impressions, linkClicks };
  } catch (err) {
    console.error("[public/client-dashboard] ads read failed", err);
    return null;
  }
}

/**
 * New MRR from the tracker's subscriptions block, scoped to this client by the
 * same Offer detector as the main rows. Degrades to null (renders as "—").
 */
async function fetchNewMrr(
  clientKey: CreatorKey,
  from: string,
  to: string,
): Promise<number | null> {
  try {
    const months: Array<{ year: number; month: number }> = [];
    let cursor = `${from.slice(0, 7)}-01`;
    const last = `${to.slice(0, 7)}-01`;
    while (cursor <= last) {
      const [y, m] = cursor.split("-").map(Number);
      months.push({ year: y, month: m });
      cursor = shiftDate(monthBounds(cursor).to, 1);
    }
    const blocks = await Promise.all(
      months.map((m) => fetchMonthTabMrrRows(m.year, m.month)),
    );
    let total = 0;
    for (const rows of blocks) {
      for (const r of rows) {
        if (r.date < from || r.date > to) continue;
        if (creatorKeyFromText(r.offer) !== clientKey) continue;
        total += r.mrr;
      }
    }
    return total;
  } catch (err) {
    console.error("[public/client-dashboard] mrr read failed", err);
    return null;
  }
}

// Defensive allow-list copy — only these fields ever leave the route.
// Stage rules mirror the Sales Hub's computeMetrics exactly.
function publicRow(row: SheetRow, todayEt: string) {
  const taken = row.callTakenStatus === "yes" || row.cashCollected > 0;
  const isWin = taken && row.outcome === "WIN";
  const stage: Stage = isWin
    ? "closed"
    : taken
      ? "taken"
      : row.callTakenStatus === "pending"
        ? "upcoming"
        : "no";
  const statusLabel =
    stage === "closed"
      ? "Closed Won"
      : stage === "upcoming"
        ? row.date >= todayEt
          ? "Upcoming"
          : "Pending"
        : stage === "taken"
          ? row.outcome
            ? OUTCOME_LABELS[row.outcome] || titleCase(row.outcome)
            : "Taken"
          : row.outcome
            ? OUTCOME_LABELS[row.outcome] || titleCase(row.outcome)
            : "No Show";
  return {
    date: row.date,
    name: row.name.trim(),
    setter: row.setter || "—",
    closer: row.closer ? titleCase(row.closer) : "—",
    stage,
    statusLabel,
    taken,
    cashCollected: isWin ? row.cashCollected : null,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (rateLimited(token)) {
    return NextResponse.json(
      { error: "Too many requests. Give it a few seconds." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  // 1) The token is the only credential — it must be a live 'client-dashboard'
  //    link whose client_key resolves to a known creator.
  let clientKey: CreatorKey;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("kind, revoked, client_key")
      .eq("token", token)
      .maybeSingle();
    if (
      error ||
      !data ||
      data.revoked ||
      data.kind !== "client-dashboard" ||
      !isCreatorKey(data.client_key)
    ) {
      return NextResponse.json(
        { error: "This link is not available." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    clientKey = data.client_key;
  } catch {
    return NextResponse.json(
      { error: "This link is not available." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  // 2) Resolve the date window — default the current full calendar month,
  //    clamped to the tracker's range.
  const today = etTodayIso();
  const latestDate = shiftDate(today, MAX_FUTURE_DAYS);
  const defaults = monthBounds(today);
  const isIsoDate = (v: string | null): v is string =>
    !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const rawFrom = req.nextUrl.searchParams.get("from");
  const rawTo = req.nextUrl.searchParams.get("to");
  let from = clampDate(isIsoDate(rawFrom) ? rawFrom : defaults.from, EARLIEST_DATE, latestDate);
  let to = clampDate(isIsoDate(rawTo) ? rawTo : defaults.to, EARLIEST_DATE, latestDate);
  if (from > to) [from, to] = [to, from];
  if (shiftDate(from, MAX_RANGE_DAYS) < to) to = shiftDate(from, MAX_RANGE_DAYS);

  // 3) Everything in parallel, each source degrading independently — the
  //    tracker read is the only one allowed to fail the request.
  try {
    const [allRows, upcomingCalls, marketingTotals, newMrr] = await Promise.all([
      fetchSheetData(from, to),
      fetchUpcomingCalls(clientKey),
      fetchMarketingTotals(clientKey, from, to),
      fetchNewMrr(clientKey, from, to),
    ]);
    const rows = allRows
      .filter((row) => row.programLength !== "Subscription")
      .filter((row) => creatorKeyFromText(row.offer) === clientKey)
      .map((row) => publicRow(row, today));

    // Same formulas as the Sales Hub's computeMetrics — this dashboard must
    // never disagree with the internal one.
    const booked = rows.length;
    const taken = rows.filter((r) => r.taken).length;
    const noShows = rows.filter((r) => r.stage === "no").length;
    const pending = rows.filter((r) => r.stage === "upcoming").length;
    const winRows = rows.filter((r) => r.stage === "closed");
    const wins = winRows.length;
    const losses = taken - wins;
    const showDen = taken + noShows;
    const showRate = showDen > 0 ? taken / showDen : null;
    const closeRate = taken > 0 ? wins / taken : null;
    const cashCollected = winRows.reduce((sum, r) => sum + (r.cashCollected || 0), 0);
    const aov = wins > 0 ? cashCollected / wins : null;

    let marketing: MarketingBlock | null = null;
    if (marketingTotals) {
      const { spend, impressions, linkClicks } = marketingTotals;
      marketing = {
        spend,
        impressions,
        linkClicks,
        ctr: impressions > 0 ? linkClicks / impressions : null,
        cpc: linkClicks > 0 ? spend / linkClicks : null,
        costPerBooked: spend > 0 && booked > 0 ? spend / booked : null,
        costPerAcquisition: spend > 0 && wins > 0 ? spend / wins : null,
        roas: spend > 0 ? cashCollected / spend : null,
      };
    }

    return NextResponse.json(
      {
        from,
        to,
        earliestDate: EARLIEST_DATE,
        latestDate,
        defaultFrom: defaults.from,
        defaultTo: defaults.to,
        clientLabel: CREATORS_BY_KEY[clientKey].name,
        generatedAt: new Date().toISOString(),
        marketing,
        sales: {
          booked,
          taken,
          wins,
          losses,
          noShows,
          pending,
          cashCollected,
          newMrr,
          aov,
          showRate,
          closeRate,
        },
        rows,
        upcomingCalls,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("[public/client-dashboard] sheet read failed", err);
    return NextResponse.json(
      { error: "Could not load the dashboard right now. Try refreshing." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
