// ─────────────────────────────────────────────────────────────────────────
// creative_bench: WHAT IS ON THE SHELF.
//
// The weekly kill/scale read answers "what should happen to what is running".
// It cannot answer the question that decides whether a tiring winner gets
// killed or replaced: IS THERE ANYTHING TO PUT IN ITS PLACE. That is a
// different inventory, it has never been written down anywhere, and its absence
// has real cost — relaunching a proven winner is the highest-hit-rate spend
// available, and two of them (LOADED, paused 24 July at 6x; STRENGTH, paused
// 7 August with fresh creative never tried) have been sitting unlooked-at.
//
// THREE SHELVES AND ONE ALARM, per creative_bench v1:
//   live                     what is delivering now, carried with the SAME
//                            72-hour fatigue measurement kill_scale_read uses.
//                            Imported, never re-derived: two implementations of
//                            that comparison would eventually disagree and the
//                            owner would have two fatigue readings for one ad.
//   paused_proven            not delivering now, but cleared the KPI line in a
//                            window where it also cleared the signed evidence
//                            floor. Paused and proven are different things: an
//                            ad that never cleared the line is not bench, it is
//                            history.
//   produced_never_launched  finished assets in the production stores that no
//                            launched ad's stored copy matches.
//   bench_thinness           a live ad at or above the KPI line with nothing
//                            waiting behind it. That is the condition under
//                            which a tiring winner has to be killed rather than
//                            replaced, and it is worth knowing BEFORE the day
//                            it bites.
//
// THIS ANSWER IS VERDICT-FREE, on purpose and by signature. It states facts and
// NAMES the signed decision tree those facts feed; it does not rank, rate or
// recommend, and it never says relaunch. A bench item carries the inputs the
// tree would want and says out loud which of them nothing in this system
// records — fresh_creative_tested being the standing example.
// ─────────────────────────────────────────────────────────────────────────

import { shiftDay, todayEt } from "@/lib/ads-v2/time";
import { copyRowsFor, creativeFreshness, transcriptRowsFor, videoAdIds } from "./ad-copy";
import { measureFatigue } from "./kill-scale";
import { leavesFor, type Leaf } from "./leaves";
import { optionalInt, rejectUnknown, requireClient, requireRange } from "./params";
import { CannotAnswer, loadRuleset, loadSignedDefinitions } from "./rulesets";
import { type AsOf, type QuestionEntry, type TemplateContext } from "./types";

type Row = Record<string, unknown>;

/** How far back the bench looks for a proven-but-paused ad. Six months: long
 *  enough to hold a creator's whole proven history at the cadence these
 *  accounts run, short enough that "proven" still means proven on the current
 *  offer and the current price book. */
const DEFAULT_LOOKBACK_DAYS = 180;

/** Normalised copy key for matching a produced asset to a launched ad. Case,
 *  punctuation and whitespace are stripped and the first 60 characters kept:
 *  enough that two ads with the same opening line match, tight enough that two
 *  different ads do not. */
function copyKey(text: string | null | undefined): string | null {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length >= 20 ? t.slice(0, 60) : null;
}

interface RunDates {
  days_live: number | null;
  first_active_day: string | null;
  last_active_day: string | null;
}

async function runDatesFor(ctx: TemplateContext, client: string): Promise<Map<string, RunDates>> {
  const { data, error } = await ctx.db.rpc("question_door_ad_run_dates", { p_client: client });
  if (error) throw new Error(`question_door_ad_run_dates failed for ${client}: ${error.message}`);
  const map = new Map<string, RunDates>();
  for (const r of (data || []) as Row[]) {
    map.set(String(r.ad_id), {
      days_live: r.days_live == null ? null : Number(r.days_live),
      first_active_day: (r.first_active_day as string) ?? null,
      last_active_day: (r.last_active_day as string) ?? null,
    });
  }
  return map;
}

/** What Meta says stopped this ad, read from its own effective status. The
 *  LEVEL matters operationally: an ad paused at campaign level did not lose an
 *  argument about its own performance, and treating those two as the same fact
 *  is how a good ad gets written off. */
function whyItStopped(adStatus: string | null, campaignStatus: string | null, last: string | null): string {
  const s = (adStatus || "").toUpperCase();
  const when = last ? ` Its last spending day was ${last}.` : "";
  if (s === "PAUSED") return `Paused at the AD level.${when}`;
  if (s === "ADSET_PAUSED") return `Still switched on itself, but its AD SET is paused, so it cannot deliver.${when}`;
  if (s === "CAMPAIGN_PAUSED")
    return `Still switched on itself, but its CAMPAIGN is paused, so it cannot deliver.${when} An ad stopped at campaign level was not necessarily stopped for its own performance.`;
  if (!s) return `Not delivering. Meta reports no status for it.${when}`;
  return `Not delivering. Meta reports status ${s}.${when}`;
}

export interface BenchItem {
  ad_id: string;
  keyword: string;
  ad_name_verbatim: string | null;
  adset_name_verbatim: string | null;
  campaign_name_verbatim: string | null;
  delivery_state: "active" | "not_active";
  spend_usd_cents: number;
  collected_usd_cents: number;
  collected_roi: number | null;
  dms: number;
  booked: number;
  closes: number;
  first_active_day: string | null;
  last_active_day: string | null;
  days_live: number | null;
  content_known: boolean;
  creative_type: "video" | "still" | "unknown";
}

export const creative_bench: QuestionEntry = {
  key: "creative_bench",
  description:
    "One creator's creative bench: what is live now with its fatigue measurement, which proven ads are sitting paused with their best prior window and what stopped them, which finished assets have been produced but never launched, and whether any live winner has an empty shelf behind it. Facts only; it names the signed decision tree and gives no verdict.",
  params:
    "client (tyson or jake), date_from and date_to (YYYY-MM-DD; optional, the LIVE window, defaulting to the trailing 14 days ending yesterday Eastern), lookback_days (30 to 365; how far back a paused ad may have proved itself, defaulting to 180).",
  sources: [
    "ads_meta_insights_daily",
    "adsv2_dm_facts",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "ad_creative_copy",
    "ad_creative_transcripts",
    "ad_creative_image",
    "factory_items",
    "registry_definitions",
  ],
  freshnessSources: ["adsv2_sale_facts", "ad_creative_copy", "ad_creative_transcripts"],
  budgetMs: 60_000,
  // Version 1. It reports cash per ad, so it carries the coverage block like
  // every other answer whose numbers trace to the stamped sale facts. Marked
  // directional for the same reason kill_scale_read is: a window ending inside
  // the sales lag is provisional however exact each number in it is.
  receipt: {
    version: 1,
    windowKind: "trailing_decision_window",
    money: true,
    usesDataVersion: true,
    certainty: "directional",
    exclusions: [
      {
        what: "creative assets that live only as files outside this system",
        count: 0,
        why: "the produced shelf reads the production stores in the database. A folder of images on someone's laptop is not visible to this door, and it is named as an unknown rather than counted as an empty shelf.",
      },
      {
        what: "whether fresh creative has already been tested on an ad",
        count: 0,
        why: "nothing in this system records it. It is reported as unrecorded per item rather than defaulted, because a default here would quietly decide the branch a reader lands on.",
      },
    ],
    definitionsCited: ["creative_bench", "verdict_floors_kill_tree", "structure_rules"],
  },
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "date_from", "date_to", "lookback_days"]);
    const client = await requireClient(ctx, params);
    const lookbackDays = optionalInt(params, "lookback_days", DEFAULT_LOOKBACK_DAYS, 30, 365);

    // ── Every threshold from the signed registry, none from code ──────────
    const { ruleset } = await loadRuleset(ctx.db, "zakk_v1");
    const benchDefs = await loadSignedDefinitions(ctx.db, ["creative_bench"]);
    const benchDef = benchDefs.get("creative_bench");
    if (!benchDef) {
      throw new CannotAnswer(
        ["creative_bench"],
        "the bench applies one rule of its own — what makes a paused ad PROVEN rather than merely paused — and that rule has to come from a signed definition rather than from code. creative_bench is missing or unsigned, so no shelves are being returned.",
      );
    }
    const provenMinRoi = Number(benchDef.details.paused_proven_min_collected_roi);
    if (!Number.isFinite(provenMinRoi)) {
      throw new CannotAnswer(
        ["creative_bench.details.paused_proven_min_collected_roi"],
        "the signed creative_bench definition does not carry the collected ROI a paused ad must have cleared to count as proven. Nothing was substituted.",
      );
    }

    let window: { from: string; to: string };
    if (params.date_from !== undefined || params.date_to !== undefined) {
      window = requireRange(params);
    } else {
      const yesterday = shiftDay(todayEt(ctx.now), -1);
      window = { from: shiftDay(yesterday, -13), to: yesterday };
    }
    const lookback = { from: shiftDay(window.to, -(lookbackDays - 1)), to: window.to };

    const [liveLeaves, historyLeaves, fatigue, runs] = await Promise.all([
      leavesFor(ctx.db, [client], window.from, window.to),
      leavesFor(ctx.db, [client], lookback.from, lookback.to),
      // THE SAME fatigue measurement kill_scale_read applies, imported from it.
      measureFatigue(ctx, [client], window.to),
      runDatesFor(ctx, client),
    ]);

    const isActive = (l: Leaf) => (l.ad_status || "").toUpperCase() === "ACTIVE";
    const live = liveLeaves.filter(isActive);
    const liveAdIds = new Set(live.map((l) => l.ad_id));

    // ── Who knows what these ads say ───────────────────────────────────────
    const allIds = [...new Set([...historyLeaves.map((l) => l.ad_id), ...live.map((l) => l.ad_id)].filter(Boolean))];
    const [copy, transcripts, videos] = await Promise.all([
      copyRowsFor(ctx, allIds),
      transcriptRowsFor(ctx, allIds),
      videoAdIds(ctx, allIds),
    ]);
    const creativeTypeOf = (id: string): BenchItem["creative_type"] =>
      videos.has(id) || transcripts.has(id) ? "video" : copy.get(id)?.extracted_at ? "still" : "unknown";
    const contentKnown = (id: string): boolean => {
      const t = transcripts.get(id);
      if (creativeTypeOf(id) === "video") return Boolean(t?.transcript_text?.trim() || t?.on_screen_text?.trim());
      return Boolean(copy.get(id)?.on_image_text?.trim());
    };

    const itemOf = (l: Leaf): BenchItem => {
      const run = runs.get(l.ad_id);
      return {
        ad_id: l.ad_id,
        keyword: l.keyword,
        ad_name_verbatim: l.ad_name,
        adset_name_verbatim: l.adset_name,
        campaign_name_verbatim: l.campaign_name,
        delivery_state: isActive(l) ? "active" : "not_active",
        spend_usd_cents: l.spend_cents,
        collected_usd_cents: l.collected_usd_cents,
        collected_roi: l.spend_cents > 0 ? Math.round((l.collected_usd_cents / l.spend_cents) * 100) / 100 : null,
        dms: l.messages,
        booked: l.booked,
        closes: l.new_clients,
        first_active_day: run?.first_active_day ?? null,
        last_active_day: run?.last_active_day ?? null,
        days_live: run?.days_live ?? null,
        content_known: contentKnown(l.ad_id),
        creative_type: creativeTypeOf(l.ad_id),
      };
    };

    // ── SHELF 1: LIVE ─────────────────────────────────────────────────────
    const liveShelf = live
      .map((l) => ({
        ...itemOf(l),
        fatigue: fatigue.get(l.ad_id) ?? null,
        fatigue_note:
          (fatigue.get(l.ad_id) ?? null) === null
            ? "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
            : "Measured over the last 72 hours against the 72 before them, per touch_floor_72h v1. The same measurement kill_scale_read applies, read from the same implementation.",
      }))
      .sort((a, b) => b.spend_usd_cents - a.spend_usd_cents);

    // ── SHELF 2: PAUSED PROVEN ────────────────────────────────────────────
    // Proven = cleared the signed ROI line in the lookback window, in which it
    // also cleared the signed evidence floor. Both numbers come from the
    // registry; neither is written here.
    const pausedProven = historyLeaves
      .filter((l) => !liveAdIds.has(l.ad_id))
      .filter((l) => l.spend_cents >= ruleset.evidenceFloorUsdCents)
      .filter((l) => l.collected_usd_cents / l.spend_cents >= provenMinRoi)
      .map((l) => {
        const item = itemOf(l);
        const f = fatigue.get(l.ad_id) ?? null;
        return {
          ...item,
          best_prior_window: {
            from: lookback.from,
            to: lookback.to,
            basis:
              "The whole lookback window. For an ad that is no longer delivering this is its entire run inside that window, which is what 'what it did when it ran' means. Spend and cash use the same window on both sides, per roi_window v1.",
          },
          why_it_stopped: whyItStopped(l.ad_status, l.campaign_status, item.last_active_day),
          signed_tree_inputs: {
            cited_definition: "verdict_floors_kill_tree v1, through ruleset zakk_v1",
            cleared_kpi_line_before: true,
            kpi_line_min_collected_roi: ruleset.kpiLineMinRoi,
            evidence_floor_usd_cents: ruleset.evidenceFloorUsdCents,
            fatigue: f,
            fatigue_note:
              f === null
                ? "Not measurable: this ad is not delivering, so the last 72 hours contain nothing to compare. Unmeasurable is not 'not fatiguing'."
                : "Measured, though the ad is not currently delivering.",
            fresh_creative_tested:
              "UNRECORDED. Nothing in this system records whether fresh creative has been tried on this ad. It is left unrecorded rather than defaulted, because in the signed tree this is the input that decides which branch an ad of this shape lands on.",
          },
        };
      })
      .sort((a, b) => (b.collected_roi ?? 0) - (a.collected_roi ?? 0));

    // ── SHELF 3: PRODUCED, NEVER LAUNCHED ─────────────────────────────────
    // Read from the production stores in this database. The match is honest and
    // its limits are stated: an asset counts as launched only when a launched
    // ad's STORED copy matches its text. Where an asset carries no usable text
    // the answer says the match could not be attempted rather than calling it
    // never-launched.
    const launchedKeys = new Set<string>();
    for (const r of copy.values()) {
      const a = copyKey(r.primary_text);
      const b = copyKey(r.on_image_text);
      if (a) launchedKeys.add(a);
      if (b) launchedKeys.add(b);
    }
    for (const r of transcripts.values()) {
      const a = copyKey(r.on_screen_text);
      const b = copyKey(r.transcript_text);
      if (a) launchedKeys.add(a);
      if (b) launchedKeys.add(b);
    }

    const { data: projectRows, error: projErr } = await ctx.db
      .from("factory_projects")
      .select("id, name, client");
    if (projErr) throw new Error(`could not read the production projects: ${projErr.message}`);
    const projects = ((projectRows || []) as Array<{ id: string; name: string; client: string | null }>).filter(
      (p) => (p.client || "").toLowerCase() === client || (p.name || "").toLowerCase().includes(client),
    );

    const produced: Array<Record<string, unknown>> = [];
    let producedMatched = 0;
    let producedUnmatchable = 0;
    if (projects.length) {
      const { data: itemRows, error: itemErr } = await ctx.db
        .from("factory_items")
        .select("id, project_id, label, bucket, style, stage, copy_text, image_url, asset_url, created_at")
        .in(
          "project_id",
          projects.map((p) => p.id),
        );
      if (itemErr) throw new Error(`could not read the produced creative: ${itemErr.message}`);
      const projectName = new Map(projects.map((p) => [p.id, p.name]));
      for (const r of (itemRows || []) as Array<Record<string, unknown>>) {
        const hasAsset = Boolean(r.image_url || r.asset_url);
        if (!hasAsset || String(r.stage || "") !== "completed") continue;
        const key = copyKey(r.copy_text as string | null);
        if (!key) {
          producedUnmatchable += 1;
          produced.push({
            factory_item_id: r.id,
            project: projectName.get(String(r.project_id)) ?? null,
            label: r.label,
            bucket: r.bucket,
            style: r.style,
            created_at: r.created_at,
            launched: "unknown",
            why: "this asset carries too little text to match against a launched ad's stored copy, so it is neither claimed as launched nor claimed as unlaunched.",
          });
          continue;
        }
        if (launchedKeys.has(key)) {
          producedMatched += 1;
          continue;
        }
        produced.push({
          factory_item_id: r.id,
          project: projectName.get(String(r.project_id)) ?? null,
          label: r.label,
          bucket: r.bucket,
          style: r.style,
          created_at: r.created_at,
          launched: "no_match_found",
          copy_opening: String(r.copy_text || "").slice(0, 140),
        });
      }
    }

    // ── THE ALARM: a live winner with nothing behind it ───────────────────
    const benchDepth = pausedProven.length + produced.filter((p) => p.launched === "no_match_found").length;
    const thinness = liveShelf
      .filter((a) => (a.collected_roi ?? 0) >= ruleset.kpiLineMinRoi && a.spend_usd_cents >= ruleset.evidenceFloorUsdCents)
      .filter(() => benchDepth === 0)
      .map((a) => ({
        ad_id: a.ad_id,
        keyword: a.keyword,
        collected_roi: a.collected_roi,
        flag: "live_winner_with_an_empty_bench",
        detail: `This ad is at or above the ${ruleset.kpiLineMinRoi}x KPI line and there is nothing proven or produced waiting behind it. When it tires there is nothing to swap to.`,
      }));

    const asOf: AsOf[] = await creativeFreshness(ctx, client);

    return {
      answers: {
        client,
        live_window: window,
        lookback_window: lookback,
        units: "Money is in USD CENTS. Collected ROI is a multiple.",
        thresholds_applied: {
          from: "registry_definitions, at answer time",
          paused_proven_min_collected_roi: provenMinRoi,
          kpi_line_min_collected_roi: ruleset.kpiLineMinRoi,
          evidence_floor_usd_cents: ruleset.evidenceFloorUsdCents,
          creative_bench_version: benchDef.version,
        },
        live: liveShelf,
        live_count: liveShelf.length,
        paused_proven: pausedProven,
        paused_proven_count: pausedProven.length,
        produced_never_launched: {
          items: produced.filter((p) => p.launched === "no_match_found"),
          count: produced.filter((p) => p.launched === "no_match_found").length,
          could_not_match: producedUnmatchable,
          matched_to_a_launched_ad: producedMatched,
          projects_read: projects.map((p) => p.name),
          how_this_was_counted:
            "Every finished asset in this creator's production projects was compared against the stored copy of every launched ad in the lookback. An asset counts as launched only when a launched ad's copy matches its opening text. no_match_found means nothing in the launched record matches it: that is strong evidence it was never run, not proof, because an ad launched with rewritten copy would not match.",
          what_this_cannot_see:
            "Creative that exists only as files outside this system. Those are invisible to this door and are named here rather than counted as an empty shelf.",
        },
        bench_thinness: thinness,
        bench_depth: benchDepth,
        what_this_is:
          "The standing inventory of what can be put in market, stated as facts. Nothing here ranks, rates or recommends. Where the signed decision tree would want an input this system does not record, the item says so instead of defaulting it.",
      },
      definitionKeys: ["spend", "collected", "collectedRoi", "messages", "booked", "newClients"],
      asOf,
      usedParams: { client, date_from: window.from, date_to: window.to, lookback_days: lookbackDays },
      window,
      registryDefinitionsCited: ["creative_bench", ruleset.definition.name, ...ruleset.components],
      note:
        "This is an inventory, not a decision. The bench states what exists and cites the signed tree those facts feed; the judgement belongs to whoever is reading it, under a ruleset they name.",
    };
  },
};
