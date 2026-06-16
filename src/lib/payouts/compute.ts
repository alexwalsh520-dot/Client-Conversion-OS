// Team payout engine — Client Conversion / The Forge sales team.
//
// PURE module: no I/O, no imports. Takes already-parsed sales-tracker rows for a
// single calendar month and produces a fully itemized payout run. The data layer
// (./data.ts) reads the Google Sheet and feeds this; the API route serializes the
// result. Keeping the math here pure makes it unit-testable against Matthew's
// hand-verified numbers (June 15 2026 run = $7,904.88).
//
// ── Pay schedule (all America/New_York) ────────────────────────────────────
// Closers are paid on the 1st and 15th for the PREVIOUS month's matching half:
//   • a 1st-run  pays the prior month's  1st–14th
//   • a 15th-run pays the prior month's  15th–end
// Setters are paid only on the 1st, for the ENTIRE previous month.
//
// ── Commission rules (user-confirmed June 2026) ────────────────────────────
//   • Closers: 10% of their cash collected (main sales table).
//   • Setters: 5% (Amara, Erin) / 3% (Gideon, Kelechi, Debbie) of cash collected
//     attributed to them (Setter column), PLUS 20% of the up-front New MRR they
//     DM-closed (subscriptions table). Both setter streams pay on the 1st.
//   • Will (sales manager AND a closer): $2,000 base per run (½ of $4k/mo) +
//     his own closer 10% + a 2.5% manager override on ALL cash collected by
//     everyone except him — and that override base INCLUDES the setters' New MRR
//     cash. The override is windowed to the same dates as the run's closer half.

// ---------- inputs ----------
export interface MainRow {
  date: string; // YYYY-MM-DD, already normalized to the period's year
  closer: string; // uppercase, e.g. "WILL" / "BROZ" / "AUSTIN"
  cash: number; // cash collected, dollars
  setter: string; // canonical, e.g. "Amara"
}
export interface MrrRow {
  date: string; // YYYY-MM-DD
  dmCloser: string; // the setter who DM-closed the subscription (subs "Closer" col)
  mrr: number; // up-front New MRR cash, dollars
  name?: string;
}

export type RunType = "first" | "fifteenth";

// ---------- output ----------
export interface PayoutLine {
  payee: string;
  role: "closer" | "manager" | "setter";
  kind: string; // human label, e.g. "Closer commission (10%)"
  windowStart: string;
  windowEnd: string;
  ratePct: number | null; // null = flat base
  basis: number; // dollars the rate applies to
  confirmed: number; // commission on rows dated ≤ asOf
  forecast: number; // projected commission for the full window (≥ confirmed)
  windowComplete: boolean; // asOf ≥ windowEnd
  notStarted: boolean; // asOf < windowStart
}
export interface PayeeSummary {
  payee: string;
  role: "closer" | "manager" | "setter";
  confirmed: number;
  forecast: number;
  lines: PayoutLine[];
}
export interface PayoutRun {
  payDate: string;
  runType: RunType;
  asOf: string;
  priorMonthLabel: string;
  windows: {
    closer: { start: string; end: string } | null;
    setter: { start: string; end: string } | null;
  };
  byPayee: PayeeSummary[];
  totals: { confirmed: number; forecast: number };
  fullyConfirmed: boolean;
  warnings: string[];
}

// ---------- date helpers ----------
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function pad(n: number) {
  return String(n).padStart(2, "0");
}
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based
}
function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}
function dayOf(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}
// Prior calendar month relative to (year, month).
function priorMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// The pay date that owns a given date: day ≤ 14 → the 1st, else the 15th.
export function normalizePayDate(dateStr: string): { payDate: string; runType: RunType } {
  const [y, m] = dateStr.split("-").map(Number);
  const d = dayOf(dateStr);
  if (d <= 14) return { payDate: ymd(y, m, 1), runType: "first" };
  return { payDate: ymd(y, m, 15), runType: "fifteenth" };
}
// Next scheduled pay date strictly after `dateStr`.
export function nextPayDateAfter(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const d = dayOf(dateStr);
  if (d < 1) return ymd(y, m, 1);
  if (d < 15) return ymd(y, m, 15);
  // d ≥ 15 → roll to the 1st of next month
  const nm = m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
  return ymd(nm.year, nm.month, 1);
}
// Most recent scheduled pay date on or before `dateStr`.
export function payDateOnOrBefore(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const d = dayOf(dateStr);
  if (d >= 15) return ymd(y, m, 15);
  if (d >= 1) return ymd(y, m, 1);
  const pm = priorMonth(y, m);
  return ymd(pm.year, pm.month, 15);
}
// Previous scheduled pay date strictly before the given pay date.
export function prevPayDate(payDate: string): string {
  const [y, m] = payDate.split("-").map(Number);
  const d = dayOf(payDate);
  if (d >= 15) return ymd(y, m, 1); // 15th → 1st of the same month
  const pm = priorMonth(y, m); // 1st → 15th of the previous month
  return ymd(pm.year, pm.month, 15);
}
// A descending list of pay dates: `back` before-or-on `today`, plus `fwd` upcoming.
export function recentPayDates(today: string, back: number, fwd: number): string[] {
  const out: string[] = [];
  let cur = payDateOnOrBefore(today);
  for (let i = 0; i < back; i++) {
    out.push(cur);
    cur = payDateOnOrBefore(ymd(...(prevDayParts(cur))));
  }
  const future: string[] = [];
  let nxt = nextPayDateAfter(today);
  for (let i = 0; i < fwd; i++) {
    future.push(nxt);
    nxt = nextPayDateAfter(nxt);
  }
  return [...future.reverse(), ...out]; // newest (furthest future) first
}
function prevDayParts(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) - 86400000;
  const dt = new Date(t);
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

// The earn windows a pay date settles, expressed in its prior month.
export function windowsFor(payDate: string): {
  runType: RunType;
  prior: { year: number; month: number };
  priorMonthLabel: string;
  closer: { start: string; end: string };
  setter: { start: string; end: string } | null;
} {
  const { runType } = normalizePayDate(payDate);
  const [y, m] = payDate.split("-").map(Number);
  const prior = priorMonth(y, m);
  const eom = daysInMonth(prior.year, prior.month);
  const priorMonthLabel = `${MONTHS[prior.month - 1]} ${prior.year}`;
  if (runType === "first") {
    return {
      runType,
      prior,
      priorMonthLabel,
      closer: { start: ymd(prior.year, prior.month, 1), end: ymd(prior.year, prior.month, 14) },
      setter: { start: ymd(prior.year, prior.month, 1), end: ymd(prior.year, prior.month, eom) },
    };
  }
  return {
    runType,
    prior,
    priorMonthLabel,
    closer: { start: ymd(prior.year, prior.month, 15), end: ymd(prior.year, prior.month, eom) },
    setter: null,
  };
}

// ---------- commission rates ----------
export const CLOSER_PCT = 10;
export const MANAGER_OVERRIDE_PCT = 2.5;
export const MANAGER_BASE = 2000; // per run (½ of $4k/mo)
export const MRR_PCT = 20;
const SETTER_RATES: Array<{ match: string; pct: number }> = [
  { match: "amara", pct: 5 },
  { match: "erin", pct: 5 },
  { match: "kelechi", pct: 3 },
  { match: "gideon", pct: 3 },
  { match: "debbie", pct: 3 },
  { match: "nwosu", pct: 3 }, // Debbie Nwosu
];
export function setterRatePct(name: string): number {
  const n = (name || "").toLowerCase();
  for (const r of SETTER_RATES) if (n.includes(r.match)) return r.pct;
  return 0;
}
function isWill(closer: string): boolean {
  return (closer || "").trim().toUpperCase() === "WILL";
}

// ---------- window run-rate ----------
interface WindowCalc {
  confirmedBasis: number;
  forecastBasis: number;
  windowComplete: boolean;
  notStarted: boolean;
}
// Given the dollars that fall inside [start,end] dated ≤ asOf vs the full window,
// project the full-window total by daily run-rate when the window is still open.
function windowCalc(
  rows: Array<{ date: string; amt: number }>,
  start: string,
  end: string,
  asOf: string
): WindowCalc {
  const inConfirmed = (d: string) => d >= start && d <= end && d <= asOf;
  const confirmedBasis = rows.reduce((s, r) => (inConfirmed(r.date) ? s + r.amt : s), 0);
  if (asOf >= end) {
    // window fully elapsed — confirmed IS the final number
    return { confirmedBasis, forecastBasis: confirmedBasis, windowComplete: true, notStarted: false };
  }
  if (asOf < start) {
    return { confirmedBasis: 0, forecastBasis: 0, windowComplete: false, notStarted: true };
  }
  // partially elapsed: asOf is inside the window's month
  const elapsedDays = dayOf(asOf) - dayOf(start) + 1;
  const totalDays = dayOf(end) - dayOf(start) + 1;
  const factor = elapsedDays > 0 ? totalDays / elapsedDays : 0;
  return { confirmedBasis, forecastBasis: confirmedBasis * factor, windowComplete: false, notStarted: false };
}

function line(
  payee: string,
  role: PayoutLine["role"],
  kind: string,
  start: string,
  end: string,
  ratePct: number,
  calc: WindowCalc
): PayoutLine {
  const f = ratePct / 100;
  return {
    payee,
    role,
    kind,
    windowStart: start,
    windowEnd: end,
    ratePct,
    basis: calc.confirmedBasis,
    confirmed: round2(calc.confirmedBasis * f),
    forecast: round2(calc.forecastBasis * f),
    windowComplete: calc.windowComplete,
    notStarted: calc.notStarted,
  };
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------- main ----------
export function computePayoutRun(opts: {
  payDate: string;
  asOf: string;
  mainRows: MainRow[]; // full prior-month main sales rows
  mrrRows: MrrRow[]; // full prior-month subscription rows
  warnings?: string[];
}): PayoutRun {
  const w = windowsFor(opts.payDate);
  const warnings = [...(opts.warnings || [])];
  const lines: PayoutLine[] = [];

  // ----- 1) Closers: 10% of own cash collected over the closer window -----
  const closers = Array.from(new Set(opts.mainRows.map((r) => r.closer).filter((c) => c && c.trim())));
  for (const closer of closers) {
    const rows = opts.mainRows.filter((r) => r.closer === closer).map((r) => ({ date: r.date, amt: r.cash }));
    const calc = windowCalc(rows, w.closer.start, w.closer.end, opts.asOf);
    if (calc.confirmedBasis === 0 && calc.forecastBasis === 0) continue;
    lines.push(line(titleCaseCloser(closer), "closer", "Closer commission (10%)", w.closer.start, w.closer.end, CLOSER_PCT, calc));
  }

  // ----- 2) Will: base + 2.5% override (non-Will cash + ALL New MRR) -----
  // base — always paid, both halves
  lines.push({
    payee: "Will",
    role: "manager",
    kind: "Manager base (½ of $4k/mo)",
    windowStart: w.closer.start,
    windowEnd: w.closer.end,
    ratePct: null,
    basis: 0,
    confirmed: MANAGER_BASE,
    forecast: MANAGER_BASE,
    windowComplete: true,
    notStarted: false,
  });
  // override base = everyone-else's closer cash + all New MRR (none of which is Will's),
  // windowed to the same dates as this run's closer half.
  const overrideRows: Array<{ date: string; amt: number }> = [
    ...opts.mainRows.filter((r) => !isWill(r.closer)).map((r) => ({ date: r.date, amt: r.cash })),
    ...opts.mrrRows.filter((r) => !isWill(r.dmCloser)).map((r) => ({ date: r.date, amt: r.mrr })),
  ];
  const overrideCalc = windowCalc(overrideRows, w.closer.start, w.closer.end, opts.asOf);
  lines.push(
    line(
      "Will",
      "manager",
      "Manager override (2.5% of all non-Will cash + New MRR)",
      w.closer.start,
      w.closer.end,
      MANAGER_OVERRIDE_PCT,
      overrideCalc
    )
  );

  // ----- 3) Setters (1st-run only): 5%/3% of own cash + 20% of own New MRR -----
  if (w.setter) {
    const setters = Array.from(new Set(opts.mainRows.map((r) => r.setter).filter((s) => s && s.trim())));
    for (const setter of setters) {
      const rate = setterRatePct(setter);
      const rows = opts.mainRows.filter((r) => r.setter === setter).map((r) => ({ date: r.date, amt: r.cash }));
      const calc = windowCalc(rows, w.setter.start, w.setter.end, opts.asOf);
      if (calc.confirmedBasis === 0 && calc.forecastBasis === 0) continue;
      if (rate === 0) {
        warnings.push(`No setter rate configured for "${setter}" — they collected cash but earn $0. Add their rate if this is wrong.`);
      }
      lines.push(line(setter, "setter", `Setter commission (${rate}%)`, w.setter.start, w.setter.end, rate, calc));
    }
    // New MRR 20% by DM-closer (universal across setters)
    const dmClosers = Array.from(new Set(opts.mrrRows.map((r) => r.dmCloser).filter((s) => s && s.trim())));
    for (const dm of dmClosers) {
      if (isWill(dm)) continue; // Will's MRR (if any) is handled via his override, not a 20% setter line
      const rows = opts.mrrRows.filter((r) => r.dmCloser === dm).map((r) => ({ date: r.date, amt: r.mrr }));
      const calc = windowCalc(rows, w.setter.start, w.setter.end, opts.asOf);
      if (calc.confirmedBasis === 0 && calc.forecastBasis === 0) continue;
      lines.push(line(titleCaseCloser(dm), "setter", "New MRR commission (20%)", w.setter.start, w.setter.end, MRR_PCT, calc));
    }
  }

  // ----- aggregate by payee -----
  const map = new Map<string, PayeeSummary>();
  for (const l of lines) {
    const key = l.payee.toLowerCase();
    let s = map.get(key);
    if (!s) {
      s = { payee: l.payee, role: l.role, confirmed: 0, forecast: 0, lines: [] };
      map.set(key, s);
    }
    // a payee who is both a closer and the manager (Will) keeps role "manager"
    if (l.role === "manager") s.role = "manager";
    s.lines.push(l);
    s.confirmed = round2(s.confirmed + l.confirmed);
    s.forecast = round2(s.forecast + l.forecast);
  }
  const order = { manager: 0, closer: 1, setter: 2 } as const;
  const byPayee = Array.from(map.values()).sort((a, b) => {
    if (order[a.role] !== order[b.role]) return order[a.role] - order[b.role];
    return b.forecast - a.forecast;
  });

  const totals = {
    confirmed: round2(byPayee.reduce((s, p) => s + p.confirmed, 0)),
    forecast: round2(byPayee.reduce((s, p) => s + p.forecast, 0)),
  };
  // The run is fully locked once the latest window it pays has elapsed.
  const lastEnd = w.setter ? w.setter.end : w.closer.end;
  const fullyConfirmed = opts.asOf >= lastEnd;

  return {
    payDate: opts.payDate,
    runType: w.runType,
    asOf: opts.asOf,
    priorMonthLabel: w.priorMonthLabel,
    windows: { closer: w.closer, setter: w.setter },
    byPayee,
    totals,
    fullyConfirmed,
    warnings,
  };
}

// Closer/setter names arrive UPPERCASE from the sheet; present them nicely.
function titleCaseCloser(name: string): string {
  const n = (name || "").trim();
  if (!n) return n;
  if (n.toUpperCase() === "WILL") return "Will";
  return n
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
