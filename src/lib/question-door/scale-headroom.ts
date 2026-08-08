// ─────────────────────────────────────────────────────────────────────────
// scale_headroom: where the money can go next, and when it is allowed to.
//
// The counterpart to the kill half of the weekly review. kill_scale_read finds
// what to switch off; this finds what has EARNED more, how much more, and on
// what date the step becomes legitimate.
//
// IT DERIVES NO RULES OF ITS OWN. The ladder arithmetic, the ROI at which
// budget becomes a floor rather than a cap, and the verdict for every ad and ad
// set all come from verdict-engine.ts under a named, versioned ruleset, exactly
// as decide mode computes them. This question adds three things the engine does
// not know about, and nothing else:
//
//   1. THE WEEKLY CADENCE GATE, which is the whole reason this question is
//      separate. scaling_ladder v1 says steps are WEEKLY, never daily and never
//      reactive mid-week. The engine can say "this ad set has earned $200/day";
//      only this question knows WHEN its dial last moved, and therefore whether
//      taking that step today would break the cadence. On 2026-08-08 both of
//      Tyson's strongest sets had been raised inside the previous five days,
//      and the honest answer was "not yet, here is the date".
//
//      The lesson is expensive and specific: the June over-scale to twelve ad
//      sets at $1,200/day crushed the book rate. Meaningful steps, weekly, one
//      at a time. A system that recommends a raise the day after the last raise
//      is a system that reproduces June.
//
//   2. SATURATION CEILINGS, which scaling_ladder v1 names ("respect proven
//      per-ad-set saturation ceilings") and carries one measured instance of:
//      FIT's $140/day. An ad set at its ceiling has earned nothing more, however
//      good its ROI, because we have already watched it stop converting above
//      that number.
//
//   3. THE PORTFOLIO ARITHMETIC: what the account's total daily spend becomes
//      if every step that is genuinely earned today is taken. A per-ad-set
//      recommendation nobody totals is how a $440/day account becomes a $900/day
//      account one reasonable-looking step at a time.
//
// Every recommendation is stamped `under_ruleset` and carries a `basis`, the
// same as decide mode, because a step is advice under a lens and not a fact.
// NOTHING HERE EXECUTES. It does not move a budget or touch Meta.
// ─────────────────────────────────────────────────────────────────────────

import { shiftDay, todayEt } from "@/lib/ads-v2/time";
import { leavesFor, type Leaf } from "./leaves";
import { optionalText, rejectUnknown, requireAccount, requireRange } from "./params";
import { CannotAnswer, DEFAULT_RULESET, KNOWN_RULESETS, loadRuleset, loadSignedDefinitions, loadWatchRules } from "./rulesets";
import { verdictForAd, verdictForAdSet, type AdVerdict, type Ruleset } from "./verdict-engine";
import type { AsOf, Db, QuestionEntry } from "./types";

const ACTIVE = "ACTIVE";

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─────────────────────────────────────────────────────────────────────────
// WHEN EACH DIAL LAST MOVED, from the stored budget photos.
// ─────────────────────────────────────────────────────────────────────────

interface DialHistory {
  /** The day the dial was last observed to CHANGE, or null when it has held the
   *  same value for the whole stored record. */
  last_change_day: string | null;
  /** The first day any photo exists for this entity. A "no change observed"
   *  answer is only as old as this, and the answer says so rather than implying
   *  the dial has never moved in its life. */
  first_photo_day: string | null;
  previous_daily_usd_cents: number | null;
  current_daily_usd_cents: number | null;
  photo_days: number;
}

/**
 * Walk each entity's budget photos in day order and find the last transition.
 *
 * THE HONESTY THIS FUNCTION IS CARRYING: the photo record starts when budget
 * snapshotting was switched on, not when the ad set was created. So "no change
 * observed" means "not in the record we have", and `first_photo_day` is
 * returned alongside every answer so a reader can see how far back that claim
 * actually reaches. Treating a short record as proof of a long-stable dial is
 * exactly the sort of quiet over-claim that turns into a wrong recommendation.
 */
async function dialHistories(db: Db, clients: readonly string[]): Promise<Map<string, DialHistory>> {
  const { data, error } = await db
    .from("adsv2_budget_snapshots")
    .select("entity_id, et_day, daily_budget_usd_cents, holds_budget")
    .in("client_key", [...clients])
    .eq("holds_budget", true)
    .order("et_day", { ascending: true })
    .limit(10_000);
  if (error) throw new Error(`could not read the budget photo history: ${error.message}`);

  const byEntity = new Map<string, Array<{ day: string; dial: number | null }>>();
  for (const r of (data || []) as Array<Record<string, unknown>>) {
    const id = String(r.entity_id);
    const dial = r.daily_budget_usd_cents == null ? null : Number(r.daily_budget_usd_cents);
    const list = byEntity.get(id) || [];
    list.push({ day: String(r.et_day), dial });
    byEntity.set(id, list);
  }

  const out = new Map<string, DialHistory>();
  for (const [id, list] of byEntity) {
    list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    let lastChange: string | null = null;
    let previous: number | null = null;
    for (let i = 1; i < list.length; i++) {
      if (list[i].dial !== list[i - 1].dial) {
        lastChange = list[i].day;
        previous = list[i - 1].dial;
      }
    }
    out.set(id, {
      last_change_day: lastChange,
      first_photo_day: list[0]?.day ?? null,
      previous_daily_usd_cents: previous,
      current_daily_usd_cents: list[list.length - 1]?.dial ?? null,
      photo_days: list.length,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// SATURATION CEILINGS, from the signed ladder.
// ─────────────────────────────────────────────────────────────────────────

interface Ceiling {
  daily_usd_cents: number;
  matched_on: string;
  basis: string;
}

/**
 * The per-ad-set saturation ceilings the registry actually carries.
 *
 * scaling_ladder v1 ends with "Respect proven per-ad-set saturation ceilings"
 * and its details carry exactly one measured instance:
 * `evidence.fit_ceiling_daily_cents` = 14000, Tyson's FIT ad set at $140/day.
 *
 * AN HONEST LIMITATION, STATED RATHER THAN ENGINEERED AROUND: that ceiling is
 * keyed in the registry by the WORD "fit", not by an adset_id, so binding it to
 * an entity means matching on the verbatim name. structure_rules v1 says group
 * by id and never by name, and this is the one place that rule cannot be
 * followed, because the signed data does not carry an id to follow it with.
 *
 * So the match is deliberately narrow (the name must START with the ceiling's
 * token, on a word boundary), every applied ceiling reports `matched_on` so a
 * reader can see exactly why it was applied, and the report logs the fix: the
 * ceiling should be re-signed keyed by adset_id. Until then a name match that
 * announces itself beats a ceiling silently ignored, because ignoring it is how
 * the $140 lesson gets paid for twice.
 */
function ceilingsFromLadder(details: Record<string, unknown>): Map<string, Ceiling> {
  const out = new Map<string, Ceiling>();
  const evidence = (details.evidence || {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(evidence)) {
    const m = /^(.+)_ceiling_daily_cents$/.exec(key);
    if (!m) continue;
    const cents = Number(value);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    const token = m[1].toLowerCase();
    out.set(token, {
      daily_usd_cents: cents,
      matched_on: token,
      basis: `scaling_ladder v1 details.evidence.${key}: a measured saturation ceiling of ${usd(cents)}/day for the "${token.toUpperCase()}" ad set. Applied by matching the verbatim ad set name, because the registry keys this ceiling by name and not by adset_id.`,
    });
  }
  return out;
}

/** Does this verbatim ad set name carry the ceiling's token as its leading
 *  word? Narrow on purpose: "FIT - Warm Audience Stack" matches "fit";
 *  "TEST - Fitness" does not. */
function ceilingFor(nameVerbatim: string | null, ceilings: Map<string, Ceiling>): Ceiling | null {
  if (!nameVerbatim) return null;
  const lead = nameVerbatim.trim().toLowerCase().split(/[^a-z0-9]+/)[0] || "";
  return ceilings.get(lead) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// THE QUESTION.
// ─────────────────────────────────────────────────────────────────────────

export const scale_headroom: QuestionEntry = {
  key: "scale_headroom",
  description:
    "Which ad sets have earned more budget, how much more, and when the raise is actually allowed. For every ad set that is at or above the KPI line it reports where it sits on the signed scaling ladder, the next earned step, the date that step becomes legitimate under the weekly cadence, any proven saturation ceiling in the way, and what the account's total daily spend becomes if every earned step is taken. A step is never emitted for a dial that moved inside the last seven days.",
  params:
    "client (tyson, jake, or all), date_from and date_to (YYYY-MM-DD; optional, defaults to the trailing 14 days ending yesterday Eastern), ruleset (defaults to zakk_v1).",
  sources: [
    "ads_meta_insights_daily",
    "adsv2_dm_facts",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "adsv2_budget_snapshots",
    "registry_definitions",
    "registry_entities",
  ],
  freshnessSources: ["adsv2_dm_facts", "adsv2_booking_facts", "adsv2_sale_facts", "adsv2_budget_snapshots"],
  budgetMs: 60_000,
  // Version 1. A money answer (it reports collected cash per ad set), so the
  // coverage block is required. Directional for the same reason decide mode is.
  receipt: {
    version: 1,
    windowKind: "trailing_decision_window",
    money: true,
    usesDataVersion: true,
    certainty: "directional",
    definitionsCited: [
      "scaling_ladder",
      "decision_cadence",
      "verdict_floors_kill_tree",
      "daily_run_rate",
      "roi_window",
      "sales_lag",
      "structure_rules",
      "unit_economics",
    ],
    exclusions: [
      {
        what: "ad sets below the KPI line",
        count: 0,
        why:
          "this question is about where money should GO. An ad set that has not earned its current budget is the kill read's subject, not this one's; ask kill_scale_read in decide mode for those.",
      },
      {
        what: "organic keyword traffic and rows still awaiting review",
        count: 0,
        why:
          "organic_keywords v1 keeps marked organic keywords out of ad ROAS, and an awaiting-review row is unclassified. Both are out of every ROI here, which understates the case for scaling rather than flattering it.",
      },
    ],
  },
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "date_from", "date_to", "ruleset"]);
    const account = await requireAccount(ctx, params);
    const clients = account === "all" ? [...ctx.clients] : [account];

    try {
      return await answer();
    } catch (err) {
      // The same threshold law kill_scale_read enforces: every number applied
      // here is signed, and a missing definition returns a named refusal rather
      // than a confident recommendation computed against a built-in default.
      // A wrong budget raise costs real money every day it stands.
      if (!(err instanceof CannotAnswer)) throw err;
      return {
        answers: {
          account,
          answered: false,
          cannot_answer: {
            missing: err.missing,
            why: err.message,
            what_to_do:
              "Sign the named definition (or add the named field to it) in registry_definitions, then ask again. No ladder step, cadence or ceiling was substituted from code, so there is no partial recommendation here to salvage.",
          },
        },
        asOf: [] as AsOf[],
        usedParams: { client: account },
        certainty: "cannot_answer" as const,
      };
    }

    async function answer(): ReturnType<QuestionEntry["run"]> {
      const rulesetKey = optionalText(params, "ruleset") || DEFAULT_RULESET;
      const { ruleset } = await loadRuleset(ctx.db, rulesetKey);

      // decision_cadence v1 owns the window length, exactly as decide mode does,
      // so the numbers a step is earned on are the numbers the kill read used.
      const watchRules = await loadWatchRules(ctx.db);
      let window: { from: string; to: string };
      if (params.date_from !== undefined || params.date_to !== undefined) {
        window = requireRange(params);
      } else {
        const yesterday = shiftDay(todayEt(ctx.now), -1);
        window = { from: shiftDay(yesterday, -(watchRules.decideWindowDays - 1)), to: yesterday };
      }

      // ── The cadence gate, read from the signed ladder. ─────────────────
      // scaling_ladder v1's step_cadence is the word "weekly"; the gate is the
      // seven days that word means. Anything other than weekly is refused
      // rather than guessed at, because inventing a cadence the owner did not
      // sign is precisely how a system starts raising budgets on its own.
      const cadence = String(ruleset.ladder.stepCadence || "").toLowerCase();
      if (cadence !== "weekly") {
        throw new CannotAnswer(
          ["scaling_ladder.details.step_cadence"],
          `the signed ladder's step cadence is "${ruleset.ladder.stepCadence}", and this answer only knows how to enforce a WEEKLY gate. No cadence was assumed. Sign a cadence this question understands, or extend it deliberately.`,
        );
      }
      const cadenceDays = 7;

      const [ladderDefs, leaves, histories] = await Promise.all([
        loadSignedDefinitions(ctx.db, ["scaling_ladder"]),
        leavesFor(ctx.db, clients, window.from, window.to),
        dialHistories(ctx.db, clients),
      ]);
      const ladderDef = ladderDefs.get("scaling_ladder");
      if (!ladderDef) {
        throw new CannotAnswer(
          ["scaling_ladder"],
          "the signed scaling_ladder definition could not be read, so neither the ladder nor its saturation ceilings are available. No step was computed.",
        );
      }
      const ceilings = ceilingsFromLadder(ladderDef.details);

      // structure_rules v1: live decisions cover ACTIVE ads only, grouped by id.
      const live = leaves.filter((l) => (l.ad_status || "").toUpperCase() === ACTIVE);

      // The current dial per entity, from the same photo history, so the ladder
      // reads the dial that the cadence gate is reasoning about.
      const dialOf = (id: string | null): number | null =>
        id ? (histories.get(id)?.current_daily_usd_cents ?? null) : null;

      // ── Roll up to ad sets and judge them with the ENGINE. ─────────────
      interface Group {
        adset_id: string;
        campaign_id: string | null;
        adset_name_verbatim: string | null;
        campaign_name_verbatim: string | null;
        client: string;
        spend: number;
        collected: number;
        closes: number;
        booked: number;
        leaves: Leaf[];
      }
      const groups = new Map<string, Group>();
      for (const l of live) {
        const id = l.adset_id || "(no ad set)";
        let g = groups.get(id);
        if (!g) {
          g = {
            adset_id: id,
            campaign_id: l.campaign_id,
            adset_name_verbatim: l.adset_name,
            campaign_name_verbatim: l.campaign_name,
            client: l.client_key,
            spend: 0,
            collected: 0,
            closes: 0,
            booked: 0,
            leaves: [],
          };
          groups.set(id, g);
        }
        g.spend += l.spend_cents;
        g.collected += l.collected_usd_cents;
        g.closes += l.new_clients;
        g.booked += l.booked;
        g.leaves.push(l);
      }

      const today = todayEt(ctx.now);
      const readings = [...groups.values()].map((g) => {
        const dial = dialOf(g.adset_id);
        const campaignDial = dialOf(g.campaign_id);
        const budgetLevel: "adset" | "campaign" | null =
          dial !== null ? "adset" : campaignDial !== null ? "campaign" : null;

        // The ad verdicts the ad-set rollup needs. Computed by the SAME engine
        // decide mode uses; this question does not judge an ad itself. Fatigue
        // and history are not read here, and the fields that depend on them are
        // set to the conservative value, which can only make the engine gentler:
        // a missing history cannot manufacture a scale recommendation, because
        // scaling turns on collected ROI alone.
        const adVerdicts: AdVerdict[] = g.leaves.map((l) =>
          verdictForAd(
            {
              ad_id: l.ad_id,
              keyword: l.keyword,
              adset_id: l.adset_id,
              spend_usd_cents: l.spend_cents,
              booked: l.booked,
              taken: l.taken_people,
              closes: l.new_clients,
              collected_usd_cents: l.collected_usd_cents,
              cost_per_call_target_usd_cents: 0,
              days_live: null,
              reached_2x_history: false,
              fatigue: null,
              fresh_creative_tested: false,
            },
            ruleset,
          ),
        );

        const verdict = verdictForAdSet(
          {
            adset_id: g.adset_id,
            adset_name_verbatim: g.adset_name_verbatim,
            campaign_id: g.campaign_id,
            spend_usd_cents: g.spend,
            collected_usd_cents: g.collected,
            closes: g.closes,
            booked: g.booked,
            daily_budget_usd_cents: dial ?? campaignDial,
            budget_level: budgetLevel,
            ad_verdicts: adVerdicts,
            sibling_active_adsets: 0,
          },
          ruleset,
        );

        return { g, dial: dial ?? campaignDial, budgetLevel, verdict };
      });

      // Only ad sets the engine says have earned something are this question's
      // subject. Everything else is reported as a count, not silently dropped.
      const earned = readings.filter((r) => r.verdict.scaling_headroom.eligible);
      const notEarned = readings.length - earned.length;

      const entries = earned.map(({ g, dial, budgetLevel, verdict }) => {
        const h = histories.get(g.adset_id) || null;
        const ceiling = ceilingFor(g.adset_name_verbatim, ceilings);
        const engineStep = verdict.scaling_headroom.next_step_usd_cents;

        // ── GATE 1: the weekly cadence. ─────────────────────────────────
        const lastChange = h?.last_change_day ?? null;
        const daysSinceChange =
          lastChange === null
            ? null
            : Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastChange}T00:00:00Z`)) / 86_400_000);
        const cadenceBlocked = daysSinceChange !== null && daysSinceChange < cadenceDays;
        const earliestStepDay = lastChange === null ? today : shiftDay(lastChange, cadenceDays);

        // ── GATE 2: the proven saturation ceiling. ──────────────────────
        const atOrAboveCeiling = ceiling !== null && dial !== null && dial >= ceiling.daily_usd_cents;
        const stepCappedByCeiling =
          ceiling !== null && engineStep !== null && engineStep > ceiling.daily_usd_cents && !atOrAboveCeiling;

        let step: number | null = engineStep;
        let emitted = true;
        const blockedBy: string[] = [];

        if (cadenceBlocked) {
          emitted = false;
          step = null;
          blockedBy.push("weekly_cadence");
        }
        if (atOrAboveCeiling) {
          emitted = false;
          step = null;
          blockedBy.push("saturation_ceiling");
        } else if (stepCappedByCeiling && emitted) {
          // Earned more than the ceiling allows: the step is the ceiling, not
          // the ladder's number. Still a real step, just a smaller one.
          step = ceiling!.daily_usd_cents;
        }

        const reasonParts: string[] = [];
        if (cadenceBlocked) {
          reasonParts.push(
            `scaling_ladder v${ladderDef.version} sets a ${cadence} step cadence, never reactive mid-week. This dial last moved on ${lastChange}${
              h?.previous_daily_usd_cents != null ? ` (${usd(h.previous_daily_usd_cents)} to ${usd(dial ?? 0)})` : ""
            }, ${daysSinceChange} day${daysSinceChange === 1 ? "" : "s"} ago, so no step is emitted today. The earliest legitimate step is ${earliestStepDay}.`,
          );
        }
        if (atOrAboveCeiling) {
          reasonParts.push(
            `This ad set is at or above its proven saturation ceiling of ${usd(ceiling!.daily_usd_cents)}/day (currently ${usd(dial ?? 0)}). ${ceiling!.basis} Above that number we have already watched it stop converting, so a good ROI does not earn it more budget.`,
          );
        } else if (stepCappedByCeiling) {
          reasonParts.push(
            `The ladder's next rung is ${usd(engineStep!)}/day but this ad set has a proven saturation ceiling of ${usd(ceiling!.daily_usd_cents)}/day, so the step is capped there. ${ceiling!.basis}`,
          );
        }
        if (lastChange === null && h) {
          reasonParts.push(
            `No dial change appears anywhere in this entity's stored budget photos, which start ${h.first_photo_day} (${h.photo_days} day${h.photo_days === 1 ? "" : "s"} of record). That is as far back as this claim reaches; it is not evidence the dial has never moved in its life.`,
          );
        }

        return {
          client: g.client,
          adset_id: g.adset_id,
          adset_name_verbatim: g.adset_name_verbatim,
          campaign_id: g.campaign_id,
          campaign_name_verbatim: g.campaign_name_verbatim,
          under_ruleset: ruleset.key,
          window_spend_usd_cents: g.spend,
          window_collected_usd_cents: g.collected,
          collected_roi: verdict.computed.collected_roi,
          closes: g.closes,
          booked: g.booked,
          current_daily_usd_cents: dial,
          budget_level: budgetLevel,
          ladder_position: verdict.scaling_headroom.basis,
          // What the ENGINE says has been earned, before this question's gates.
          engine_next_step_usd_cents: engineStep,
          // What is actually recommended TODAY, after the gates.
          step_emitted: emitted,
          recommended_daily_usd_cents: step,
          increase_usd_cents: emitted && step !== null && dial !== null ? step - dial : null,
          blocked_by: blockedBy,
          earliest_step_day: earliestStepDay,
          last_dial_change_day: lastChange,
          days_since_dial_change: daysSinceChange,
          dial_photo_record_starts: h?.first_photo_day ?? null,
          saturation_ceiling_usd_cents: ceiling?.daily_usd_cents ?? null,
          basis: [verdict.scaling_headroom.basis, ...reasonParts].join(" "),
        };
      });

      entries.sort((a, b) => (b.window_collected_usd_cents || 0) - (a.window_collected_usd_cents || 0));

      const stepped = entries.filter((e) => e.step_emitted && e.recommended_daily_usd_cents !== null);
      const currentTotal = readings.reduce((s, r) => s + (r.budgetLevel === "adset" ? r.dial || 0 : 0), 0);
      const addedTotal = stepped.reduce((s, e) => s + (e.increase_usd_cents || 0), 0);

      return {
        answers: {
          account,
          window,
          under_ruleset: ruleset.key,
          ruleset_definition: { name: ruleset.definition.name, version: ruleset.definition.version },
          units: "Money is in USD CENTS. Collected ROI is a multiple.",
          ladder: {
            launch_daily_usd_cents: ruleset.ladder.launchDailyUsdCents,
            bottom_rungs_usd_cents: ruleset.ladder.bottomLadderUsdCents,
            above_threshold_usd_cents: ruleset.ladder.aboveThresholdUsdCents,
            above_threshold_step_pct: ruleset.ladder.aboveThresholdStepPct,
            budget_is_floor_at_cash_roi: ruleset.ladder.budgetIsFloorAtCashRoi,
            step_cadence: ruleset.ladder.stepCadence,
            cadence_gate_days: cadenceDays,
          },
          ad_sets: entries,
          ad_sets_that_earned_nothing: notEarned,
          if_every_earned_step_is_taken: {
            steps_available_today: stepped.length,
            current_total_daily_usd_cents: currentTotal,
            added_daily_usd_cents: addedTotal,
            new_total_daily_usd_cents: currentTotal + addedTotal,
            note:
              "Only the steps that pass BOTH gates today are in this total. Steps blocked by the weekly cadence are not counted, because they are not available today; their earliest legitimate date is on each ad set.",
          },
          saturation_ceilings_known: [...ceilings.entries()].map(([token, c]) => ({
            token,
            daily_usd_cents: c.daily_usd_cents,
            basis: c.basis,
          })),
          the_cadence_rule: `scaling_ladder v${ladderDef.version}: steps are ${cadence}, never daily and never reactive mid-week. This question enforces that as a hard gate: an ad set whose dial moved fewer than ${cadenceDays} days ago gets NO step, however well it is performing, and the answer names the date the step becomes legitimate instead. The June over-scale to twelve ad sets at $1,200/day crushed the book rate; that is our own evidence for why this gate exists.`,
          what_this_is:
            `Advice under ruleset ${ruleset.key}, stamped as such. The ladder arithmetic and every verdict here come from the same engine kill_scale_read uses in decide mode; this question adds the weekly cadence gate, the proven saturation ceilings, and the portfolio total. A step is a recommendation under a lens, not a fact, and nothing here has been executed: no budget was moved and Meta was not touched.`,
        },
        definitionKeys: ["spend", "collected", "collectedRoi", "budget", "newClients", "booked"],
        asOf: [] as AsOf[],
        usedParams: { client: account, date_from: window.from, date_to: window.to, ruleset: rulesetKey },
        window,
        registryDefinitionsCited: [ruleset.definition.name, ...ruleset.components],
      };
    }
  },
};

/** Exported for the fixtures, which pin the ceiling matching and the dial-history
 *  walk with fixed inputs rather than through the whole door. */
export const __testables = { ceilingsFromLadder, ceilingFor, dialHistories };
