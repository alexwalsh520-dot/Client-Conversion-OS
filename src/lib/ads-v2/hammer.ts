// ─────────────────────────────────────────────────────────────────────────
// HAMMER THEM — the operational read for the Hammer Them remarketing campaign.
//
// The hammer is an indirect campaign: it produces no DMs, calls, or sales of
// its own, so nothing here touches the attribution facts. What it has is
// INPUTS (spend, impressions, CPM, audience size) and ONE heartbeat number:
// impressions per person over a rolling 72 hours. That number comes straight
// from Meta's own frequency field over a 3-day time range, never from a
// division we do ourselves, so it cannot disagree with Ads Manager.
//
// The campaign is found by name ("Hammer Them"), newest first, on the Tyson ad
// account. Set HAMMER_CAMPAIGN_ID to pin one. No campaign = "not_launched" and
// the section shows the baseline only.
// ─────────────────────────────────────────────────────────────────────────

import { CREATORS_BY_KEY, firstEnv, normalizeAdAccountId } from "@/lib/creators";

const GRAPH = "https://graph.facebook.com/v21.0";
const CACHE_MS = 10 * 60 * 1000;

export type HammerStatus = "not_launched" | "live" | "paused";

export interface HammerDay {
  /** Ad-account day (Meta reports in the account's timezone, Pacific). */
  day: string;
  spendCents: number;
  impressions: number;
  reach: number;
  cpmCents: number | null;
  /** Meta's frequency over the 3 ad-account days ending this day. */
  freq72: number | null;
}

export interface HammerAudience {
  id: string;
  name: string;
  lower: number;
  upper: number;
  ready: boolean;
  deliveryNote: string;
}

export interface HammerPayload {
  status: HammerStatus;
  campaignId: string | null;
  campaignName: string | null;
  /** First ad-account day with spend (or the campaign start day). */
  launchDay: string | null;
  adsetsActive: number;
  adsetsTotal: number;
  dailyBudgetCents: number;
  audience: HammerAudience | null;
  /** The last 3 ad-account days as one window: Meta's own frequency. */
  last72: {
    from: string;
    to: string;
    spendCents: number;
    impressions: number;
    reach: number;
    frequency: number | null;
    cpmCents: number | null;
  } | null;
  /** Yesterday and today, so the card can show a daily run rate. */
  today: HammerDay | null;
  days: HammerDay[];
  checkedAt: string;
  error?: string;
}

interface GraphCampaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  start_time?: string;
  created_time: string;
}

interface GraphAdset {
  id: string;
  name: string;
  effective_status: string;
  daily_budget?: string;
  targeting?: { custom_audiences?: { id: string; name: string }[] };
}

interface GraphInsight {
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  cpm?: string;
}

let cache: { at: number; payload: HammerPayload } | null = null;

async function graph<T>(path: string, token: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${token}`, { cache: "no-store" });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || json.error) {
    throw new Error(`Meta ${res.status}: ${json.error?.message || "request failed"}`);
  }
  return json;
}

function cents(v: string | undefined): number {
  return Math.round(parseFloat(v || "0") * 100);
}

function num(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** YYYY-MM-DD in the ad account's timezone (Pacific for Tyson). */
function accountDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function empty(status: HammerStatus, error?: string): HammerPayload {
  return {
    status,
    campaignId: null,
    campaignName: null,
    launchDay: null,
    adsetsActive: 0,
    adsetsTotal: 0,
    dailyBudgetCents: 0,
    audience: null,
    last72: null,
    today: null,
    days: [],
    checkedAt: new Date().toISOString(),
    error,
  };
}

export async function readHammer(now: Date = new Date()): Promise<HammerPayload> {
  if (cache && now.getTime() - cache.at < CACHE_MS) return cache.payload;
  const payload = await readHammerUncached(now);
  if (!payload.error) cache = { at: now.getTime(), payload };
  return payload;
}

async function readHammerUncached(now: Date): Promise<HammerPayload> {
  const creator = CREATORS_BY_KEY.tyson;
  const token = firstEnv(creator.tokenEnv);
  const account = firstEnv(creator.adAccountEnv) || creator.defaultAdAccountId;
  if (!token || !account) return empty("not_launched", "Tyson Meta token or ad account is not configured.");
  const act = normalizeAdAccountId(account);

  try {
    // 1. Find the campaign.
    let campaign: GraphCampaign | null = null;
    const pinned = process.env.HAMMER_CAMPAIGN_ID;
    if (pinned) {
      campaign = await graph<GraphCampaign>(
        `${pinned}?fields=id,name,status,effective_status,start_time,created_time`,
        token,
      );
    } else {
      const filtering = encodeURIComponent(
        JSON.stringify([{ field: "name", operator: "CONTAIN", value: "Hammer Them" }]),
      );
      const list = await graph<{ data: GraphCampaign[] }>(
        `${act}/campaigns?fields=id,name,status,effective_status,start_time,created_time&filtering=${filtering}&limit=50`,
        token,
      );
      const candidates = (list.data || [])
        .filter((c) => c.effective_status !== "ARCHIVED" && c.effective_status !== "DELETED")
        .sort((a, b) => (a.created_time < b.created_time ? 1 : -1));
      campaign = candidates[0] || null;
    }
    if (!campaign) return empty("not_launched");

    // 2. Ad sets: how many are live, the daily budget, and the include audience.
    const adsets = await graph<{ data: GraphAdset[] }>(
      `${campaign.id}/adsets?fields=id,name,effective_status,daily_budget,targeting{custom_audiences}&limit=200`,
      token,
    );
    const sets = adsets.data || [];
    const active = sets.filter((s) => s.effective_status === "ACTIVE");
    const dailyBudgetCents = active.reduce((sum, s) => sum + parseInt(s.daily_budget || "0", 10), 0);
    const audienceId = sets.find((s) => s.targeting?.custom_audiences?.length)?.targeting?.custom_audiences?.[0]?.id;

    let audience: HammerAudience | null = null;
    if (audienceId) {
      const a = await graph<{
        id: string;
        name: string;
        approximate_count_lower_bound?: number;
        approximate_count_upper_bound?: number;
        delivery_status?: { code: number; description: string };
      }>(
        `${audienceId}?fields=name,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status`,
        token,
      );
      audience = {
        id: a.id,
        name: a.name,
        lower: a.approximate_count_lower_bound ?? 0,
        upper: a.approximate_count_upper_bound ?? 0,
        ready: a.delivery_status?.code === 200,
        deliveryNote: a.delivery_status?.description || "",
      };
    }

    // 3. Daily insights for the last 14 ad-account days, plus Meta's frequency
    //    over each trailing 3-day window for the last 7 days.
    const to = accountDay(now);
    const from = shift(to, -13);
    const daily = await graph<{ data: GraphInsight[] }>(
      `${campaign.id}/insights?time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}&time_increment=1&fields=spend,impressions,reach,frequency,cpm`,
      token,
    );
    const byDay = new Map<string, GraphInsight>();
    for (const r of daily.data || []) byDay.set(r.date_start, r);

    const windowDays = Array.from({ length: 7 }, (_, i) => shift(to, -6 + i));
    const windows = await Promise.all(
      windowDays.map((d) =>
        graph<{ data: GraphInsight[] }>(
          `${campaign!.id}/insights?time_range=${encodeURIComponent(JSON.stringify({ since: shift(d, -2), until: d }))}&fields=spend,impressions,reach,frequency,cpm`,
          token,
        ).then((r) => r.data?.[0] || null),
      ),
    );
    const freqByDay = new Map<string, number | null>();
    windowDays.forEach((d, i) => freqByDay.set(d, num(windows[i]?.frequency)));

    const days: HammerDay[] = [];
    for (let i = 0; i < 14; i++) {
      const d = shift(from, i);
      const r = byDay.get(d);
      days.push({
        day: d,
        spendCents: cents(r?.spend),
        impressions: parseInt(r?.impressions || "0", 10),
        reach: parseInt(r?.reach || "0", 10),
        cpmCents: r?.cpm ? cents(r.cpm) : null,
        freq72: freqByDay.get(d) ?? null,
      });
    }
    const last = windows[windows.length - 1];
    const firstSpendDay = days.find((d) => d.spendCents > 0)?.day || null;
    const launchDay = firstSpendDay || (campaign.start_time ? accountDay(new Date(campaign.start_time)) : null);
    const isLive = campaign.effective_status === "ACTIVE" && active.length > 0;

    return {
      status: isLive ? "live" : "paused",
      campaignId: campaign.id,
      campaignName: campaign.name,
      launchDay,
      adsetsActive: active.length,
      adsetsTotal: sets.length,
      dailyBudgetCents,
      audience,
      last72: last
        ? {
            from: shift(to, -2),
            to,
            spendCents: cents(last.spend),
            impressions: parseInt(last.impressions || "0", 10),
            reach: parseInt(last.reach || "0", 10),
            frequency: num(last.frequency),
            cpmCents: last.cpm ? cents(last.cpm) : null,
          }
        : null,
      today: days[days.length - 1] || null,
      days,
      checkedAt: now.toISOString(),
    };
  } catch (err) {
    return empty("not_launched", err instanceof Error ? err.message : "Meta read failed");
  }
}
