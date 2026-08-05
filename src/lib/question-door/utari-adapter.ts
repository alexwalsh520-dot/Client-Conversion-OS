// ─────────────────────────────────────────────────────────────────────────
// UTARI, THROUGH THE FRONT DOOR.
//
// Utari is Jeremy's agent and its tool contract is his dependency, so this file
// changes what FEEDS those tools, not what they look like. The per-ad funnel
// used to come from the v1 ads-tracker snapshot; it now comes from
// warehouse.answers through the question door, which is the same row the Ads v2
// tab paints from.
//
// TWO THINGS ARE PRESERVED ON PURPOSE, because changing them silently would be
// the worst kind of break:
//   FIELD NAMES stay exactly as they were.
//   UNITS stay exactly as they were. The old snapshot reported spend and cash
//   in DOLLARS; the warehouse stores CENTS. Every money field is converted back
//   to dollars here so a number that used to read 240.09 does not start
//   reading 24009.
//
// ONE THING HONESTLY CHANGES, and it is written into the response itself:
// gross_profit and gross_profit_roas came from v1's unit-economics model, which
// the warehouse's saved answers do not carry. They are returned as null with a
// note saying why, rather than being invented here.
// ─────────────────────────────────────────────────────────────────────────

import { rangeForPreset, todayEt } from "@/lib/ads-v2/time";
import { askQuestion } from "./service";
import { isRefusal, type DoorAnswer, type Db } from "./types";

/** Cents to dollars, rounded to the cent, matching the old snapshot's rounding. */
function dollars(cents: unknown): number {
  const n = Number(cents) || 0;
  return Math.round(n) / 100;
}

function ratio(v: unknown, places = 3): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export interface UtariAd {
  keyword: string | null;
  status: string | null;
  ad_id: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  spend: number;
  dms: number;
  booked_calls: number;
  calls_taken: number;
  show_rate: number | null;
  closes: number;
  close_rate: number | null;
  cash_collected: number;
  gross_profit: null;
  roas: number | null;
  gross_profit_roas: null;
  cost_per_dm: number | null;
  cost_per_booked_call: number | null;
  impressions: number | null;
  cpm: number | null;
  last_status_day: string | null;
  audience_type: string | null;
  is_advantage: boolean | null;
  age: string | null;
  on_image_text: string | null;
}

export interface UtariAdsResult {
  ads: UtariAd[];
  window: { dateFrom: string; dateTo: string; computedAt: string } | null;
  /** Present only when the door refused; the caller passes it straight on. */
  refused?: string;
  as_of?: unknown;
  definitions_quoted?: unknown;
}

/**
 * The canonical per-ad funnel for one creator, now read from the saved answers.
 * The window is the last thirty Eastern-time days, which the tab keeps warm, and
 * it is reported in the response so a caller always knows what period it has.
 */
export async function canonicalAdsFromDoor(
  db: Db,
  client: string,
  liveExtrasByKeyword: Record<string, Record<string, unknown>> = {},
): Promise<UtariAdsResult> {
  const range = rangeForPreset("last30", todayEt());
  const result = await askQuestion(
    {
      question_key: "metric_value",
      params: {
        client,
        date_from: range.from,
        date_to: range.to,
        status: "all",
        scope: "per_ad",
      },
    },
    { db, caller: "utari" },
  );
  if (isRefusal(result)) {
    return { ads: [], window: null, refused: result.reason };
  }
  const answer = result as DoorAnswer;
  const a = answer.answers as {
    saved_at: string;
    ads?: Array<Record<string, unknown>>;
  };

  const ads: UtariAd[] = (a.ads || []).map((r) => {
    const kw = r.keyword == null ? null : String(r.keyword);
    const st = (kw && liveExtrasByKeyword[kw.toLowerCase()]) || {};
    return {
      keyword: kw,
      status: (st.status as string) ?? (r.status as string) ?? null,
      ad_id: (r.ad_id as string) ?? null,
      campaign_name: (r.campaign as string) ?? null,
      adset_name: (r.ad_set as string) ?? null,
      spend: dollars(r.spend),
      dms: Number(r.messages) || 0,
      booked_calls: Number(r.booked) || 0,
      calls_taken: Number(r.taken) || 0,
      show_rate: ratio(r.showRate),
      closes: Number(r.newClients) || 0,
      close_rate: ratio(r.closeRate),
      cash_collected: dollars(r.collected),
      gross_profit: null,
      roas: ratio(r.collectedRoi, 2),
      gross_profit_roas: null,
      cost_per_dm: r.costPerMessage == null ? null : dollars(r.costPerMessage),
      cost_per_booked_call: r.costPerBooked == null ? null : dollars(r.costPerBooked),
      impressions: (st.impressions as number) ?? (Number(r.impressions) || 0),
      cpm: (st.cpm as number) ?? (r.cpm == null ? null : dollars(r.cpm)),
      last_status_day: (st.last_status_day as string) ?? null,
      audience_type: (st.audience_type as string) ?? null,
      is_advantage: (st.is_advantage as boolean) ?? null,
      age: st.age_min ? `${st.age_min}-${st.age_max}` : null,
      on_image_text: (st.on_image_text as string) ?? null,
    };
  });

  return {
    ads,
    window: { dateFrom: range.from, dateTo: range.to, computedAt: a.saved_at },
    as_of: answer.as_of,
    definitions_quoted: answer.definitions_quoted,
  };
}

/** The one-line note every repointed tool carries, so a reader knows where the
 *  numbers came from and what is honestly missing. */
export const UTARI_DOOR_NOTE =
  "These per-ad numbers now come from the saved answers the Ads v2 tab itself reads (warehouse.answers), through the locked question door, rather than from the older tracker snapshot. Field names and units are unchanged: spend, cash and cost-per figures are in DOLLARS. gross_profit and gross_profit_roas are null because they came from the v1 unit-economics model, which the saved answers do not carry; they are not being estimated here.";
