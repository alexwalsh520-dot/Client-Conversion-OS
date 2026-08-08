// ─────────────────────────────────────────────────────────────────────────
// budget_map: every dial that is currently holding money, and what it actually
// spent.
//
// The question the owner asks out loud as "what am I running right now, and at
// what?". Before this existed it was answered by opening Ads Manager and
// reading four numbers off a screen, which is fine until the fifth one is
// missed. On 2026-08-08 the true answer was FIT $140, Revived Winners $100,
// Lead Magnet $100 and the vet-ICP test $100, totalling $440/day; that is the
// golden fixture this question is pinned against.
//
// TWO DELIBERATE DESIGN CHOICES, both written into the answer itself:
//
// 1. THIS IS SNAPSHOT-BASED, NOT LIVE. It reads the most recent
//    adsv2_budget_snapshots photo, which is taken on the sync. It therefore
//    reports what the dials were AS OF that photo, and it says when the photo
//    was taken and flags it when it is older than its operational threshold.
//    health_check owns the live read from the Meta API. Two questions, two
//    honest jobs: a snapshot question that pretended to be live would be the
//    worst of both, because a stale number that looks live is more dangerous
//    than one that admits its age.
//
// 2. EVERY DIAL IS RECONCILED TO YESTERDAY'S REAL SPEND. A dial nobody spent
//    against is a broken ad set wearing a healthy budget, and it is invisible
//    if you only read the dials. Meta may deliver up to 25% over a daily budget
//    on any given day and balance it out across the week, so spend inside that
//    band is normal and is reported as ok; outside it is flagged by name.
//
// Names are carried VERBATIM, exactly as Meta holds them, so the owner can
// reconcile this answer against Ads Manager by eye. Grouping and identity are
// always by entity_id, per structure_rules v1; the names are for humans only.
// ─────────────────────────────────────────────────────────────────────────

import { shiftDay, todayEt } from "@/lib/ads-v2/time";
import { leavesFor } from "./leaves";
import { rejectUnknown, requireAccount } from "./params";
import type { AsOf, Db, QuestionEntry } from "./types";

/**
 * Meta's daily-budget flex, as a percentage of the dial.
 *
 * THIS IS A PLATFORM BEHAVIOUR, NOT AN OWNER THRESHOLD, and the distinction is
 * why it is a named constant here rather than a registry read. Meta's own
 * documented delivery model permits spending up to 25% above a daily budget on
 * any single day, balancing across the calendar week. It is a fact about how
 * the ad platform bills, in the same category as "a day has 24 hours"; it is
 * not a decision Alex made and there is nothing for him to sign.
 *
 * It happens to coincide with ruleset_zakk's signed spend_pace_flag_pct, which
 * is a different thing wearing the same number: that one is the owner's
 * daily-watch flag. If the owner ever wants this band tuned independently, it
 * becomes a signed definition and this constant goes away.
 */
const META_DAILY_FLEX_PCT = 25;

/** How old a budget photo may be before this answer calls it stale, when
 *  door_freshness_thresholds carries no row for the snapshot table. */
const DEFAULT_SNAPSHOT_STALE_HOURS = 26;

interface SnapshotRow {
  client_key: string;
  entity_level: string;
  entity_id: string;
  entity_name: string | null;
  campaign_id: string | null;
  et_day: string;
  currency: string | null;
  daily_budget_cents: number | null;
  daily_budget_usd_cents: number | null;
  lifetime_budget_usd_cents: number | null;
  holds_budget: boolean;
  effective_status: string | null;
  synced_at: string | null;
}

/**
 * The most recent budget photo per creator, and only the entities that actually
 * hold a live dial.
 *
 * The photo day is resolved PER CREATOR rather than globally, because one
 * creator's sync can lag another's and taking a single global max would then
 * silently report an empty budget map for the lagging creator: a false zero,
 * which is the exact failure class this whole layer exists to kill.
 */
async function latestSnapshots(
  db: Db,
  clients: readonly string[],
): Promise<{ rows: SnapshotRow[]; photoDayByClient: Map<string, string> }> {
  const { data, error } = await db
    .from("adsv2_budget_snapshots")
    .select(
      "client_key, entity_level, entity_id, entity_name, campaign_id, et_day, currency, daily_budget_cents, daily_budget_usd_cents, lifetime_budget_usd_cents, holds_budget, effective_status, synced_at",
    )
    .in("client_key", [...clients])
    .order("et_day", { ascending: false })
    .limit(5000);
  if (error) throw new Error(`could not read the budget snapshots: ${error.message}`);

  const all = (data || []) as unknown as SnapshotRow[];
  const photoDayByClient = new Map<string, string>();
  for (const r of all) {
    const cur = photoDayByClient.get(r.client_key);
    if (!cur || r.et_day > cur) photoDayByClient.set(r.client_key, r.et_day);
  }
  const rows = all.filter((r) => r.et_day === photoDayByClient.get(r.client_key));
  return { rows, photoDayByClient };
}

/**
 * The first day a budget photo exists for each of the given entities.
 *
 * THE FALSE ALARM THIS KILLS: an ad set launched TODAY holds a live dial and
 * spent nothing yesterday, because yesterday it did not exist. Reported as
 * zero_delivery it looks identical to a funded ad set that has stopped
 * delivering, which is a real emergency. On 2026-08-08 Jake's "SCALING - US -
 * PROVEN (8/8)" was exactly this case: launched that morning, flagged as broken.
 *
 * A monitoring answer that cries wolf on every launch is one the owner learns
 * to skim, and then it is worth nothing on the day it is right.
 */
async function firstPhotoDays(db: Db, entityIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!entityIds.length) return out;
  const { data, error } = await db
    .from("adsv2_budget_snapshots")
    .select("entity_id, et_day")
    .in("entity_id", [...entityIds])
    .order("et_day", { ascending: true })
    .limit(10_000);
  if (error) throw new Error(`could not read the budget photo history: ${error.message}`);
  for (const r of (data || []) as Array<Record<string, unknown>>) {
    const id = String(r.entity_id);
    const day = String(r.et_day);
    const cur = out.get(id);
    if (!cur || day < cur) out.set(id, day);
  }
  return out;
}

/** The operational staleness threshold for the snapshot table, from the stored
 *  thresholds so ops can tune it without a deploy. */
async function snapshotThresholdHours(db: Db): Promise<{ hours: number; fromStore: boolean }> {
  try {
    const { data, error } = await db
      .from("door_freshness_thresholds")
      .select("source, threshold_hours")
      .eq("source", "adsv2_budget_snapshots")
      .maybeSingle();
    if (error) throw new Error(error.message);
    const h = Number((data as { threshold_hours?: number } | null)?.threshold_hours);
    if (Number.isFinite(h) && h > 0) return { hours: h, fromStore: true };
  } catch {
    // Falls through to the built-in default, which the answer names as such.
  }
  return { hours: DEFAULT_SNAPSHOT_STALE_HOURS, fromStore: false };
}

export const budget_map: QuestionEntry = {
  key: "budget_map",
  description:
    "Every entity currently holding a daily budget for one creator (or all of them): its verbatim Meta name, its id, whether the dial sits on the ad set or the campaign, the dollars per day, and its delivery status, reconciled against what it actually spent yesterday. Totals per creator and overall. Read from the most recent stored budget photo, whose age is reported and flagged when stale.",
  params: "client (tyson, jake, or all; defaults to all).",
  sources: ["adsv2_budget_snapshots", "ads_meta_insights_daily", "registry_entities"],
  freshnessSources: ["adsv2_budget_snapshots", "warehouse.ads"],
  budgetMs: 30_000,
  // Version 1. NOT a money answer in the coverage sense: it reports budgets and
  // spend, never sale cash, so there are no wins to bucket and a coverage block
  // would be a block about a population this answer never touches.
  receipt: {
    version: 1,
    windowKind: "budget_photo_day",
    money: false,
    usesDataVersion: true,
    certainty: "machine_certain",
    definitionsCited: ["structure_rules", "pricing_currency"],
    exclusions: [
      {
        what: "entities that hold no budget of their own",
        count: 0,
        why:
          "an ad set inside a campaign-budget (CBO) campaign has no dial to report; the campaign holds it and appears here instead. Nothing is double counted, and an entity is listed once, at the level that actually holds the money.",
      },
      {
        what: "budgets that are not currently delivering",
        count: 0,
        why:
          "a paused or archived entity still carries a budget field in Meta, but it is not money going out today. Only entities whose effective status is ACTIVE are in the totals, and the count of live-dial entities excluded for status is reported alongside.",
      },
    ],
  },
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account"]);
    const account = params.client === undefined && params.account === undefined
      ? "all"
      : await requireAccount(ctx, params);
    const clients = account === "all" ? [...ctx.clients] : [account];

    const yesterday = shiftDay(todayEt(ctx.now), -1);

    const [{ rows, photoDayByClient }, threshold, yesterdayLeaves] = await Promise.all([
      latestSnapshots(ctx.db, clients),
      snapshotThresholdHours(ctx.db),
      leavesFor(ctx.db, clients, yesterday, yesterday),
    ]);

    // Yesterday's real spend, per entity, at both levels. structure_rules v1:
    // grouped by id, never by name.
    const spendByAdset = new Map<string, number>();
    const spendByCampaign = new Map<string, number>();
    for (const l of yesterdayLeaves) {
      if (l.adset_id) spendByAdset.set(l.adset_id, (spendByAdset.get(l.adset_id) || 0) + l.spend_cents);
      if (l.campaign_id) spendByCampaign.set(l.campaign_id, (spendByCampaign.get(l.campaign_id) || 0) + l.spend_cents);
    }

    const holding = rows.filter((r) => r.holds_budget);
    const live = holding.filter((r) => (r.effective_status || "").toUpperCase() === "ACTIVE");
    const notLive = holding.length - live.length;

    const firstSeen = await firstPhotoDays(ctx.db, live.map((r) => r.entity_id));
    const nowMs = ctx.now.getTime();

    const entities = live.map((r) => {
      const dial = r.daily_budget_usd_cents;
      const spent =
        (r.entity_level === "campaign" ? spendByCampaign.get(r.entity_id) : spendByAdset.get(r.entity_id)) || 0;
      const pacePct = dial && dial > 0 ? Math.round((spent / dial) * 1000) / 10 : null;

      // ── The reconciliation verdict. ───────────────────────────────────
      const firstDay = firstSeen.get(r.entity_id) ?? null;
      // Did this entity even exist on the day being reconciled? An entity whose
      // first photo is after that day cannot have spent against it.
      const existedOnDay = firstDay !== null && firstDay <= yesterday;

      let reconciliation: string;
      let flagged: boolean;
      if (dial === null || dial <= 0) {
        reconciliation = "no_daily_dial_to_reconcile";
        flagged = false;
      } else if (!existedOnDay) {
        reconciliation = "too_new_to_reconcile";
        flagged = false;
      } else if (spent === 0) {
        reconciliation = "zero_delivery";
        flagged = true;
      } else if (pacePct !== null && pacePct > 100 + META_DAILY_FLEX_PCT) {
        reconciliation = "over_daily_flex";
        flagged = true;
      } else if (pacePct !== null && pacePct < 100 - META_DAILY_FLEX_PCT) {
        reconciliation = "under_delivering";
        flagged = true;
      } else {
        reconciliation = "ok";
        flagged = false;
      }

      const ageHours =
        r.synced_at && Number.isFinite(Date.parse(r.synced_at))
          ? Math.round(((nowMs - Date.parse(r.synced_at)) / 3_600_000) * 10) / 10
          : null;

      return {
        client: r.client_key,
        level: r.entity_level,
        entity_id: r.entity_id,
        // Meta's own name, carried exactly as stored so this reconciles to Ads
        // Manager by eye. Suffixed _verbatim because it is a proper noun the
        // platform assigned, not a word this answer chose.
        entity_name_verbatim: r.entity_name,
        campaign_id: r.campaign_id,
        daily_usd_cents: dial,
        // The dial as the OWNER set it, in the account's own billing currency.
        // Jake's account bills in AUD, so his USD figure is a conversion and his
        // native figure is the number he would see in Ads Manager. Showing only
        // one of the two has bitten this system before.
        daily_native_cents: r.daily_budget_cents,
        billing_currency: r.currency,
        lifetime_usd_cents: r.lifetime_budget_usd_cents,
        effective_status: r.effective_status,
        yesterday_spend_usd_cents: spent,
        pace_pct_of_dial: pacePct,
        reconciliation,
        flagged,
        photo_day: r.et_day,
        first_photo_day: firstDay,
        photo_taken_at: r.synced_at,
        photo_age_hours: ageHours,
        stale: ageHours === null ? true : ageHours > threshold.hours,
      };
    });

    entities.sort((a, b) => (b.daily_usd_cents || 0) - (a.daily_usd_cents || 0));

    const perCreator = clients.map((c) => {
      const mine = entities.filter((e) => e.client === c);
      return {
        client: c,
        photo_day: photoDayByClient.get(c) ?? null,
        entity_count: mine.length,
        total_daily_usd_cents: mine.reduce((s, e) => s + (e.daily_usd_cents || 0), 0),
        yesterday_spend_usd_cents: mine.reduce((s, e) => s + e.yesterday_spend_usd_cents, 0),
        flagged_count: mine.filter((e) => e.flagged).length,
        no_photo:
          photoDayByClient.get(c) === undefined
            ? "No budget photo exists for this creator at all, so their dials are unknown rather than zero. This is a capture gap, not an account with no spend."
            : null,
      };
    });

    const staleEntities = entities.filter((e) => e.stale);

    return {
      answers: {
        account,
        as_of_day: yesterday,
        units:
          "Money is in USD CENTS. daily_native_cents is in the ad account's own billing currency, named by billing_currency. pace_pct_of_dial is a percentage.",
        entities,
        per_creator: perCreator,
        total_daily_usd_cents: entities.reduce((s, e) => s + (e.daily_usd_cents || 0), 0),
        total_yesterday_spend_usd_cents: entities.reduce((s, e) => s + e.yesterday_spend_usd_cents, 0),
        entity_count: entities.length,
        flagged: entities.filter((e) => e.flagged).map((e) => ({
          entity_id: e.entity_id,
          entity_name_verbatim: e.entity_name_verbatim,
          reconciliation: e.reconciliation,
          daily_usd_cents: e.daily_usd_cents,
          yesterday_spend_usd_cents: e.yesterday_spend_usd_cents,
          pace_pct_of_dial: e.pace_pct_of_dial,
        })),
        reconciliation_rule: `Yesterday (${yesterday}) each dial is compared with what that entity actually spent. Meta may deliver up to ${META_DAILY_FLEX_PCT}% above a daily budget on any one day and balance it across the week, so anything from ${100 - META_DAILY_FLEX_PCT}% to ${100 + META_DAILY_FLEX_PCT}% of the dial reads as ok. Above that band is over_daily_flex, below it is under_delivering, and no spend at all against a live dial is zero_delivery. An entity whose first budget photo is later than ${yesterday} reads as too_new_to_reconcile and is NOT flagged: it did not exist on the day being reconciled, so it could not have spent, and reporting a launch as a delivery failure is how a monitoring answer teaches its reader to skim. That ${META_DAILY_FLEX_PCT}% is Meta's documented platform behaviour, NOT an owner-signed threshold; nothing here was decided by this system.`,
        staleness: {
          threshold_hours: threshold.hours,
          threshold_source: threshold.fromStore
            ? "door_freshness_thresholds, so ops can tune it without a deploy"
            : `no threshold row exists for adsv2_budget_snapshots, so this answer used its built-in default of ${DEFAULT_SNAPSHOT_STALE_HOURS} hours and is saying so rather than implying the number was configured`,
          stale_entity_count: staleEntities.length,
          note: staleEntities.length
            ? `${staleEntities.length} of ${entities.length} dials come from a photo older than the ${threshold.hours} hour threshold. They are reported with their real age rather than withheld, but they are not evidence of what the dials are RIGHT NOW.`
            : "Every dial here comes from a photo inside its freshness threshold.",
        },
        entities_excluded_for_status: notLive,
        what_this_is_not:
          "This is the most recent STORED budget photo, not a live read of Meta. It cannot see a change made in Ads Manager since the photo was taken, and it cannot see an entity that is stuck in review burning nothing. health_check answers that question, live from the Meta API, and is the one to ask before acting on a dial.",
      },
      definitionKeys: ["budget", "spend"],
      asOf: [] as AsOf[],
      usedParams: { client: account, date_from: yesterday, date_to: yesterday },
      window: { from: yesterday, to: yesterday },
      registryDefinitionsCited: ["structure_rules", "pricing_currency"],
    };
  },
};
