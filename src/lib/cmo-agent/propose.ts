// CMO Agent - the proposal brain. Every proposal SHOWS ITS WORK: spend + ROAS across
// 7d/14d/30d, when the money was spent, whether the ad is still running, and the funnel -
// so Alex can trust it without opening Meta. The verdict reads the TREND across windows,
// never a single window (that's how you kill a winner that just had a slow week).
// Money comes only from canonical getAdsTrackerDashboard; all-time closes cross-check
// from the foundation. Canonical calls run SEQUENTIALLY (concurrent ones time out the DB).

import { getAdsTrackerDashboard } from "@/lib/ads-tracker/server";
import { getServiceSupabase } from "@/lib/supabase";
import { ACTIVE_CREATORS, type CreatorKey } from "@/lib/creators";

const CREATORS: CreatorKey[] = ACTIVE_CREATORS.map((c) => c.key);
const FUNDED_14D = 40;
const RELIABLE = 100;
const KILL_FLOOR = 150;
const SCALE_LTGP = 3;
const KILL_LTGP = 2;

type Win = { spend: number; revenue: number; roas: number; ltgp: number; closes: number; dms: number; cpm: number | null; booked: number; taken: number };

export type ProposalItem = {
  creator: string; kind: "scale" | "kill" | "watch" | "make_variations"; target: string;
  title: string; detail: string; suggestion: string; evidence: Record<string, unknown>;
  rule: string; priority: number;
};

const r0 = (n: unknown) => Math.round(Number(n) || 0);
const r2 = (n: unknown) => Number((Number(n) || 0).toFixed(2));
function todayET() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shiftDays(iso: string, delta: number) {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + delta * 86_400_000).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

async function moneyMap(account: CreatorKey, dateFrom: string, dateTo: string): Promise<Map<string, Win>> {
  const dash = await getAdsTrackerDashboard({ account, status: "all", level: "ad", dateFrom, dateTo });
  const m = new Map<string, Win>();
  for (const row of dash.adRoas ?? []) {
    const kw = String(row.label || "").trim().toLowerCase();
    if (!kw) continue;
    const prev = m.get(kw);
    const spend = (prev?.spend ?? 0) + (Number(row.adSpend) || 0);
    const revenue = (prev?.revenue ?? 0) + (Number(row.collectedRevenue) || 0);
    const closes = (prev?.closes ?? 0) + (Number(row.newClients) || 0);
    const dms = (prev?.dms ?? 0) + (Number(row.messages) || 0);
    const booked = (prev?.booked ?? 0) + (Number(row.bookedCalls) || 0);
    const taken = (prev?.taken ?? 0) + (Number(row.callsTaken) || 0);
    const gp = (prev ? prev.ltgp * prev.spend : 0) + (Number(row.grossProfitRoi) || 0) * (Number(row.adSpend) || 0);
    m.set(kw, { spend, revenue, closes, dms, booked, taken, roas: spend > 0 ? revenue / spend : 0, ltgp: spend > 0 ? gp / spend : 0, cpm: dms > 0 ? spend / dms : null });
  }
  return m;
}

export async function buildProposals(): Promise<ProposalItem[]> {
  const today = todayET();
  const sb = getServiceSupabase();
  const items: ProposalItem[] = [];

  for (const creator of CREATORS) {
    // spend recency + current status from raw Meta daily rows (last 31d)
    const { data: daily } = await sb
      .from("ads_meta_insights_daily")
      .select("keyword_normalized, date, spend_cents, ad_effective_status")
      .eq("client_key", creator)
      .gte("date", shiftDays(today, -31));
    const rec = new Map<string, { d3: number; lastSpend: string | null; status: string | null; statusDate: string | null }>();
    for (const row of daily ?? []) {
      const kw = String(row.keyword_normalized || "").trim().toLowerCase();
      if (!kw) continue;
      const cents = Number(row.spend_cents) || 0;
      const date = String(row.date);
      const cur = rec.get(kw) ?? { d3: 0, lastSpend: null, status: null, statusDate: null };
      if (daysBetween(date, today) <= 3) cur.d3 += cents;
      if (cents > 0 && (!cur.lastSpend || date > cur.lastSpend)) cur.lastSpend = date;
      if (!cur.statusDate || date > cur.statusDate) { cur.status = String(row.ad_effective_status || ""); cur.statusDate = date; }
      rec.set(kw, cur);
    }

    // foundation all-time closes (secondary winner cross-check - cheap)
    const { data: acRows } = await sb.from("ad_context").select("keyword_normalized, closed_count").eq("client_key", creator);
    const foundCloses = new Map<string, number>();
    for (const a of acRows ?? []) foundCloses.set(String(a.keyword_normalized).toLowerCase(), Number(a.closed_count) || 0);

    // canonical money across windows - SEQUENTIAL (concurrent dashboards time out the DB)
    const d7 = await moneyMap(creator, shiftDays(today, -7), today);
    const d14 = await moneyMap(creator, shiftDays(today, -14), today);
    const d30 = await moneyMap(creator, shiftDays(today, -30), today);

    const kws = new Set<string>();
    for (const [kw, w] of d14) if (w.spend >= FUNDED_14D) kws.add(kw);

    let topWinner: { kw: string; ltgp: number; closes: number } | null = null;

    for (const kw of kws) {
      const w7 = d7.get(kw) ?? null, w14 = d14.get(kw) ?? null, w30 = d30.get(kw) ?? null;
      const R = rec.get(kw) ?? { d3: 0, lastSpend: null, status: null, statusDate: null };
      const running = R.d3 > 0;
      const spend14 = w14?.spend ?? 0;
      const ltgp14 = w14?.ltgp ?? 0, ltgp7 = w7?.ltgp ?? 0, ltgp30 = w30?.ltgp ?? 0;
      const reliable = spend14 >= RELIABLE;
      // all-time = foundation lifetime count, floored by the canonical 30-day close count so it
      // can never read lower than a window shown on the card (that impossible contradiction).
      // Foundation's keyword-join undercounts some sales; canonical is the money truth, so the
      // wider of the two is the honest floor.
      const allCloses = Math.max(foundCloses.get(kw) ?? 0, w30?.closes ?? 0);
      const KW = kw.toUpperCase();

      const evidence = {
        running, status: R.status, lastSpend: R.lastSpend, spendLast3d: r0(R.d3 / 100),
        windows: {
          d7: w7 ? { spend: r0(w7.spend), roas: r2(w7.roas), ltgp: r2(w7.ltgp), closed: w7.closes } : null,
          d14: w14 ? { spend: r0(w14.spend), roas: r2(w14.roas), ltgp: r2(w14.ltgp), closed: w14.closes } : null,
          d30: w30 ? { spend: r0(w30.spend), roas: r2(w30.roas), ltgp: r2(w30.ltgp), closed: w30.closes, revenue: r0(w30.revenue) } : null,
        },
        funnel14d: w14 ? { dms: w14.dms, costPerDm: w14.cpm != null ? r2(w14.cpm) : null, booked: w14.booked, taken: w14.taken, closed: w14.closes } : null,
        allTimeCloses: allCloses,
      };

      // Plain-English "why" only - the numbers live in the hero, the bars, and the table.
      if (running && reliable && ltgp14 >= SCALE_LTGP && ltgp7 >= 2) {
        items.push({
          creator, kind: "scale", target: kw,
          title: `Scale ${KW} +$50/day`,
          detail: `${KW} is winning and it is holding steady, not just one hot week. Clear to step it up. Go small, +$50 a day, not a jump.`,
          suggestion: "Scale +$50/day, re-grade in 7 days.",
          evidence, rule: "LTGP:CAC is 3x or better on 14 days and 2x or better on 7 days, so it is holding, not a one-week spike. Scale a proven winner by +$50.", priority: 10,
        });
        if (!topWinner || ltgp14 > topWinner.ltgp) topWinner = { kw, ltgp: ltgp14, closes: allCloses };
      } else if (allCloses >= 2 && ltgp14 < KILL_LTGP) {
        items.push({
          creator, kind: "watch", target: kw,
          title: `Watch ${KW}, proven but cold`,
          detail: `${KW} is a proven winner that has gone quiet. It has closed real deals before, but nothing lately. Do not kill a proven ad on a cold streak. Give it a week, and if it does not turn around, then cut it.`,
          suggestion: "Hold and watch. Proven ad, just slow right now. Re-check in a week before any kill.",
          evidence, rule: "It has 2 or more closes all-time but the recent window is soft, so watch it. Never kill a proven ad on one slow window.", priority: 25,
        });
      } else if (running && reliable && spend14 >= KILL_FLOOR && ltgp14 < KILL_LTGP && ltgp30 < KILL_LTGP && allCloses <= 1) {
        items.push({
          creator, kind: "kill", target: kw,
          title: `Kill ${KW}`,
          detail: `${KW} is a money pit. It has spent real money and barely closed anyone, and it is weak no matter which window you look at. Cut it.`,
          suggestion: "Turn it off.",
          evidence, rule: "Weak on both the 14-day and 30-day windows, one or fewer closes ever, real money spent, still running. Kill it.", priority: 20,
        });
      } else if (reliable && ltgp14 >= KILL_LTGP && ltgp14 < SCALE_LTGP) {
        items.push({
          creator, kind: "watch", target: kw,
          title: `Watch ${KW}, on the line`,
          detail: `${KW} is sitting right on the line. Not strong enough to scale, not weak enough to kill. Let it prove itself.`,
          suggestion: "Hold and re-check in a few days.",
          evidence, rule: "LTGP:CAC is between 2x and 3x, right on the KPI line. Hold.", priority: 40,
        });
      }
    }

    if (topWinner) {
      items.push({
        creator, kind: "make_variations", target: topWinner.kw,
        title: `Make variations of ${topWinner.kw.toUpperCase()}`,
        detail: `${topWinner.kw.toUpperCase()} is ${creator}'s top ad right now. Clone the winning creative into fresh angles before it fatigues, so the winner line keeps producing.`,
        suggestion: "Generate 3 Higgsfield variations off the winning image.",
        evidence: { basis: "top LTGP:CAC winner", ltgp14d: r2(topWinner.ltgp), allTimeCloses: topWinner.closes },
        rule: "Keep the winner line producing.", priority: 30,
      });
    }
  }

  items.sort((a, b) => a.priority - b.priority || a.creator.localeCompare(b.creator));
  return items;
}
