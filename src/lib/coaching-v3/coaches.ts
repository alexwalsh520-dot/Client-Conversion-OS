// Coach-level rollups for /coaching-v3/coaches.
//
// Purely derived from the hub read model plus the raw Everfit inbox messages
// (for median reply time). No writes.

import { getServiceSupabase } from "@/lib/supabase";
import type { HubV3 } from "./hub";

export interface CoachRow {
  coach: string;
  clients: number;
  atRisk: number;      // score.bucket === 'at_risk'
  repliesOwed: number; // clients waiting >= 2 days for a coach reply
  replyHoursMedian: number | null;
  monthRetentionPct: number | null;
  monthTotal: number;
  monthRetained: number;
  monthLost: number;
  pastEnd: number;
  lastEodDate: string | null;
}

/** Median in hours across every (client message -> next coach message) gap
 *  observed inside the last 14 days per coach. Requires at least 3 samples
 *  to publish a number, else null. */
async function medianReplyHoursByCoach(): Promise<Record<string, number | null>> {
  const db = getServiceSupabase();
  const [convosQ, msgsQ] = await Promise.all([
    db
      .from("everfit_inbox_conversations")
      .select("everfit_id, coach_name"),
    db
      .from("everfit_inbox_messages")
      .select("everfit_id, sender, observed_at")
      .order("observed_at", { ascending: true })
      .limit(20000),
  ]);
  const coachByConvo = new Map<string, string>();
  for (const c of convosQ.data ?? []) {
    if (c.coach_name) coachByConvo.set(c.everfit_id as string, c.coach_name as string);
  }
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const gapsByCoach = new Map<string, number[]>();
  const msgsByConvo = new Map<string, { at: number; sender: string }[]>();
  for (const m of msgsQ.data ?? []) {
    const t = Date.parse(m.observed_at as string);
    if (!Number.isFinite(t) || t < cutoff) continue;
    const arr = msgsByConvo.get(m.everfit_id as string) ?? [];
    arr.push({ at: t, sender: m.sender as string });
    msgsByConvo.set(m.everfit_id as string, arr);
  }
  for (const [convoId, msgs] of msgsByConvo.entries()) {
    const coach = coachByConvo.get(convoId);
    if (!coach) continue;
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].sender !== "client") continue;
      const next = msgs.slice(i + 1).find((x) => x.sender === "coach");
      if (!next) continue;
      const h = (next.at - msgs[i].at) / 3_600_000;
      if (h < 0 || h > 24 * 14) continue;
      const arr = gapsByCoach.get(coach) ?? [];
      arr.push(h);
      gapsByCoach.set(coach, arr);
    }
  }
  const out: Record<string, number | null> = {};
  for (const [coach, gaps] of gapsByCoach.entries()) {
    if (gaps.length < 3) {
      out[coach] = null;
      continue;
    }
    gaps.sort((a, b) => a - b);
    const mid = gaps[Math.floor(gaps.length / 2)];
    out[coach] = Math.round(mid);
  }
  return out;
}

/** Last EOD date per coach from eod_reports.submitted_by. */
async function lastEodByCoach(): Promise<Record<string, string | null>> {
  const db = getServiceSupabase();
  const { data } = await db
    .from("eod_reports")
    .select("submitted_by, date")
    .order("date", { ascending: false })
    .limit(2000);
  const out: Record<string, string | null> = {};
  for (const r of data ?? []) {
    const who = (r.submitted_by as string) ?? "";
    if (!who) continue;
    if (!out[who]) out[who] = (r.date as string) ?? null;
  }
  return out;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export async function coachRowsV3(hub: HubV3): Promise<CoachRow[]> {
  const [replyMedianByRaw, lastEodByRaw] = await Promise.all([
    medianReplyHoursByCoach(),
    lastEodByCoach(),
  ]);
  // Rebuild the reply-median map keyed on the same normalized coach name we
  // group by, so "Stef" and "stef" both find their gaps.
  const replyMedian = new Map<string, number | null>();
  for (const [k, v] of Object.entries(replyMedianByRaw)) replyMedian.set(norm(k), v);
  const lastEod = new Map<string, string | null>();
  for (const [k, v] of Object.entries(lastEodByRaw)) lastEod.set(norm(k), v);

  const byCoach = new Map<string, {
    clients: number;
    atRisk: number;
    repliesOwed: number;
    pastEnd: number;
  }>();
  for (const c of hub.clients) {
    const k = c.coach?.trim() || "Unassigned";
    const b = byCoach.get(k) ?? { clients: 0, atRisk: 0, repliesOwed: 0, pastEnd: 0 };
    b.clients += 1;
    if (c.score.bucket === "at_risk") b.atRisk += 1;
    // Reply-owed count: client is waiting >= 2d and coach hasn't replied
    // more recently. hub.ts already exposes lastClientMessageAt on everfit +
    // lastCoachMessageDaysAgo on the client.
    if (c.everfit?.lastClientMessageAt) {
      const clientDaysAgo = Math.max(
        0,
        Math.floor((Date.now() - Date.parse(c.everfit.lastClientMessageAt)) / 86_400_000),
      );
      const coachDays = c.lastCoachMessageDaysAgo;
      if (
        clientDaysAgo >= 2 &&
        (coachDays === null || coachDays >= clientDaysAgo)
      ) {
        b.repliesOwed += 1;
      }
    }
    if (c.daysRemaining !== null && c.daysRemaining < 0) b.pastEnd += 1;
    byCoach.set(k, b);
  }

  const monthByCoach = new Map<string, { total: number; retained: number; lost: number; pct: number | null }>();
  for (const c of hub.monthRetention.byCoach) {
    monthByCoach.set(c.coach, { total: c.total, retained: c.retained, lost: c.lost, pct: c.pct });
  }

  const rows: CoachRow[] = [...byCoach.entries()].map(([coach, b]) => {
    const m = monthByCoach.get(coach) ?? { total: 0, retained: 0, lost: 0, pct: null };
    return {
      coach,
      clients: b.clients,
      atRisk: b.atRisk,
      repliesOwed: b.repliesOwed,
      replyHoursMedian: replyMedian.get(norm(coach)) ?? null,
      monthRetentionPct: m.pct,
      monthTotal: m.total,
      monthRetained: m.retained,
      monthLost: m.lost,
      pastEnd: b.pastEnd,
      lastEodDate: lastEod.get(norm(coach)) ?? null,
    };
  });

  // Rank: highest at-risk % first (worst coach on top), then most replies owed.
  rows.sort((a, b) => {
    const aRisk = a.clients > 0 ? a.atRisk / a.clients : 0;
    const bRisk = b.clients > 0 ? b.atRisk / b.clients : 0;
    return (
      bRisk - aRisk ||
      b.repliesOwed - a.repliesOwed ||
      a.coach.localeCompare(b.coach)
    );
  });
  return rows;
}
