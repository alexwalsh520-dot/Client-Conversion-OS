// Setter View — one setter's personal slice of the Sales Hub, served to the
// tokenized public page /p/setter-view/<token>. Today or Yesterday only
// (owner, 2026-09-14: "they should be able to backdate as far as yesterday").
//
// Everything is a per-setter cut of the same engines the hub itself uses,
// so a setter's page and the manager's hub can never disagree:
//   leads          getMetrics (ManyChat events, ET days)
//   sets           getSetsBooked (moment of scheduling, strategy only)
//   response times getResponseTimeMetrics (11am–11pm ET, owner median)
//   follow-ups     getFollowupAdherence (7-day IG window, Chat Closed aware)
//   calendar/day   tracker rows by CALL day (cash-override rule)

import { getActiveClients, getSetterLabelMap } from "@/lib/registry";
import { getMetrics } from "@/lib/manychat";
import { fetchSheetData } from "@/lib/google-sheets";
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

export type SetterViewRange = "today" | "yesterday";

export interface SetterViewResult {
  setterKey: string;
  setterLabel: string;
  range: SetterViewRange;
  etDay: string;
  leads: { newLeads: number; leadsEngaged: number; callLinksSent: number };
  sets: { count: number; bookingRate: number | null; rows: SetBookedRow[] };
  responseTimes: {
    averageSeconds: number | null;
    medianSeconds: number | null;
    sampleCount: number;
    slowestSeconds: number | null;
    missedCount: number;
    missRate: number | null;
  };
  followups: {
    due: number;
    inWindow: number;
    offWindow: number;
    missed: number;
    sent: number;
    replies: number;
    adherenceRate: number | null;
    replyRate: number | null;
    stages: FollowupGroup["stages"];
    needsFollowup: NeedsFollowupRow[];
  };
  calendar: {
    onCalendar: number;
    taken: number;
    noShows: number;
    showRate: number | null;
    cashCollected: number;
    subsSold: number;
  };
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

function normSetterCell(raw: string | null | undefined): string {
  return (raw || "").trim().toLowerCase();
}

export async function getSetterView(opts: {
  setterKey: string; // e.g. "amara"
  range: SetterViewRange;
}): Promise<SetterViewResult> {
  const setterKey = opts.setterKey.toLowerCase();
  const range: SetterViewRange = opts.range === "yesterday" ? "yesterday" : "today";
  const day = range === "yesterday" ? shiftDay(etToday(), -1) : etToday();

  const labelMap: Record<string, string> = await getSetterLabelMap().catch(() => ({}));
  const setterLabel =
    setterKey === "ai"
      ? "AI"
      : labelMap[setterKey] || setterKey.charAt(0).toUpperCase() + setterKey.slice(1);

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
    Promise.all(
      clients.map((c) => getMetrics(c.manychatKey, day, day).catch(() => null)),
    ),
    getSetsBooked({ dateFrom: day, dateTo: day }).catch(() => null),
    getResponseTimeMetrics({ client: "all", dateFrom: day, dateTo: day }).catch(() => null),
    getFollowupAdherence({ client: "all", dateFrom: day, dateTo: day }).catch(() => null),
    fetchSheetData(day, day).catch(() => [] as Awaited<ReturnType<typeof fetchSheetData>>),
  ]);

  // ── Leads (their ManyChat assignment across active clients) ──
  const leads = { newLeads: 0, leadsEngaged: 0, callLinksSent: 0 };
  for (const m of metricsPerClient) {
    const mine = m?.setters?.[setterKey];
    if (!mine) continue;
    leads.newLeads += mine.newLeads || 0;
    leads.leadsEngaged += mine.leadsEngaged || 0;
    leads.callLinksSent += mine.callLinksSent || 0;
  }

  // ── Sets booked (moment of scheduling) ──
  const mydSets: SetBookedRow[] = (sets?.rows || []).filter((r) => r.setterKey === setterKey);
  const setsCount = mydSets.length;

  // ── Response times (their group) ──
  const rtGroup: ResponseTimeGroup | undefined = responseTimes?.setters.find(
    (g) => g.id === setterKey,
  );
  const rtSamples = rtGroup?.sampleCount ?? 0;
  const rtMissed = rtGroup?.missedCount ?? 0;
  const rtDenominator = rtSamples + rtMissed;

  // ── Follow-ups (their group + their queue) ──
  const fuGroup: FollowupGroup | undefined = followups?.setters.find((g) => g.id === setterKey);
  const myQueue = (followups?.needsFollowup || []).filter(
    (r) => r.setterLabel.toLowerCase() === setterLabel.toLowerCase(),
  );

  // ── Their day on the calendar (tracker rows by CALL day) ──
  const matchesMe = (cell: string | null | undefined): boolean => {
    const norm = normSetterCell(cell);
    if (!norm) return false;
    if (norm === setterKey || norm === setterLabel.toLowerCase()) return true;
    for (const token of norm.split(/[^a-z]+/)) {
      if (token && (token === setterKey || labelMap[token]?.toLowerCase() === setterLabel.toLowerCase())) {
        return true;
      }
    }
    return false;
  };
  let onCalendar = 0;
  let taken = 0;
  let noShows = 0;
  let cashCollected = 0;
  let subsSold = 0;
  for (const r of sheetRows) {
    if (!matchesMe(r.setter)) continue;
    if (r.programLength === "Subscription") {
      subsSold += 1;
      continue;
    }
    onCalendar += 1;
    const isTaken = r.callTakenStatus === "yes" || r.callTaken || r.cashCollected > 0;
    if (isTaken) taken += 1;
    else if (r.callTakenStatus === "no") noShows += 1;
    cashCollected += r.cashCollected || 0;
  }
  const showDenominator = taken + noShows;

  return {
    setterKey,
    setterLabel,
    range,
    etDay: day,
    leads,
    sets: {
      count: setsCount,
      bookingRate: leads.newLeads > 0 ? (setsCount / leads.newLeads) * 100 : null,
      rows: mydSets,
    },
    responseTimes: {
      averageSeconds: rtGroup?.averageSeconds ?? null,
      medianSeconds: rtGroup?.medianSeconds ?? null,
      sampleCount: rtSamples,
      slowestSeconds: rtGroup?.slowestSeconds ?? null,
      missedCount: rtMissed,
      missRate: rtDenominator > 0 ? (rtMissed / rtDenominator) * 100 : null,
    },
    followups: {
      due: fuGroup?.due ?? 0,
      inWindow: fuGroup?.inWindow ?? 0,
      offWindow: fuGroup?.offWindow ?? 0,
      missed: fuGroup?.missed ?? 0,
      sent: fuGroup?.sent ?? 0,
      replies: fuGroup?.replies ?? 0,
      adherenceRate: fuGroup?.adherenceRate ?? null,
      replyRate: fuGroup?.replyRate ?? null,
      stages: fuGroup?.stages ?? [],
      needsFollowup: myQueue.slice(0, 50),
    },
    calendar: {
      onCalendar,
      taken,
      noShows,
      showRate: showDenominator > 0 ? (taken / showDenominator) * 100 : null,
      cashCollected,
      subsSold,
    },
    asOf: new Date().toISOString(),
  };
}
