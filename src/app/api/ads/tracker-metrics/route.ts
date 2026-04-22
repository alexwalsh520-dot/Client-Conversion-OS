import { NextResponse } from "next/server";
import { fetchAdsDaily } from "@/lib/sheets";

const KEITH_SHEET_ID = "1DomGcRLp4NBV-nlXVq-zfq9vg8jPPNa1Wq4aalVr_Xk";
const TYSON_SHEET_ID = "1r7UXESjrCvqg3Uf0sm0GGlzKuKlkpUR1Z5RjHbcYmAY";

interface AggregatedRow {
  client: string;
  spend: number;
  impressions: number;
  linkClicks: number;
  messages: number;
  ctr: number;
  cpc: number;
  cpi: number;
  costPerMessage: number;
  calls60Booked: number;
  calls60Taken: number;
  showUpPct: number;
  newClients: number;
  closeRate: number;
  collectedRevenue: number;
  costPerClient: number;
  collectedRoi: number;
  hasData: boolean;
}

function emptyRow(client: string): AggregatedRow {
  return {
    client,
    spend: 0,
    impressions: 0,
    linkClicks: 0,
    messages: 0,
    ctr: 0,
    cpc: 0,
    cpi: 0,
    costPerMessage: 0,
    calls60Booked: 0,
    calls60Taken: 0,
    showUpPct: 0,
    newClients: 0,
    closeRate: 0,
    collectedRevenue: 0,
    costPerClient: 0,
    collectedRoi: 0,
    hasData: false,
  };
}

function aggregate(client: string, rows: { ad_spend: number; impressions: number; link_clicks: number; messages: number; calls_60_booked: number; calls_60_taken: number; new_clients: number; collected_revenue: number; date: string }[], monthPrefix: string): AggregatedRow {
  const inMonth = rows.filter((r) => r.date.startsWith(monthPrefix));
  if (inMonth.length === 0) return emptyRow(client);

  const spend = inMonth.reduce((s, r) => s + (r.ad_spend || 0), 0);
  const impressions = inMonth.reduce((s, r) => s + (r.impressions || 0), 0);
  const linkClicks = inMonth.reduce((s, r) => s + (r.link_clicks || 0), 0);
  const messages = inMonth.reduce((s, r) => s + (r.messages || 0), 0);
  const calls60Booked = inMonth.reduce((s, r) => s + (r.calls_60_booked || 0), 0);
  const calls60Taken = inMonth.reduce((s, r) => s + (r.calls_60_taken || 0), 0);
  const newClients = inMonth.reduce((s, r) => s + (r.new_clients || 0), 0);
  const collectedRevenue = inMonth.reduce((s, r) => s + (r.collected_revenue || 0), 0);

  return {
    client,
    spend,
    impressions,
    linkClicks,
    messages,
    ctr: impressions > 0 ? (linkClicks / impressions) * 100 : 0,
    cpc: linkClicks > 0 ? spend / linkClicks : 0,
    cpi: impressions > 0 ? (spend / impressions) * 1000 : 0,
    costPerMessage: messages > 0 ? spend / messages : 0,
    calls60Booked,
    calls60Taken,
    showUpPct: calls60Booked > 0 ? (calls60Taken / calls60Booked) * 100 : 0,
    newClients,
    closeRate: calls60Taken > 0 ? (newClients / calls60Taken) * 100 : 0,
    collectedRevenue,
    costPerClient: newClients > 0 ? spend / newClients : 0,
    collectedRoi: spend > 0 ? collectedRevenue / spend : 0,
    hasData: true,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month"); // YYYY-MM, optional

  const now = new Date();
  const monthPrefix =
    monthParam ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const [keithRows, tysonRows] = await Promise.all([
      fetchAdsDaily(KEITH_SHEET_ID, "keith").catch((e) => {
        console.error("[tracker-metrics] keith fetch failed:", e);
        return [];
      }),
      fetchAdsDaily(TYSON_SHEET_ID, "tyson").catch((e) => {
        console.error("[tracker-metrics] tyson fetch failed:", e);
        return [];
      }),
    ]);

    const rows: AggregatedRow[] = [
      aggregate("Keith", keithRows, monthPrefix),
      aggregate("Tyson", tysonRows, monthPrefix),
      emptyRow("Cold"),
    ];

    return NextResponse.json({ month: monthPrefix, rows });
  } catch (err) {
    console.error("[tracker-metrics] unexpected error:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Failed to load tracker metrics" },
      { status: 500 }
    );
  }
}
