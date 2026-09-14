// Setter Team View — every setter's numbers on one tokenized public page
// (/p/setter-view/<token>). One link for the whole team (owner, 2026-09-14:
// "everybody can see everybody's numbers"), date range clamped so data only
// starts from YESTERDAY (ET) — the earliest selectable day.
//
// Everything is a per-setter cut of the same engines the hub itself uses,
// so a setter's page and the manager's hub can never disagree:
//   leads          getMetrics (ManyChat events, ET days)
//   sets           getSetsBooked (moment of scheduling, strategy only)
//   response times getResponseTimeMetrics (11am–11pm ET, owner median)
//   follow-ups     getFollowupAdherence (7-day IG window, Chat Closed aware)
//   calendar       tracker rows by CALL day (cash-override rule)

import { getActiveClients, getSetterLabelMap } from "@/lib/registry";
import { getMetrics } from "@/lib/manychat";
import { fetchSheetData } from "@/lib/google-sheets";
import { isExcludedSetter } from "@/lib/sales-hub/excluded-setters";
import { getSetsBooked, type SetBookedRow } from "@/lib/sales-hub/sets-booked";
import {
  getResponseTimeMetrics,
  type ResponseTimeGroup,
} from "@/lib/sales-hub/response-times";
import {
  getFollowupAdherence,
  type FollowupGroup,
  type NeedsFollowupRow,
} from "@/lib/sales-hub/followup-adherence";

export interface SetterRowStats {
  key: string;
  label: string;
  newLeads: number;
  leadsEngaged: number;
  callLinksSent: number;
  sets: number;
  bookingRate: number | null;
  subsSold: number;
  rt: {
    averageSeconds: number | null;
    medianSeconds: number | null;
    sampleCount: number;
    slowestSeconds: number | null;
    missedCount: number;
    missRate: number | null;
  };
  cal: {
    onCalendar: number;
    taken: number;
    noShows: number;
    showRate: number | null;
    cashCollected: number;
  };
  fu: {
    due: number;
    inWindow: number;
    missed: number;
    sent: number;
    adherenceRate: number | null;
    replyRate: number | null;
  };
}

export interface SetterTeamViewResult {
  dateFrom: string;
  dateTo: string;
  minDay: string; // earliest ET day the page may request (yesterday)
  setters: SetterRowStats[];
  team: SetterRowStats;
  needsFollowup: NeedsFollowupRow[]; // whole team, most overdue first
  sets: SetBookedRow[]; // whole team's set log, newest first
  asOf: string;
}

const ET = "America/New_York";

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function rate(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null;
}

function emptyRow(key: string, label: string): SetterRowStats {
  return {
    key,
    label,
    newLeads: 0,
    leadsEngaged: 0,
    callLinksSent: 0,
    sets: 0,
    bookingRate: null,
    subsSold: 0,
    rt: {
      averageSeconds: null,
      medianSeconds: null,
      sampleCount: 0,
      slowestSeconds: null,
      missedCount: 0,
      missRate: null,
    },
    cal: { onCalendar: 0, taken: 0, noShows: 0, showRate: null, cashCollected: 0 },
    fu: { due: 0, inWindow: 0, missed: 0, sent: 0, adherenceRate: null, replyRate: null },
  };
}

/** Clamp a requested range so data only starts from yesterday (ET). */
export function clampSetterViewRange(dateFrom: string | null, dateTo: string | null) {
  const today = etToday();
  const minDay = shiftDay(today, -1);
  let from = dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : today;
  let to = dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? dateTo : today;
  if (from < minDay) from = minDay;
  if (to > today) to = today;
  if (to < from) to = from;
  return { dateFrom: from, dateTo: to, minDay };
}

export async function getSetterTeamView(opts: {
  dateFrom: string;
  dateTo: string;
}): Promise<SetterTeamViewResult> {
  const { dateFrom, dateTo, minDay } = clampSetterViewRange(opts.dateFrom, opts.dateTo);

  const labelMap: Record<string, string> = await getSetterLabelMap().catch(() => ({}));
  const labelFor = (key: string): string =>
    key === "ai" ? "AI" : labelMap[key] || key.charAt(0).toUpperCase() + key.slice(1);

  let clients: { key: string; manychatKey: string }[] = [
    { key: "tyson", manychatKey: "tyson_sonnek" },
  ];
  try {
    const actives = await getActiveClients();
    if (actives.length > 0) clients = actives.map((c) => ({ key: c.key, manychatKey: c.manychatKey }));
  } catch {
    // static fallback above
  }

  const [metricsPerClient, sets, responseTimes, followups, sheetRows] = await Promise.all([
    Promise.all(clients.map((c) => getMetrics(c.manychatKey, dateFrom, dateTo).catch(() => null))),
    getSetsBooked({ dateFrom, dateTo }).catch(() => null),
    getResponseTimeMetrics({ client: "all", dateFrom, dateTo }).catch(() => null),
    getFollowupAdherence({ client: "all", dateFrom, dateTo }).catch(() => null),
    fetchSheetData(dateFrom, dateTo).catch(() => [] as Awaited<ReturnType<typeof fetchSheetData>>),
  ]);

  const rows = new Map<string, SetterRowStats>();
  const rowFor = (key: string): SetterRowStats => {
    let row = rows.get(key);
    if (!row) {
      row = emptyRow(key, labelFor(key));
      rows.set(key, row);
    }
    return row;
  };

  // ── Leads (ManyChat assignment across active clients) ──
  for (const m of metricsPerClient) {
    for (const [key, s] of Object.entries(m?.setters || {})) {
      if (isExcludedSetter(key)) continue;
      const row = rowFor(key.toLowerCase());
      row.newLeads += s.newLeads || 0;
      row.leadsEngaged += s.leadsEngaged || 0;
      row.callLinksSent += s.callLinksSent || 0;
    }
  }

  // ── Sets booked (moment of scheduling) ──
  for (const s of sets?.bySetter || []) {
    if (s.key === "unassigned") continue;
    rowFor(s.key).sets += s.count;
  }

  // ── Response times ──
  for (const g of responseTimes?.setters || []) {
    if (g.id === "unassigned" || isExcludedSetter(g.id)) continue;
    const row = rowFor(g.id);
    const denominator = g.sampleCount + g.missedCount;
    row.rt = {
      averageSeconds: g.averageSeconds,
      medianSeconds: g.medianSeconds,
      sampleCount: g.sampleCount,
      slowestSeconds: g.slowestSeconds,
      missedCount: g.missedCount,
      missRate: rate(g.missedCount, denominator),
    };
  }

  // ── Follow-ups ──
  for (const g of followups?.setters || []) {
    if (g.id === "unassigned") continue;
    const row = rowFor(g.id);
    row.fu = {
      due: g.due,
      inWindow: g.inWindow,
      missed: g.missed,
      sent: g.sent,
      adherenceRate: g.adherenceRate,
      replyRate: g.replyRate,
    };
  }

  // ── Calendar rows (tracker, by CALL day) ──
  const matchKey = (cell: string | null | undefined): string | null => {
    const norm = (cell || "").trim().toLowerCase();
    if (!norm) return null;
    if (norm === "ai" || norm === "a.i.") return "ai";
    if (labelMap[norm]) return norm;
    for (const token of norm.split(/[^a-z]+/)) {
      if (token === "ai") return "ai";
      if (token && labelMap[token]) return token;
    }
    return norm.split(/[^a-z]+/).find(Boolean) || null;
  };
  const teamCal = { onCalendar: 0, taken: 0, noShows: 0, cashCollected: 0, subsSold: 0 };
  for (const r of sheetRows) {
    const key = matchKey(r.setter);
    const row = key && !isExcludedSetter(key) ? rowFor(key) : null;
    if (r.programLength === "Subscription") {
      teamCal.subsSold += 1;
      if (row) row.subsSold += 1;
      continue;
    }
    teamCal.onCalendar += 1;
    const isTaken = r.callTakenStatus === "yes" || r.callTaken || r.cashCollected > 0;
    if (isTaken) teamCal.taken += 1;
    else if (r.callTakenStatus === "no") teamCal.noShows += 1;
    teamCal.cashCollected += r.cashCollected || 0;
    if (row) {
      row.cal.onCalendar += 1;
      if (isTaken) row.cal.taken += 1;
      else if (r.callTakenStatus === "no") row.cal.noShows += 1;
      row.cal.cashCollected += r.cashCollected || 0;
    }
  }

  // ── Finish per-setter derived rates ──
  for (const row of rows.values()) {
    row.bookingRate = rate(row.sets, row.newLeads);
    row.cal.showRate = rate(row.cal.taken, row.cal.taken + row.cal.noShows);
  }

  // ── Team row from the engines' own team aggregates ──
  const team = emptyRow("team", "Team");
  for (const m of metricsPerClient) {
    team.newLeads += m?.dashboard?.newLeads || 0;
    team.leadsEngaged += m?.dashboard?.leadsEngaged || 0;
    team.callLinksSent += m?.dashboard?.callLinksSent || 0;
  }
  team.sets = sets?.team ?? 0;
  team.bookingRate = rate(team.sets, team.newLeads);
  const rtSummary: ResponseTimeGroup | undefined = responseTimes?.summary;
  if (rtSummary) {
    const denominator = rtSummary.sampleCount + rtSummary.missedCount;
    team.rt = {
      averageSeconds: rtSummary.averageSeconds,
      medianSeconds: rtSummary.medianSeconds,
      sampleCount: rtSummary.sampleCount,
      slowestSeconds: rtSummary.slowestSeconds,
      missedCount: rtSummary.missedCount,
      missRate: rate(rtSummary.missedCount, denominator),
    };
  }
  const fuTeam: FollowupGroup | undefined = followups?.team;
  if (fuTeam) {
    team.fu = {
      due: fuTeam.due,
      inWindow: fuTeam.inWindow,
      missed: fuTeam.missed,
      sent: fuTeam.sent,
      adherenceRate: fuTeam.adherenceRate,
      replyRate: fuTeam.replyRate,
    };
  }
  team.cal = {
    onCalendar: teamCal.onCalendar,
    taken: teamCal.taken,
    noShows: teamCal.noShows,
    showRate: rate(teamCal.taken, teamCal.taken + teamCal.noShows),
    cashCollected: teamCal.cashCollected,
  };
  team.subsSold = teamCal.subsSold;

  const setters = [...rows.values()]
    .filter(
      (r) =>
        r.newLeads > 0 ||
        r.sets > 0 ||
        r.rt.sampleCount > 0 ||
        r.rt.missedCount > 0 ||
        r.fu.due > 0 ||
        r.cal.onCalendar > 0 ||
        r.subsSold > 0,
    )
    .sort((a, b) => b.newLeads - a.newLeads || a.label.localeCompare(b.label));

  return {
    dateFrom,
    dateTo,
    minDay,
    setters,
    team,
    needsFollowup: (followups?.needsFollowup || []).slice(0, 100),
    sets: sets?.rows || [],
    asOf: new Date().toISOString(),
  };
}
