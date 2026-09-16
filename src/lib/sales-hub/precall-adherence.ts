// Closer Pre-Call Adherence — the Sales Hub section behind /api/sales-hub/precall-adherence.
//
// Surfaces what the adherence grader (src/lib/metrics-engine/adherence.ts,
// cron every 2h) writes to warehouse.metrics_adherence_scores. The SOP
// (owner, 2026-09-17) is two closer-side lines with a timing gap between:
//   intro      "good to meet you — looks like I got you in for <time>"
//   (prospect replies)
//   discovery  "what do you want out of the call"
// and we measure how long the closer took to answer the prospect's reply to
// the intro (ideally with the discovery line itself). There is no commitment
// line. Joined to the sales tracker for closer name + outcome (cash-override
// rule) so every adherence signal can be split by show rate.
//
// Rows graded before 2026-09-17 carry no intro/timing yet ("legacy"); the
// grader re-scores them a few per run, so they fill in over the day.

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
  /** Graded under the old rubric — intro/timing not available until re-graded. */
  legacy: boolean;
  intro: boolean | null;
  leadReplied: boolean | null; // did the prospect answer the intro
  responseSeconds: number | null; // prospect's reply → closer's next message
  discovery: boolean | null;
  discoveryDirect: boolean | null; // the discovery line WAS that next message
  outcome: PrecallOutcome;
  cashCollected: number;
}

export interface PrecallLineStat {
  asked: number;
  eligible: number;
  rate: number | null;
}

export interface PrecallShowBucket {
  label: string;
  calls: number; // calls with a known outcome (show or no-show)
  shows: number;
  rate: number | null;
  cashCollected: number;
}

export interface PrecallResponseStat {
  samples: number;
  averageSeconds: number | null;
  /** Owner definition: the average with the single slowest removed. */
  medianSeconds: number | null;
  slowestSeconds: number | null;
}

export interface PrecallCloserRow {
  closer: string;
  graded: number;
  threads: number;
  threadRate: number | null;
  intro: PrecallLineStat;
  leadReplied: PrecallLineStat;
  discovery: PrecallLineStat;
  discoveryDirect: PrecallLineStat;
  response: PrecallResponseStat;
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
    legacyPending: number;
    intro: PrecallLineStat;
    leadReplied: PrecallLineStat;
    discovery: PrecallLineStat;
    discoveryDirect: PrecallLineStat;
    response: PrecallResponseStat;
    showByDiscovery: PrecallShowBucket[];
    showByIntro: PrecallShowBucket[];
    showByLeadReply: PrecallShowBucket[];
    showByResponse: PrecallShowBucket[];
  };
  closers: PrecallCloserRow[];
  calls: PrecallCallRow[]; // newest first
  asOf: string;
}

/* ── Warehouse row shapes ─────────────────────────────────────────── */

interface CheckRow {
  id: string;
  passed: boolean;
  applicable: boolean;
  at?: string | null;
  leadReplyAt?: string | null;
  closerReplyAt?: string | null;
  responseSeconds?: number | null;
  directReply?: boolean | null;
}

interface ScoreRow {
  appointment_key: string;
  rep_key: string | null;
  score: number | null;
  checks: CheckRow[] | null;
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

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/* ── Stats helpers ────────────────────────────────────────────────── */

const rate = (n: number, d: number): number | null => (d > 0 ? (n / d) * 100 : null);

function lineStat(rows: PrecallCallRow[], pick: (r: PrecallCallRow) => boolean | null): PrecallLineStat {
  const eligible = rows.filter((r) => pick(r) !== null);
  const asked = eligible.filter((r) => pick(r) === true).length;
  return { asked, eligible: eligible.length, rate: rate(asked, eligible.length) };
}

function responseStat(rows: PrecallCallRow[]): PrecallResponseStat {
  const values = rows
    .map((r) => r.responseSeconds)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length === 0) return { samples: 0, averageSeconds: null, medianSeconds: null, slowestSeconds: null };
  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const trimmed = sorted.length > 1 ? sorted.slice(0, -1) : sorted;
  const median = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
  return { samples: values.length, averageSeconds: avg, medianSeconds: median, slowestSeconds: sorted[sorted.length - 1] };
}

function showBucket(label: string, rows: PrecallCallRow[]): PrecallShowBucket {
  const known = rows.filter((r) => r.outcome === "show" || r.outcome === "no_show");
  const shows = known.filter((r) => r.outcome === "show").length;
  return {
    label,
    calls: known.length,
    shows,
    rate: rate(shows, known.length),
    cashCollected: known.reduce((sum, r) => sum + r.cashCollected, 0),
  };
}

function responseBucketLabel(r: PrecallCallRow): string | null {
  if (r.intro !== true) return null;
  if (r.leadReplied !== true) return "Prospect never replied";
  const s = r.responseSeconds;
  if (s === null) return "Closer never replied";
  if (s <= 300) return "Replied within 5 min";
  if (s <= 1800) return "5–30 min";
  if (s <= 7200) return "30 min – 2 h";
  return "Over 2 h";
}

const RESPONSE_BUCKET_ORDER = [
  "Replied within 5 min",
  "5–30 min",
  "30 min – 2 h",
  "Over 2 h",
  "Closer never replied",
  "Prospect never replied",
];

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
    const candidates =
      trackerByName.get(key) ??
      (() => {
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

    const closer = tracker?.closer || (s.rep_key ? titleCase(s.rep_key) : "") || "Unknown";

    const checks = s.checks || [];
    const introCheck = checks.find((c) => c.id === "intro");
    const discoveryCheck = checks.find((c) => c.id === "discovery");
    const legacy = s.thread_found && !introCheck;

    const intro = s.thread_found && introCheck ? Boolean(introCheck.passed) : null;
    const leadReplied = intro === true ? Boolean(introCheck?.leadReplyAt) : null;
    const responseSeconds =
      leadReplied === true && typeof introCheck?.responseSeconds === "number"
        ? introCheck.responseSeconds
        : null;
    const discovery = s.thread_found && discoveryCheck ? Boolean(discoveryCheck.passed) : null;
    const discoveryDirect =
      discovery === true && typeof discoveryCheck?.directReply === "boolean"
        ? discoveryCheck.directReply
        : null;

    calls.push({
      appointmentKey: s.appointment_key,
      leadName,
      closer,
      startIso,
      etDay,
      threadFound: s.thread_found,
      legacy,
      intro,
      leadReplied,
      responseSeconds,
      discovery,
      discoveryDirect,
      outcome,
      cashCollected: tracker?.cash || 0,
    });
  }
  calls.sort((a, b) => b.startIso.localeCompare(a.startIso));

  // 5) Aggregate.
  const threads = calls.filter((c) => c.threadFound);
  const summarize = (rows: PrecallCallRow[]) => ({
    intro: lineStat(rows, (r) => r.intro),
    leadReplied: lineStat(rows, (r) => r.leadReplied),
    discovery: lineStat(rows, (r) => r.discovery),
    discoveryDirect: lineStat(rows, (r) => r.discoveryDirect),
    response: responseStat(rows),
  });

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
        ...summarize(rows),
        shows,
        knownOutcomes: known.length,
        showRate: rate(shows, known.length),
        cashCollected: rows.reduce((sum, r) => sum + r.cashCollected, 0),
      };
    })
    .sort((a, b) => b.graded - a.graded || a.closer.localeCompare(b.closer));

  const responseBuckets = new Map<string, PrecallCallRow[]>();
  for (const c of calls) {
    const label = responseBucketLabel(c);
    if (!label) continue;
    (responseBuckets.get(label) ?? responseBuckets.set(label, []).get(label)!).push(c);
  }

  return {
    team: {
      graded: calls.length,
      threads: threads.length,
      threadRate: rate(threads.length, calls.length),
      legacyPending: calls.filter((c) => c.legacy).length,
      ...summarize(calls),
      showByDiscovery: [
        showBucket("Discovery line asked", threads.filter((c) => c.discovery === true)),
        showBucket("Not asked", threads.filter((c) => c.discovery === false)),
        showBucket("No thread", calls.filter((c) => !c.threadFound)),
      ],
      showByIntro: [
        showBucket("Intro sent", calls.filter((c) => c.intro === true)),
        showBucket("Intro not sent", calls.filter((c) => c.intro === false)),
      ],
      showByLeadReply: [
        showBucket("Prospect replied to intro", calls.filter((c) => c.leadReplied === true)),
        showBucket("Prospect never replied", calls.filter((c) => c.leadReplied === false)),
      ],
      showByResponse: RESPONSE_BUCKET_ORDER.filter((l) => responseBuckets.has(l)).map((l) =>
        showBucket(l, responseBuckets.get(l) || []),
      ),
    },
    closers,
    calls,
    asOf: new Date().toISOString(),
  };
}

function emptyResult(): PrecallAdherenceResult {
  const zeroLine: PrecallLineStat = { asked: 0, eligible: 0, rate: null };
  const zeroResponse: PrecallResponseStat = { samples: 0, averageSeconds: null, medianSeconds: null, slowestSeconds: null };
  return {
    team: {
      graded: 0,
      threads: 0,
      threadRate: null,
      legacyPending: 0,
      intro: zeroLine,
      leadReplied: zeroLine,
      discovery: zeroLine,
      discoveryDirect: zeroLine,
      response: zeroResponse,
      showByDiscovery: [],
      showByIntro: [],
      showByLeadReply: [],
      showByResponse: [],
    },
    closers: [],
    calls: [],
    asOf: new Date().toISOString(),
  };
}
