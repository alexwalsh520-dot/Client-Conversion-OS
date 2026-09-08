// Closer Pre-Call Adherence — the Sales Hub section behind /api/sales-hub/precall-adherence.
//
// Surfaces what the adherence grader (src/lib/metrics-engine/adherence.ts,
// cron every 2h) already writes to warehouse.metrics_adherence_scores: for
// every graded sales call, did the closer run the two required pre-call
// lines over SendBlue —
//   discovery   "what do you want out of the call"
//   commitment  "any reason you wouldn't make it"
// — plus whether a SendBlue thread existed at all, joined to the sales
// tracker for the closer name and the call outcome (cash-override rule:
// cash collected counts as taken). The headline correlation: show rate when
// the discovery line was asked vs when it wasn't.

import { getServiceSupabase } from "@/lib/supabase";
import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
import { toEtDateStr } from "@/lib/sales-hub/response-times";

/* ── Result types ─────────────────────────────────────────────────── */

export type PrecallOutcome = "show" | "no_show" | "upcoming" | "unknown";

export interface PrecallCallRow {
  appointmentKey: string;
  leadName: string;
  closer: string;
  startIso: string;
  etDay: string;
  threadFound: boolean;
  /** true = line asked, false = not asked, null = no thread / not applicable */
  discovery: boolean | null;
  commitment: boolean | null;
  outcome: PrecallOutcome;
  cashCollected: number;
}

export interface PrecallLineStat {
  asked: number;
  eligible: number; // graded calls with a thread where the check applied
  rate: number | null;
}

export interface PrecallShowBucket {
  calls: number; // calls with a known outcome (show or no-show)
  shows: number;
  rate: number | null;
  cashCollected: number;
}

export interface PrecallCloserRow {
  closer: string;
  graded: number;
  threads: number;
  threadRate: number | null;
  discovery: PrecallLineStat;
  commitment: PrecallLineStat;
  shows: number;
  knownOutcomes: number;
  showRate: number | null;
  cashCollected: number;
}

export interface PrecallAdherenceResult {
  team: {
    graded: number;
    threads: number;
    threadRate: number | null;
    discovery: PrecallLineStat;
    commitment: PrecallLineStat;
    showWhenDiscoveryAsked: PrecallShowBucket;
    showWhenDiscoveryNotAsked: PrecallShowBucket;
    showWhenNoThread: PrecallShowBucket;
  };
  closers: PrecallCloserRow[];
  calls: PrecallCallRow[]; // newest first
  asOf: string;
}

/* ── Warehouse row shapes ─────────────────────────────────────────── */

interface ScoreRow {
  appointment_key: string;
  rep_key: string | null;
  score: number | null;
  checks: { id: string; passed: boolean; applicable: boolean }[] | null;
  thread_found: boolean;
}

interface ApptRow {
  appointment_id: string;
  contact_name: string | null;
  start_time: string | null;
}

const PAGE = 1000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ── Name join (same rules the outcome audit settled on) ──────────── */

function normName(raw: string | null | undefined): string {
  return (raw || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function titleCase(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface TrackerCall {
  etDay: string;
  closer: string;
  taken: boolean;
  noShow: boolean;
  cash: number;
}

function dayDiff(a: string, b: string): number {
  return Math.abs(
    (new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000,
  );
}

/* ── Engine ───────────────────────────────────────────────────────── */

export async function getPrecallAdherence(opts: {
  dateFrom: string; // YYYY-MM-DD (ET)
  dateTo: string;
}): Promise<PrecallAdherenceResult> {
  const { dateFrom, dateTo } = opts;
  const db = getServiceSupabase();

  // 1) Every pre-call score (the table is small; paginate to stay safe).
  const scores: ScoreRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .schema("warehouse")
      .from("metrics_adherence_scores")
      .select("appointment_key, rep_key, score, checks, thread_found")
      .eq("kind", "pre_call")
      .order("appointment_key", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`metrics_adherence_scores: ${error.message}`);
    scores.push(...((data || []) as ScoreRow[]));
    if (!data || data.length < PAGE) break;
  }
  if (scores.length === 0) return emptyResult();

  // 2) Appointment context (name + scheduled start) for those scores.
  const apptById = new Map<string, ApptRow>();
  for (const ids of chunk(scores.map((s) => s.appointment_key), 200)) {
    const { data, error } = await db
      .schema("warehouse")
      .from("ghl_appointments")
      .select("appointment_id, contact_name, start_time")
      .in("appointment_id", ids);
    if (error) throw new Error(`ghl_appointments: ${error.message}`);
    for (const r of (data || []) as ApptRow[]) apptById.set(r.appointment_id, r);
  }

  // 3) Tracker call rows for the range — closer names + outcomes.
  //    (Widened a day each side so the ±1-day name join near midnight holds.)
  let sheetRows: SheetRow[] = [];
  try {
    sheetRows = await fetchSheetData(shiftDay(dateFrom, -1), shiftDay(dateTo, 1));
  } catch {
    sheetRows = [];
  }
  const trackerByName = new Map<string, TrackerCall[]>();
  const trackerByToken = new Map<string, TrackerCall[]>();
  for (const r of sheetRows) {
    if (r.programLength === "Subscription") continue;
    const key = normName(r.name);
    if (!key) continue;
    const call: TrackerCall = {
      etDay: r.date,
      closer: r.closer ? titleCase(r.closer) : "",
      taken: r.callTakenStatus === "yes" || r.cashCollected > 0,
      noShow: r.callTakenStatus === "no",
      cash: r.cashCollected || 0,
    };
    (trackerByName.get(key) ?? trackerByName.set(key, []).get(key)!).push(call);
    const tokens = key.split(" ");
    if (tokens.length >= 2) {
      const tokenKey = `${tokens[0]} ${tokens[tokens.length - 1]}`;
      (trackerByToken.get(tokenKey) ?? trackerByToken.set(tokenKey, []).get(tokenKey)!).push(call);
    }
  }

  const findTrackerCall = (name: string, etDay: string): TrackerCall | null => {
    const key = normName(name);
    if (!key) return null;
    const candidates = trackerByName.get(key) ?? (() => {
      const tokens = key.split(" ");
      if (tokens.length < 2) return undefined;
      return trackerByToken.get(`${tokens[0]} ${tokens[tokens.length - 1]}`);
    })();
    if (!candidates) return null;
    let best: TrackerCall | null = null;
    for (const c of candidates) {
      const d = dayDiff(c.etDay, etDay);
      if (d <= 1 && (!best || d < dayDiff(best.etDay, etDay))) best = c;
    }
    return best;
  };

  // 4) One row per graded call inside the range.
  const nowMs = Date.now();
  const calls: PrecallCallRow[] = [];
  for (const s of scores) {
    const appt = apptById.get(s.appointment_key);
    const startIso = appt?.start_time;
    if (!startIso) continue; // appointment vanished — nothing to date it by
    const etDay = toEtDateStr(startIso);
    if (etDay < dateFrom || etDay > dateTo) continue;

    const leadName = (appt?.contact_name || "").trim() || "Unknown lead";
    const tracker = findTrackerCall(leadName, etDay);

    let outcome: PrecallOutcome = "unknown";
    if (tracker?.taken) outcome = "show";
    else if (tracker?.noShow) outcome = "no_show";
    else if (new Date(startIso).getTime() > nowMs) outcome = "upcoming";

    const closer =
      tracker?.closer ||
      (s.rep_key ? titleCase(s.rep_key) : "") ||
      "Unknown";

    const check = (id: string): boolean | null => {
      const c = (s.checks || []).find((x) => x.id === id);
      if (!c || !c.applicable) return null;
      return c.passed;
    };

    calls.push({
      appointmentKey: s.appointment_key,
      leadName,
      closer,
      startIso,
      etDay,
      threadFound: s.thread_found,
      discovery: s.thread_found ? check("discovery") : null,
      commitment: s.thread_found ? check("commitment") : null,
      outcome,
      cashCollected: tracker?.cash || 0,
    });
  }
  calls.sort((a, b) => b.startIso.localeCompare(a.startIso));

  // 5) Aggregate.
  const rate = (n: number, d: number): number | null => (d > 0 ? (n / d) * 100 : null);
  const lineStat = (rows: PrecallCallRow[], key: "discovery" | "commitment"): PrecallLineStat => {
    const eligible = rows.filter((r) => r[key] !== null);
    const asked = eligible.filter((r) => r[key] === true).length;
    return { asked, eligible: eligible.length, rate: rate(asked, eligible.length) };
  };
  const showBucket = (rows: PrecallCallRow[]): PrecallShowBucket => {
    const known = rows.filter((r) => r.outcome === "show" || r.outcome === "no_show");
    const shows = known.filter((r) => r.outcome === "show").length;
    return {
      calls: known.length,
      shows,
      rate: rate(shows, known.length),
      cashCollected: known.reduce((sum, r) => sum + r.cashCollected, 0),
    };
  };

  const threads = calls.filter((c) => c.threadFound);
  const byCloser = new Map<string, PrecallCallRow[]>();
  for (const c of calls) {
    (byCloser.get(c.closer) ?? byCloser.set(c.closer, []).get(c.closer)!).push(c);
  }

  const closers: PrecallCloserRow[] = [...byCloser.entries()]
    .map(([closer, rows]) => {
      const closerThreads = rows.filter((r) => r.threadFound).length;
      const known = rows.filter((r) => r.outcome === "show" || r.outcome === "no_show");
      const shows = known.filter((r) => r.outcome === "show").length;
      return {
        closer,
        graded: rows.length,
        threads: closerThreads,
        threadRate: rate(closerThreads, rows.length),
        discovery: lineStat(rows, "discovery"),
        commitment: lineStat(rows, "commitment"),
        shows,
        knownOutcomes: known.length,
        showRate: rate(shows, known.length),
        cashCollected: rows.reduce((sum, r) => sum + r.cashCollected, 0),
      };
    })
    .sort((a, b) => b.graded - a.graded || a.closer.localeCompare(b.closer));

  return {
    team: {
      graded: calls.length,
      threads: threads.length,
      threadRate: rate(threads.length, calls.length),
      discovery: lineStat(calls, "discovery"),
      commitment: lineStat(calls, "commitment"),
      showWhenDiscoveryAsked: showBucket(threads.filter((c) => c.discovery === true)),
      showWhenDiscoveryNotAsked: showBucket(threads.filter((c) => c.discovery !== true)),
      showWhenNoThread: showBucket(calls.filter((c) => !c.threadFound)),
    },
    closers,
    calls,
    asOf: new Date().toISOString(),
  };
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function emptyResult(): PrecallAdherenceResult {
  const zeroLine: PrecallLineStat = { asked: 0, eligible: 0, rate: null };
  const zeroBucket: PrecallShowBucket = { calls: 0, shows: 0, rate: null, cashCollected: 0 };
  return {
    team: {
      graded: 0,
      threads: 0,
      threadRate: null,
      discovery: zeroLine,
      commitment: zeroLine,
      showWhenDiscoveryAsked: zeroBucket,
      showWhenDiscoveryNotAsked: zeroBucket,
      showWhenNoThread: zeroBucket,
    },
    closers: [],
    calls: [],
    asOf: new Date().toISOString(),
  };
}
