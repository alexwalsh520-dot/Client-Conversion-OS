// Coach-level rollups for /coaching-v3/coaches.
//
// Purely derived from the hub read model plus the raw Everfit inbox messages
// (for median reply time). No writes.

import type { HubV3 } from "./hub";
import { loadEodTrackerFromSheet } from "./sheet-sync";

export interface CoachRow {
  coach: string;
  clients: number;
  /** Behavior-only at-risk (check-in < 60 or workout % < 40). Confirmed
   *  by MAS 2026-09-15. Replaces the composite score-bucket version. */
  atRisk: number;
  // Retention numbers come from the Sales Tracker (matches V1 exactly).
  monthRetentionCount: number;
  monthRetentionRevenue: number;
  monthRefundCount: number;
  monthRefundAmount: number;
  pastEnd: number;
  /** Last date the coach submitted a "Yes" in the EOD Tracker sheet. */
  lastEodDate: string | null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export async function coachRowsV3(hub: HubV3): Promise<CoachRow[]> {
  // EOD tracker now lives in the Admin Everfit Client Reports sheet as its
  // own tab ("EOD Tracker"). Columns are per-coach, cells are Yes/No per
  // date. We pick the newest date each coach marked Yes.
  const lastEodByCoachRaw = await loadEodTrackerFromSheet();
  const lastEod = new Map<string, string | null>();
  for (const [k, v] of Object.entries(lastEodByCoachRaw)) lastEod.set(norm(k), v);

  const byCoach = new Map<string, {
    clients: number;
    atRisk: number;
    pastEnd: number;
  }>();
  for (const c of hub.clients) {
    const k = c.coach?.trim() || "Unassigned";
    const b = byCoach.get(k) ?? { clients: 0, atRisk: 0, pastEnd: 0 };
    b.clients += 1;
    if (c.isAtRiskByBehavior) b.atRisk += 1;
    if (c.daysRemaining !== null && c.daysRemaining < 0) b.pastEnd += 1;
    byCoach.set(k, b);
  }

  const monthByCoach = new Map<string, typeof hub.monthRetention.byCoach[number]>();
  for (const c of hub.monthRetention.byCoach) monthByCoach.set(norm(c.coach), c);

  const rows: CoachRow[] = [...byCoach.entries()].map(([coach, b]) => {
    const m = monthByCoach.get(norm(coach));
    return {
      coach,
      clients: b.clients,
      atRisk: b.atRisk,
      monthRetentionCount: m?.retentionCount ?? 0,
      monthRetentionRevenue: m?.retentionRevenue ?? 0,
      monthRefundCount: m?.refundCount ?? 0,
      monthRefundAmount: m?.refundAmount ?? 0,
      pastEnd: b.pastEnd,
      lastEodDate: lastEod.get(norm(coach)) ?? null,
    };
  });

  // Rank: highest at-risk % first (worst coach on top), then most past-end,
  // then coach name for stability.
  rows.sort((a, b) => {
    const aRisk = a.clients > 0 ? a.atRisk / a.clients : 0;
    const bRisk = b.clients > 0 ? b.atRisk / b.clients : 0;
    return bRisk - aRisk || b.pastEnd - a.pastEnd || a.coach.localeCompare(b.coach);
  });
  return rows;
}
