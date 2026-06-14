import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { CREATORS, creatorKeyFromText, type CreatorKey } from "@/lib/creators";
import {
  SETTER_NAMES,
  capacityForSetter,
  defaultSetterCapacityConfig,
  getSetterCapacityConfig,
  type SetterCapacityConfig,
} from "@/lib/lab/setter-capacity";

export const dynamic = "force-dynamic";

const THRESHOLD_PCT = 0.8;
const ET_TIMEZONE = "America/New_York";
const DEFAULT_WINDOW_DAYS = 7;

// Data source for "leads handled": the canonical ManyChat lead feed. Every time
// a setter picks up a new lead, ManyChat fires the `new_lead` tag → we store it
// in manychat_tag_events with the setter_name + client. We count those events
// per setter per ET calendar day across a multi-day window and report the
// AVERAGE leads/day, so the read is stable (not the near-zero morning blip a
// today-only count produces).
const SOURCE = "manychat_tag_events.new_lead (multi-day avg, ET)";

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in the ET calendar as YYYY-MM-DD. */
function todayEtDateString(): string {
  return ET_DATE_FMT.format(new Date());
}

/** The ET calendar date (YYYY-MM-DD) for a given absolute instant. */
function etDateStringForInstant(instant: Date): string {
  return ET_DATE_FMT.format(instant);
}

/** Validate a YYYY-MM-DD string. */
function isValidYmd(s: string | null): s is string {
  if (!s) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t);
}

/** Add `delta` ET calendar days to a YYYY-MM-DD string (UTC arithmetic on the
 * calendar date is safe — we only ever shift whole days). */
function addDaysYmd(ymd: string, delta: number): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`) + delta * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Inclusive list of ET calendar dates from `from` to `to`, ascending. */
function enumerateEtDays(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  // Guard against accidental runaway; a sane window is small.
  let guard = 0;
  while (cursor <= to && guard < 3660) {
    out.push(cursor);
    cursor = addDaysYmd(cursor, 1);
    guard += 1;
  }
  return out;
}

// Start of an ET calendar day expressed as a UTC ISO string, for the DB range
// filter. Probes the real ET offset for that date (handles DST).
function startOfEtDayUtcIso(etDate: string): string {
  const probe = new Date(`${etDate}T12:00:00Z`);
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(probe);
  const offsetPart = etParts.find((p) => p.type === "timeZoneName")?.value || "GMT-5";
  const match = offsetPart.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  const offsetHours = match ? Number(match[1]) : -5;
  const offsetMinutes = match && match[2] ? Number(match[2]) : 0;
  const sign = offsetHours < 0 ? -1 : 1;
  const totalOffsetMin = offsetHours * 60 + sign * offsetMinutes;
  const utcMs = Date.parse(`${etDate}T00:00:00Z`) - totalOffsetMin * 60_000;
  return new Date(utcMs).toISOString();
}

/**
 * The window's UTC bounds: [start of `from` ET day, start of the day AFTER `to`
 * ET day). Half-open so the upper bound is exclusive.
 */
function windowUtcBounds(from: string, to: string): { startIso: string; endIso: string } {
  return {
    startIso: startOfEtDayUtcIso(from),
    endIso: startOfEtDayUtcIso(addDaysYmd(to, 1)),
  };
}

/** Resolve the ?account= param to a creator and the client strings to match. */
function resolveCreator(accountParam: string | null): {
  creatorKey: CreatorKey | null;
  matchTokens: readonly string[];
} {
  const creatorKey = creatorKeyFromText(accountParam);
  if (!creatorKey) return { creatorKey: null, matchTokens: [] };
  const creator = CREATORS.find((c) => c.key === creatorKey);
  return { creatorKey, matchTokens: creator?.matchTokens ?? [creatorKey] };
}

function clientMatchesCreator(client: string | null, matchTokens: readonly string[]): boolean {
  if (!client) return false;
  const lower = client.toLowerCase();
  return matchTokens.some((token) => lower.includes(token));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type DailyRow = {
  date: string;
  total: number;
  bySetter: Record<string, number>;
};

export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get("account");
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");

  // ── Resolve the window ──────────────────────────────────────────────────
  // Default = the last DEFAULT_WINDOW_DAYS COMPLETE days ending YESTERDAY (ET),
  // excluding today's partial day so the average never reads artificially low.
  // If from/to are passed (and valid), honor them as-is, inclusive.
  const todayEt = todayEtDateString();
  const yesterdayEt = addDaysYmd(todayEt, -1);

  let from: string;
  let to: string;
  if (isValidYmd(fromParam) || isValidYmd(toParam)) {
    // Honor whatever valid bounds were supplied; fill the missing side from the
    // default so a single supplied bound still produces a sane window.
    to = isValidYmd(toParam) ? toParam : yesterdayEt;
    from = isValidYmd(fromParam) ? fromParam : addDaysYmd(to, -(DEFAULT_WINDOW_DAYS - 1));
    // If they came in reversed, swap so from <= to.
    if (from > to) [from, to] = [to, from];
  } else {
    to = yesterdayEt;
    from = addDaysYmd(to, -(DEFAULT_WINDOW_DAYS - 1));
  }

  const days = enumerateEtDays(from, to);
  const numDays = days.length;
  const window = { from, to, days: numDays };

  // ── Capacity first — the gear setting must work regardless of load source ─
  let config: SetterCapacityConfig;
  try {
    config = await getSetterCapacityConfig();
  } catch (error) {
    console.error("[lab/setter-load] capacity read failed, using default", error);
    config = defaultSetterCapacityConfig();
  }

  const capacityByName = new Map<string, number>(
    SETTER_NAMES.map((name) => [name, capacityForSetter(config, name)]),
  );
  // capacityTotal honors mode: "team" → the single shared value; otherwise the
  // sum of per-setter caps.
  const capacityTotal =
    config.mode === "team"
      ? config.teamLeadsPerDay
      : SETTER_NAMES.reduce((sum, name) => sum + (capacityByName.get(name) ?? 0), 0);

  const { creatorKey, matchTokens } = resolveCreator(account);

  // ── Build per-setter window totals and the daily history ────────────────
  // null => "unknown / not available" (no source). Real numbers only when we
  // trust the source.
  const leadsInWindowByName = new Map<string, number | null>(
    SETTER_NAMES.map((name) => [name, null]),
  );
  // Daily buckets seeded with zero per setter; filled only on a working source.
  const dailyByDate = new Map<string, DailyRow>(
    days.map((date) => [
      date,
      {
        date,
        total: 0,
        bySetter: Object.fromEntries(SETTER_NAMES.map((n) => [n, 0])) as Record<string, number>,
      },
    ]),
  );

  let source: string = SOURCE;
  let leadsKnown = false;
  let note = `Average leads/day over ${numDays}d window (ET), excludes partial today by default.`;

  if (!creatorKey) {
    source = "none";
    note =
      "No valid `account` param (expected e.g. tyson/keith/lucy/antwan). Capacity + window are returned; leads load is unknown until an account is supplied.";
  } else if (numDays > 0) {
    try {
      const db = getServiceSupabase();
      const { startIso, endIso } = windowUtcBounds(from, to);
      const { data, error } = await db
        .from("manychat_tag_events")
        .select("setter_name, client, event_at")
        .eq("tag_name", "new_lead")
        .gte("event_at", startIso)
        .lt("event_at", endIso);

      if (error) {
        throw new Error(error.message);
      }

      // We have a working source → seed real zeros for every setter.
      for (const name of SETTER_NAMES) leadsInWindowByName.set(name, 0);
      leadsKnown = true;

      const nameByLower = new Map(SETTER_NAMES.map((n) => [n.toLowerCase(), n]));
      for (const row of (data ?? []) as Array<{
        setter_name: string | null;
        client: string | null;
        event_at: string | null;
      }>) {
        if (!clientMatchesCreator(row.client, matchTokens)) continue;
        const canonical = nameByLower.get((row.setter_name || "").trim().toLowerCase());
        if (!canonical) continue;
        if (!row.event_at) continue;

        const instant = new Date(row.event_at);
        if (Number.isNaN(instant.getTime())) continue;
        const etDay = etDateStringForInstant(instant);
        const bucket = dailyByDate.get(etDay);
        // Bucket may be missing if the row's ET day falls outside [from,to] due
        // to DST edge rounding — skip those rather than miscount.
        if (!bucket) continue;

        leadsInWindowByName.set(canonical, (leadsInWindowByName.get(canonical) ?? 0) + 1);
        bucket.bySetter[canonical] = (bucket.bySetter[canonical] ?? 0) + 1;
        bucket.total += 1;
      }

      note = `Average leads/day over ${numDays}d window (ET, ${from}→${to}) for ${creatorKey}; \`new_lead\` ManyChat tag events per setter. Excludes partial today by default.`;
    } catch (error) {
      console.error("[lab/setter-load] leads load read failed", error);
      source = `${SOURCE} (unavailable)`;
      leadsKnown = false;
      for (const name of SETTER_NAMES) leadsInWindowByName.set(name, null);
      note = `Could not read leads from manychat_tag_events; returning null load over the ${numDays}d window. Capacity below is still valid.`;
    }
  }

  const perSetter = SETTER_NAMES.map((name) => {
    const leadsInWindow = leadsInWindowByName.get(name) ?? null;
    const capacity = capacityByName.get(name) ?? 0;
    const avgPerDay =
      leadsInWindow != null && numDays > 0 ? round1(leadsInWindow / numDays) : null;
    const loadPct =
      avgPerDay != null && capacity > 0 ? avgPerDay / capacity : null;
    return { name, leadsInWindow, avgPerDay, capacity, loadPct };
  });

  const daily = days.map((date) => dailyByDate.get(date)!);

  const avgPerDayTotal =
    leadsKnown && numDays > 0
      ? round1(
          SETTER_NAMES.reduce(
            (sum, name) => sum + (leadsInWindowByName.get(name) ?? 0),
            0,
          ) / numDays,
        )
      : null;
  const teamLoadPct =
    avgPerDayTotal != null && capacityTotal > 0 ? avgPerDayTotal / capacityTotal : null;
  const status =
    teamLoadPct == null ? "unknown" : teamLoadPct <= THRESHOLD_PCT ? "green" : "red";

  return NextResponse.json(
    {
      account: account ?? null,
      window,
      perSetter,
      daily,
      team: {
        avgPerDayTotal,
        capacityTotal,
        loadPct: teamLoadPct,
        thresholdPct: THRESHOLD_PCT,
        status,
      },
      source,
      note,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
