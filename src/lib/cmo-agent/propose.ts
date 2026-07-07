// CMO Agent — the proposal brain. Turns canonical per-ad numbers into a ranked list of
// money moves for Alex to JUDGE (never auto-executes). Money comes only from
// getAdsTrackerDashboard (canonical); this file applies the encoded decision rules.
//
// Rules (from cmo / ad-decisions / deep-dive memory):
//   trailing ~14d window (never naive short window) · LTGP:CAC is the truth metric
//   3×+ = protect/scale · ~2× = KPI line (watch) · sustained <2× past the $ floor = kill
//   ONLY judge ACTIVE ads · a historical winner on a slow patch is a WATCH, never a kill
//   never verdict a starved ad · keep the winner line producing (variations)

import { getAdsTrackerDashboard } from "@/lib/ads-tracker/server";
import { getServiceSupabase } from "@/lib/supabase";
import type { CreatorKey } from "@/lib/creators";

const CREATORS: CreatorKey[] = ["tyson", "antwan"];
const WINDOW_DAYS = 14;
const FUNDED_MIN = 30; // below this in the window, an ad is untested, not judged
const RELIABLE_MIN = 100; // canonical's MIN_SPEND_FOR_RELIABLE_ROAS — ROAS means something past this
const KILL_FLOOR = 150; // be conservative: only consider a kill once real money went in
const SCALE_LTGP = 3; // LTGP:CAC target floor to scale a winner
const KILL_LTGP = 2; // sustained below this = kill candidate
const HIST_WINNER_CLOSES = 2; // all-time closes that make an ad a proven winner (→ watch, not kill)

export type ProposalItem = {
  creator: string;
  kind: "scale" | "kill" | "watch" | "make_variations";
  target: string;
  title: string;
  detail: string;
  suggestion: string;
  evidence: Record<string, unknown>;
  rule: string;
  priority: number;
};

const d = (n: number | null | undefined) => Math.round(Number(n) || 0);
const x = (n: number | null | undefined) => {
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(1)}×` : "n/a";
};
function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shiftDays(isoDay: string, delta: number): string {
  return new Date(new Date(`${isoDay}T00:00:00Z`).getTime() + delta * 86_400_000).toISOString().slice(0, 10);
}

export async function buildProposals(): Promise<ProposalItem[]> {
  const dateTo = todayET();
  const dateFrom = shiftDays(dateTo, -WINDOW_DAYS);
  const sb = getServiceSupabase();
  const items: ProposalItem[] = [];

  for (const creator of CREATORS) {
    // all-time closes per keyword from the foundation — the "has this ever worked" cross-check
    const { data: acRows } = await sb.from("ad_context").select("keyword_normalized, closed_count").eq("client_key", creator);
    const histCloses = new Map<string, number>();
    for (const r of acRows ?? []) histCloses.set(String(r.keyword_normalized).toLowerCase(), Number(r.closed_count) || 0);

    // ONLY active ads — you can't kill a paused ad, and scaling only applies to what's running
    const dash = await getAdsTrackerDashboard({ account: creator, status: "active", level: "ad", dateFrom, dateTo });
    const rows = (dash.adRoas ?? []).filter((r) => (Number(r.adSpend) || 0) >= FUNDED_MIN);

    let topWinner: { kw: string; ltgp: number } | null = null;

    for (const r of rows) {
      const kw = String(r.label || "").trim();
      if (!kw) continue;
      const spend = Number(r.adSpend) || 0;
      const ltgp = Number(r.grossProfitRoi) || 0;
      const roas = Number(r.collectedRoi) || 0;
      const reliable = Boolean(r.roasReliable) || spend >= RELIABLE_MIN;
      const closes = Number(r.newClients) || 0;
      const allTime = histCloses.get(kw.toLowerCase()) ?? 0;
      const evidence = {
        window: `${WINDOW_DAYS}d`,
        spend: d(spend),
        collectedRevenue: d(r.collectedRevenue),
        collectedRoi: Number(roas.toFixed(2)),
        grossProfit: d(r.grossProfit),
        grossProfitRoi: Number(ltgp.toFixed(2)),
        newClients: closes,
        allTimeCloses: allTime,
        bookedCalls: Number(r.bookedCalls) || 0,
        callsTaken: Number(r.callsTaken) || 0,
        messages: Number(r.messages) || 0,
        costPerMessage: r.costPerMessage != null ? Number(Number(r.costPerMessage).toFixed(2)) : null,
        roasReliable: reliable,
      };

      if (reliable && ltgp >= SCALE_LTGP) {
        items.push({
          creator, kind: "scale", target: kw,
          title: `Scale ${kw.toUpperCase()} +$50/day`,
          detail: `${kw.toUpperCase()} is producing: ${x(ltgp)} LTGP:CAC on $${d(spend)} spend over ${WINDOW_DAYS}d, ${closes} new client${closes === 1 ? "" : "s"}. Clear to step it up — small (+$50), not a jump.`,
          suggestion: "Scale +$50/day, then re-grade in 7 days.",
          evidence, rule: "LTGP:CAC ≥3× and reliable → scale +$50", priority: 10,
        });
        if (!topWinner || ltgp > topWinner.ltgp) topWinner = { kw, ltgp };
      } else if (reliable && spend >= KILL_FLOOR && ltgp < KILL_LTGP && closes <= 1) {
        if (allTime >= HIST_WINNER_CLOSES) {
          // proven winner, slow lately — WATCH, do NOT propose a kill (avoids the naive-window trap)
          items.push({
            creator, kind: "watch", target: kw,
            title: `Watch ${kw.toUpperCase()} (slow lately)`,
            detail: `${kw.toUpperCase()} is soft this window (${x(ltgp)} LTGP:CAC on $${d(spend)}), but it has closed ${allTime} all-time — a proven ad on a slow patch, not a dud. Watch; sales lag 1-14 days so give it room before any kill.`,
            suggestion: "Hold and re-check in a few days (don't kill a proven ad on one slow window).",
            evidence, rule: "Soft window but historical winner → watch, never kill on one window", priority: 35,
          });
        } else {
          items.push({
            creator, kind: "kill", target: kw,
            title: `Kill ${kw.toUpperCase()}`,
            detail: `${kw.toUpperCase()} spent $${d(spend)} over ${WINDOW_DAYS}d at ${x(ltgp)} LTGP:CAC${evidence.costPerMessage ? `, $${evidence.costPerMessage} per DM` : ""}, ${closes} close${closes === 1 ? "" : "s"}, and ${allTime} all-time. Real money in, nothing out — a money pit.`,
            suggestion: "Turn it off.",
            evidence, rule: "Sustained <2× LTGP:CAC past the $ floor + never closed → kill", priority: 20,
          });
        }
      } else if (reliable && ltgp >= KILL_LTGP && ltgp < SCALE_LTGP) {
        items.push({
          creator, kind: "watch", target: kw,
          title: `Watch ${kw.toUpperCase()}`,
          detail: `${kw.toUpperCase()} is on the KPI line: ${x(ltgp)} LTGP:CAC on $${d(spend)}, ${closes} closed. Not a scale, not a kill — let it prove itself.`,
          suggestion: "Hold and re-check in a few days.",
          evidence, rule: "~2× LTGP:CAC = KPI line, hold", priority: 40,
        });
      }
    }

    if (topWinner) {
      items.push({
        creator, kind: "make_variations", target: topWinner.kw,
        title: `Make variations of ${topWinner.kw.toUpperCase()}`,
        detail: `${topWinner.kw.toUpperCase()} is ${creator}'s top ad (${x(topWinner.ltgp)} LTGP:CAC). Clone the winning creative into fresh angles now, before it fatigues, so the winner line keeps producing.`,
        suggestion: "Generate 3 Higgsfield variations off the winning image.",
        evidence: { basis: "top LTGP:CAC winner", grossProfitRoi: Number(topWinner.ltgp.toFixed(2)) },
        rule: "Keep the winner line producing", priority: 30,
      });
    }
  }

  items.sort((a, b) => a.priority - b.priority || a.creator.localeCompare(b.creator));
  return items;
}
