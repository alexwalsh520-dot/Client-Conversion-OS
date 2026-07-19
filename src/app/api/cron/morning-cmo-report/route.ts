import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getAdsTrackerDashboard } from "@/lib/ads-tracker/server";
import { postRichMessage } from "@/lib/slack";
import { ACTIVE_CREATORS, type CreatorKey } from "@/lib/creators";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Alex's daily CMO morning brief, posted to his Slack DM ~10:15 Bali (02:15 UTC).
// Money comes only from the canonical getAdsTrackerDashboard + the sales tracker. Active ads only.
const ALEX_DM = "U083ENKF9Q8";
// Derived from the registry (creators.ts `active`), never hardcoded.
const CREATORS: CreatorKey[] = ACTIVE_CREATORS.map((c) => c.key);

function etDate(offsetDays = 0): string {
  const base = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(base);
}
const money = (cents: number) => `$${Math.round((cents || 0) / 100).toLocaleString()}`;
const r2 = (n: number) => (Number(n) || 0).toFixed(2);

async function GETimpl() {
  const sb = getServiceSupabase();
  const today = etDate(0);
  const yesterday = etDate(-1);
  const monthStart = today.slice(0, 7) + "-01";
  // prior calendar month bounds
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const prevStart = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
  const prevEnd = monthStart;

  // ---- Money (sales tracker = canonical sales source) ----
  const { data: mtdRows } = await sb.from("sales_tracker_rows").select("collected_revenue_cents, date").gte("date", monthStart).lte("date", today);
  const mtd = (mtdRows || []).reduce((s, r) => s + (Number((r as { collected_revenue_cents: number }).collected_revenue_cents) || 0), 0);
  const mtdCloses = (mtdRows || []).filter((r) => Number((r as { collected_revenue_cents: number }).collected_revenue_cents) > 0).length;
  const ydayRows = (mtdRows || []).filter((r) => (r as { date: string }).date === yesterday);
  const yday = ydayRows.reduce((s, r) => s + (Number((r as { collected_revenue_cents: number }).collected_revenue_cents) || 0), 0);
  const ydayCloses = ydayRows.filter((r) => Number((r as { collected_revenue_cents: number }).collected_revenue_cents) > 0).length;
  const { data: prevRows } = await sb.from("sales_tracker_rows").select("collected_revenue_cents").gte("date", prevStart).lt("date", prevEnd);
  const prevTotal = (prevRows || []).reduce((s, r) => s + (Number((r as { collected_revenue_cents: number }).collected_revenue_cents) || 0), 0);
  const dayOfMonth = Number(today.slice(8, 10));
  const pace = Math.round((mtd / dayOfMonth) * 30);

  // ---- Ads scoreboard per creator (canonical, active, ad-level, last 7d) ----
  type Row = { label: string; adSpend: number; grossProfitRoi: number; collectedRoi: number; newClients: number };
  const perCreator: Record<string, { spend7: number; winners: Row[]; underKpi: Row[]; all: Row[] }> = {};
  for (const c of CREATORS) {
    try {
      const dash = await getAdsTrackerDashboard({ account: c, status: "active", level: "ad", dateFrom: etDate(-7), dateTo: today });
      const rows = ((dash.adRoas || []) as Row[]).filter((r) => (Number(r.adSpend) || 0) >= 40);
      const spend7 = rows.reduce((s, r) => s + (Number(r.adSpend) || 0), 0);
      const winners = rows.filter((r) => (Number(r.grossProfitRoi) || 0) >= 3).sort((a, b) => b.grossProfitRoi - a.grossProfitRoi);
      const underKpi = rows.filter((r) => (Number(r.grossProfitRoi) || 0) < 2).sort((a, b) => b.adSpend - a.adSpend);
      perCreator[c] = { spend7, winners, underKpi, all: rows };
    } catch {
      perCreator[c] = { spend7: 0, winners: [], underKpi: [], all: [] };
    }
  }

  // ---- Build the brief ----
  const paceVsPrev = prevTotal > 0 ? Math.round(((pace - prevTotal) / prevTotal) * 100) : 0;
  const blocks: unknown[] = [];
  blocks.push({ type: "header", text: { type: "plain_text", text: `CMO Morning Brief — ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" })}` } });

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: [
        `*Money*`,
        `This month: *${money(mtd)}* collected, ${mtdCloses} closes (day ${dayOfMonth}).`,
        `Yesterday: ${money(yday)}, ${ydayCloses} closes.`,
        `Pace: ~${money(pace)} for the month vs ${money(prevTotal)} last month (${paceVsPrev >= 0 ? "+" : ""}${paceVsPrev}%).`,
      ].join("\n"),
    },
  });

  for (const c of CREATORS) {
    const p = perCreator[c];
    const name = c.charAt(0).toUpperCase() + c.slice(1);
    const winLine = p.winners.length
      ? p.winners.map((w) => `${w.label.toUpperCase()} ${r2(w.grossProfitRoi)}x${w.newClients ? `, ${w.newClients} closes` : ""}`).join(", ")
      : "none over 3x";
    const underLine = p.underKpi.length
      ? p.underKpi.slice(0, 6).map((w) => `${w.label.toUpperCase()} ${r2(w.grossProfitRoi)}x`).join(", ")
      : "none";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${name} ads* (active, last 7d, ${money(p.spend7 * 100)} spend)`,
          `Winners (3x+ LTGP:CAC): ${winLine}`,
          `Under KPI (below 2x): ${underLine}`,
        ].join("\n"),
      },
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "_Money is from canonical attribution (same as your Ads tab). Active ads only, LTGP:CAC = real gross profit per ad dollar. Reply here and I will dig into any line._",
    },
  });

  const ok = await postRichMessage(ALEX_DM, blocks);
  return { ok, mtd: money(mtd), creators: Object.fromEntries(CREATORS.map((c) => [c, { spend7: perCreator[c].spend7, winners: perCreator[c].winners.length }])) };
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const res = await GETimpl();
    return NextResponse.json({ ...res, ranAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
