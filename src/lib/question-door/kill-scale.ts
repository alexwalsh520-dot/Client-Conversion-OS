// ─────────────────────────────────────────────────────────────────────────
// kill_scale_read: the weekly kill/scale decision, and the daily watch.
//
// This is the question the owner's Mondays actually run on. Before it existed,
// the weekly ad review was an improvised fifteen-query session whose numbers
// nobody could reproduce a week later. After it, it is one certified call.
//
// THREE MODES, and the split between them is the architectural point:
//
//   facts : the complete certified decision-inputs pack, with NO VERDICTS AT
//            ALL. This is what an external advisor (Jeremy AI, or a person)
//            consumes so it can reach its own conclusion. It must not lead the
//            witness: no verdict field, no recommendation, no vocabulary that
//            hints at one.
//   decide: the same facts PLUS verdicts computed under a NAMED, VERSIONED
//            ruleset, every one of them stamped `under_ruleset`. A verdict is
//            advice under a lens; the facts are the truth.
//   watch : the daily read. FLAGS ONLY, per decision_cadence v1: observation +
//            magnitude + duration + "monitor" or "queued for weekly decide".
//            It may not prescribe, and a unit test scans its output to prove it.
//
// WHERE THE NUMBERS COME FROM. Every funnel and spend number is read through
// `adsv2_window_leaves`, which is the SAME pre-aggregation the Ads v2 tab paints
// from. That is deliberate: a decision read that recomputed the funnel its own
// way would eventually disagree with the tab, and then the owner would have two
// numbers and no way to choose. Windowing it differently is allowed; reimplementing
// it is not.
//
// NOTHING HERE EXECUTES. It reads and it advises. It does not pause an ad, move
// a budget, or touch Meta in any way, not even to fix something obviously broken.
// ─────────────────────────────────────────────────────────────────────────

import { shiftDay, todayEt } from "@/lib/ads-v2/time";
import { leavesFor as readLeaves, type Leaf } from "./leaves";
import { optionalText, rejectUnknown, requireAccount, requireRange } from "./params";
import { CannotAnswer, DEFAULT_RULESET, KNOWN_RULESETS, loadRuleset, loadWatchRules } from "./rulesets";
import {
  verdictForAd,
  verdictForAdSet,
  type AdVerdict,
  type AdVerdictInput,
  type Ruleset,
} from "./verdict-engine";
import { BadParams, type AnswerExclusion, type AsOf, type QuestionEntry, type TemplateContext } from "./types";

type Row = Record<string, unknown>;

interface BudgetRow {
  entity_level: "campaign" | "adset";
  entity_id: string;
  campaign_id: string | null;
  daily_usd_cents: number | null;
  lifetime_usd_cents: number | null;
  holds: boolean;
  effective_status: string | null;
}

const ACTIVE = "ACTIVE";
const num = (v: unknown): number => Number(v) || 0;

/** Meta's documented daily-budget flex: it may deliver up to this share above a
 *  daily budget on one day and balance it across the week. A PLATFORM
 *  behaviour, not an owner-signed threshold, which is why it is a constant here
 *  and not a registry read. budget-map.ts states the same fact the same way. */
const META_DAILY_FLEX_PCT = 25;

/**
 * One windowed read of the certified leaf aggregation.
 *
 * The read itself moved to leaves.ts in Brick 6, when creator_funnel,
 * portfolio_pace and scale_headroom needed the same window. This stays as a
 * thin ctx-shaped wrapper so every call site below is unchanged and there is
 * still exactly ONE implementation of how a window is read.
 */
function leavesFor(
  ctx: TemplateContext,
  clients: readonly string[],
  from: string,
  to: string,
): Promise<Leaf[]> {
  return readLeaves(ctx.db, clients, from, to);
}

async function budgetsAsOf(ctx: TemplateContext, clients: readonly string[], to: string): Promise<BudgetRow[]> {
  const { data, error } = await ctx.db.rpc("adsv2_budget_asof", { p_clients: [...clients], p_to: to });
  if (error) throw new Error(`adsv2_budget_asof failed: ${error.message}`);
  return ((data || []) as Row[]).map((r) => ({
    entity_level: r.entity_level as "campaign" | "adset",
    entity_id: String(r.entity_id),
    campaign_id: (r.campaign_id as string) ?? null,
    daily_usd_cents: r.daily_usd_cents == null ? null : num(r.daily_usd_cents),
    lifetime_usd_cents: r.lifetime_usd_cents == null ? null : num(r.lifetime_usd_cents),
    holds: Boolean(r.holds),
    effective_status: (r.effective_status as string) ?? null,
  }));
}

/** Days an ad has actually spent, and its first and last spending day. */
async function runDates(ctx: TemplateContext, clients: readonly string[]): Promise<Map<string, Row>> {
  const map = new Map<string, Row>();
  for (const c of clients) {
    const { data, error } = await ctx.db.rpc("question_door_ad_run_dates", { p_client: c });
    if (error) throw new Error(`question_door_ad_run_dates failed for ${c}: ${error.message}`);
    for (const r of (data || []) as Row[]) map.set(String(r.ad_id), r);
  }
  return map;
}

/** The copy pointers for the ads in this read. Pointers, not copy: the words
 *  themselves belong to ad_setup, and duplicating them here would be two places
 *  for one truth. */
async function copyPointers(ctx: TemplateContext, adIds: string[]): Promise<Map<string, Row>> {
  const map = new Map<string, Row>();
  if (!adIds.length) return map;
  const { data, error } = await ctx.db
    .from("ad_creative_copy")
    .select("ad_id, client_key, primary_text, on_image_text, extracted_at")
    .in("ad_id", adIds);
  if (error) throw new Error(`could not read the ad copy pointers: ${error.message}`);
  for (const r of (data || []) as Row[]) map.set(String(r.ad_id), r);
  return map;
}

// ─────────────────────────────────────────────────────────────────────────
// PER-CREATOR ECONOMICS: the target cost per booked call.
//
// unit_economics + ruleset_zakk: the CAC target is a signed share of the
// standard ticket, and the target cost per BOOKED call is that CAC target
// multiplied by the creator's close rate. The close rate is measured, not
// assumed: trailing 90 days of ad-attributed taken calls and wins, from the
// same certified leaf aggregation everything else here reads.
//
// The floor matters. Under 20 taken calls, one close moves the rate by five
// points, so the per-creator number is noise wearing a decimal point. Below the
// floor this falls back to the account-wide rate AND SAYS SO, in a caveat the
// reader cannot miss, rather than quietly reporting a confident wrong target.
// ─────────────────────────────────────────────────────────────────────────

interface Economics {
  client: string;
  standard_ticket_usd_cents: number;
  cac_target_usd_cents: number;
  close_rate: number;
  close_rate_basis: string;
  close_rate_taken_calls: number;
  close_rate_wins: number;
  used_account_wide_close_rate: boolean;
  cost_per_call_target_usd_cents: number;
}

async function economicsFor(
  ctx: TemplateContext,
  clients: readonly string[],
  rs: Ruleset,
  selfDetails: Record<string, unknown>,
  endDay: string,
): Promise<{ byClient: Map<string, Economics>; caveats: string[] }> {
  const days = Number(selfDetails.close_rate_trailing_days);
  const floor = Number(selfDetails.close_rate_min_taken_calls);
  const cacPct = Number(selfDetails.cac_pct_of_ticket);
  const ticketKey = String(selfDetails.standard_ticket_price_book_key);
  if (!Number.isFinite(days) || !Number.isFinite(floor) || !Number.isFinite(cacPct)) {
    throw new CannotAnswer(
      [`${rs.definition.name}.details.close_rate_trailing_days/close_rate_min_taken_calls/cac_pct_of_ticket`],
      "the ruleset definition does not carry the close-rate basis or the CAC share of ticket this answer needs. No target cost per call was invented.",
    );
  }

  const from = shiftDay(endDay, -(days - 1));
  const trailing = await leavesFor(ctx, clients, from, endDay);

  // Ticket prices come from the creator's own registry row, so a creator on a
  // different price book is never judged against somebody else's ticket.
  const { data: entRows, error: entErr } = await ctx.db
    .from("registry_entities")
    .select("canonical_key, price_book")
    .in("canonical_key", [...clients]);
  if (entErr) throw new Error(`could not read the creator price books: ${entErr.message}`);
  const priceBooks = new Map<string, Record<string, unknown>>();
  for (const r of (entRows || []) as Row[]) {
    priceBooks.set(String(r.canonical_key), (r.price_book || {}) as Record<string, unknown>);
  }

  let allTaken = 0;
  let allWins = 0;
  for (const l of trailing) {
    allTaken += l.taken_people;
    allWins += l.new_clients;
  }
  const accountWide = allTaken > 0 ? allWins / allTaken : 0;

  const byClient = new Map<string, Economics>();
  const caveats: string[] = [];

  for (const c of clients) {
    let taken = 0;
    let wins = 0;
    for (const l of trailing) {
      if (l.client_key !== c) continue;
      taken += l.taken_people;
      wins += l.new_clients;
    }
    const enough = taken >= floor;
    const rate = enough ? (taken > 0 ? wins / taken : 0) : accountWide;
    if (!enough) {
      caveats.push(
        `${c} has ${taken} taken call${taken === 1 ? "" : "s"} in the trailing ${days} days, below the ${floor}-call floor at which a per-creator close rate means anything, so the account-wide rate of ${(accountWide * 100).toFixed(1)}% (${allWins} wins on ${allTaken} taken calls) was used to set the target cost per booked call instead. The target for ${c} is therefore a roster average, not a measurement of ${c}.`,
      );
    }

    const ticket = Number(priceBooks.get(c)?.[ticketKey]);
    if (!Number.isFinite(ticket)) {
      throw new CannotAnswer(
        [`registry_entities.${c}.price_book.${ticketKey}`],
        `${c} has no ${ticketKey} price in the registry, so the CAC target (${cacPct}% of the standard ticket) cannot be computed. No ticket price was assumed.`,
      );
    }
    const cac = Math.round((ticket * cacPct) / 100);
    // THE PUBLISHED NUMBERS MUST TIE OUT. The rate is rounded FIRST and the
    // target computed from the rounded value, so a reader who multiplies the
    // close rate on this answer by the CAC target on this answer gets the exact
    // target cost per call on this answer. Computing from full precision and
    // publishing a rounded rate was off by one cent, which is trivial money and
    // a real problem: a certified answer whose own arithmetic does not
    // reproduce teaches the reader to stop checking it.
    const closeRate = Math.round(rate * 10000) / 10000;
    byClient.set(c, {
      client: c,
      standard_ticket_usd_cents: ticket,
      cac_target_usd_cents: cac,
      close_rate: closeRate,
      close_rate_basis: `trailing ${days} days of ad-attributed taken calls and wins, ending ${endDay}. The target cost per booked call below is exactly this rate multiplied by the CAC target, so the arithmetic on this answer reproduces.`,
      close_rate_taken_calls: taken,
      close_rate_wins: wins,
      used_account_wide_close_rate: !enough,
      cost_per_call_target_usd_cents: Math.round(cac * closeRate),
    });
  }
  return { byClient, caveats };
}

// ─────────────────────────────────────────────────────────────────────────
// THE FATIGUE MEASUREMENT, in ONE place.
//
// touch_floor_72h v1 fixes the comparison at 72 hours sustained: two hours of
// bad data is not fatigue, one bad day is not fatigue. So it is measured as the
// last 72 hours against the 72 before them, and it is a FACT, not a verdict —
// what any ruleset makes of it is a separate question.
//
// Brick 7 pulled this out of computeShared and exported it so creative_bench
// can show the same fatigue block on a live ad WITHOUT re-deriving it. Two
// implementations of this comparison would eventually disagree, and then the
// owner would have two fatigue readings for one ad and no way to choose.
// ─────────────────────────────────────────────────────────────────────────

/** The 72-hour comparison, or null when either half had nothing to measure. */
export type FatigueMeasurement = {
  cost_per_result_rising: boolean;
  ctr_falling: boolean;
  sustained_hours: number;
  cost_per_dm_before_usd_cents: number;
  cost_per_dm_now_usd_cents: number;
  link_ctr_before: number;
  link_ctr_now: number;
} | null;

/** The two halves of the comparison, ending on `to` (inclusive, Eastern days). */
export function fatigueWindows(to: string): { recent: { from: string; to: string }; prior: { from: string; to: string } } {
  return {
    recent: { from: shiftDay(to, -2), to },
    prior: { from: shiftDay(to, -5), to: shiftDay(to, -3) },
  };
}

/**
 * The measurement itself. Null when either half had no traffic: an unmeasurable
 * signal is reported as unmeasurable, NEVER as "no fatigue". Those are
 * different facts and conflating them is how a tired winner gets killed.
 */
export function fatigueBetween(recent: Leaf | undefined, prior: Leaf | undefined): FatigueMeasurement {
  if (!recent || !prior) return null;
  if (recent.messages === 0 || prior.messages === 0 || recent.impressions === 0 || prior.impressions === 0) return null;
  const cprNow = Math.round(recent.spend_cents / recent.messages);
  const cprBefore = Math.round(prior.spend_cents / prior.messages);
  const ctrNow = recent.clicks / recent.impressions;
  const ctrBefore = prior.clicks / prior.impressions;
  return {
    cost_per_result_rising: cprNow > cprBefore,
    ctr_falling: ctrNow < ctrBefore,
    sustained_hours: 72,
    cost_per_dm_before_usd_cents: cprBefore,
    cost_per_dm_now_usd_cents: cprNow,
    link_ctr_before: Math.round(ctrBefore * 100000) / 100000,
    link_ctr_now: Math.round(ctrNow * 100000) / 100000,
  };
}

/** The fatigue block per ad, read straight from the certified aggregation.
 *  This is the entry point for anything outside kill_scale_read. */
export async function measureFatigue(
  ctx: TemplateContext,
  clients: readonly string[],
  to: string,
): Promise<Map<string, FatigueMeasurement>> {
  const w = fatigueWindows(to);
  const [recent, prior] = await Promise.all([
    leavesFor(ctx, clients, w.recent.from, w.recent.to),
    leavesFor(ctx, clients, w.prior.from, w.prior.to),
  ]);
  const recentByAd = new Map(recent.map((l) => [l.ad_id, l]));
  const priorByAd = new Map(prior.map((l) => [l.ad_id, l]));
  const out = new Map<string, FatigueMeasurement>();
  for (const id of new Set([...recentByAd.keys(), ...priorByAd.keys()])) {
    out.set(id, fatigueBetween(recentByAd.get(id), priorByAd.get(id)));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// THE SHARED COMPUTATION. Every mode reads this; none of them recompute it.
// ─────────────────────────────────────────────────────────────────────────

interface AdFact {
  ad_id: string;
  keyword: string;
  client: string;
  adset_id: string | null;
  campaign_id: string | null;
  /** Meta's own names, carried verbatim so a reader can reconcile to Ads
   *  Manager by eye. Suffixed _verbatim because they are proper nouns the
   *  platform assigned, not words this answer chose. */
  ad_name_verbatim: string | null;
  adset_name_verbatim: string | null;
  campaign_name_verbatim: string | null;
  delivery_state: "active" | "not_active";
  spend_usd_cents: number;
  daily_run_rate_usd_cents: number;
  impressions: number;
  clicks: number;
  link_ctr: number | null;
  dms: number;
  booked: number;
  taken: number;
  shown: number;
  closes: number;
  collected_usd_cents: number;
  collected_roi: number | null;
  cost_per_dm_usd_cents: number | null;
  cost_per_booked_call_usd_cents: number | null;
  days_live: number | null;
  first_active_day: string | null;
  last_active_day: string | null;
  cost_per_call_target_usd_cents: number;
  /**
   * The fatigue MEASUREMENT: the last 72 hours against the 72 before them.
   *
   * This is a FACT, not a verdict, so it belongs in the pack every mode returns
   * and is computed the same way for all three. touch_floor_72h v1 fixes the
   * comparison at 72 hours sustained ("two hours of bad data is not fatigue;
   * one bad day is not fatigue"), so it is measured over 72 hours here and fed
   * into the 14-day decision, rather than being read off the shape of the
   * 14-day window itself. Null when either side of the comparison had no
   * traffic to measure.
   */
  fatigue: FatigueMeasurement;
  history: {
    reached_kpi_line_before: boolean;
    best_prior_roi: number | null;
    best_prior_window: string | null;
    basis: string;
  };
  copy_pointer: {
    ad_creative_copy_ad_id: string | null;
    has_primary_text: boolean;
    has_on_image_text: boolean;
    extracted_at: string | null;
  };
}

interface Shared {
  window: { from: string; to: string };
  runRateWindow: { from: string; to: string };
  clients: string[];
  ads: AdFact[];
  adsets: Array<{
    adset_id: string;
    campaign_id: string | null;
    adset_name_verbatim: string | null;
    campaign_name_verbatim: string | null;
    client: string;
    spend_usd_cents: number;
    dms: number;
    booked: number;
    taken: number;
    shown: number;
    closes: number;
    collected_usd_cents: number;
    collected_roi: number | null;
    daily_budget_usd_cents: number | null;
    budget_level: "adset" | "campaign" | null;
    ad_ids: string[];
  }>;
  budgetMap: {
    entities: Array<{
      level: "campaign" | "adset";
      entity_id: string;
      campaign_id: string | null;
      daily_usd_cents: number | null;
      delivery_state: "active" | "not_active";
      yesterday_spend_usd_cents: number;
      pace_pct_of_budget: number | null;
    }>;
    mismatches: Array<{ what: string; entity_id: string; detail: string }>;
    total_daily_usd_cents: number;
    yesterday: string;
  };
  economics: Economics[];
  closes_named: Array<{
    adset_id: string | null;
    keyword: string;
    prospect: string | null;
    sale_day: string;
    collected_usd_cents: number;
    closer: string | null;
  }>;
  economicsCaveats: string[];
  exclusions: AnswerExclusion[];
}

const HISTORY_BLOCKS = 3;

async function computeShared(
  ctx: TemplateContext,
  clients: string[],
  window: { from: string; to: string },
  rs: Ruleset,
  selfDetails: Record<string, unknown>,
  opts: { activeOnly: boolean; withHistory: boolean },
): Promise<Shared> {
  const yesterday = window.to;
  const runRateWindow = { from: shiftDay(window.to, -6), to: window.to };

  // touch_floor_72h v1 fixes the fatigue comparison at 72 hours sustained, so
  // both halves of it are read here, for every mode. The measurement is a fact;
  // what any ruleset makes of it is not. The windows and the maths both come
  // from the one exported implementation above.
  const { recent: recentWindow, prior: priorWindow } = fatigueWindows(window.to);

  const [main, runRate, budgets, runs, econ, recent, prior] = await Promise.all([
    leavesFor(ctx, clients, window.from, window.to),
    leavesFor(ctx, clients, runRateWindow.from, runRateWindow.to),
    budgetsAsOf(ctx, clients, window.to),
    runDates(ctx, clients),
    economicsFor(ctx, clients, rs, selfDetails, window.to),
    leavesFor(ctx, clients, recentWindow.from, recentWindow.to),
    leavesFor(ctx, clients, priorWindow.from, priorWindow.to),
  ]);
  const recentByAd = new Map(recent.map((l) => [l.ad_id, l]));
  const priorByAd = new Map(prior.map((l) => [l.ad_id, l]));

  /** The 72-hour fatigue measurement for one ad, from the one implementation
   *  of it. Null when either half had nothing to measure. */
  const fatigueFor = (adId: string): FatigueMeasurement =>
    fatigueBetween(recentByAd.get(adId), priorByAd.get(adId));

  // structure_rules v1: active means status ACTIVE, and paused history is out of
  // a LIVE decision unless history is explicitly asked for. Grouping is by
  // adset_id and ad_id, never by name.
  const isActive = (l: Leaf) => (l.ad_status || "").toUpperCase() === ACTIVE;
  const kept = opts.activeOnly ? main.filter(isActive) : main;
  const excludedByStatus = main.length - kept.length;

  const runRateByAd = new Map<string, number>();
  for (const l of runRate) runRateByAd.set(l.ad_id, l.spend_cents);

  // ── History: has this ad ever cleared the KPI line before this window? ──
  // Read as prior trailing blocks of the same length, so "before" is measured
  // the same way "now" is rather than against a differently-shaped window.
  const history = new Map<string, { roi: number; label: string }>();
  if (opts.withHistory) {
    const span = Math.max(1, Math.round((Date.parse(window.to) - Date.parse(window.from)) / 86_400_000) + 1);
    for (let i = 1; i <= HISTORY_BLOCKS; i++) {
      const to = shiftDay(window.from, -1 - span * (i - 1));
      const from = shiftDay(to, -(span - 1));
      for (const l of await leavesFor(ctx, clients, from, to)) {
        if (l.spend_cents < rs.evidenceFloorUsdCents) continue;
        const roi = l.collected_usd_cents / l.spend_cents;
        const prev = history.get(l.ad_id);
        if (!prev || roi > prev.roi) history.set(l.ad_id, { roi, label: `${from} to ${to}` });
      }
    }
  }

  const adIds = [...new Set(kept.map((l) => l.ad_id).filter(Boolean))];
  const copy = await copyPointers(ctx, adIds);

  const ads: AdFact[] = kept.map((l) => {
    const e = econ.byClient.get(l.client_key)!;
    const sevenDay = runRateByAd.get(l.ad_id) ?? 0;
    const h = history.get(l.ad_id);
    const c = copy.get(l.ad_id);
    const run = runs.get(l.ad_id) || {};
    return {
      ad_id: l.ad_id,
      keyword: l.keyword,
      client: l.client_key,
      adset_id: l.adset_id,
      campaign_id: l.campaign_id,
      ad_name_verbatim: l.ad_name,
      adset_name_verbatim: l.adset_name,
      campaign_name_verbatim: l.campaign_name,
      delivery_state: isActive(l) ? "active" : "not_active",
      spend_usd_cents: l.spend_cents,
      // daily_run_rate v1: last-7-day pace. Never a calendar average.
      daily_run_rate_usd_cents: Math.round(sevenDay / 7),
      impressions: l.impressions,
      clicks: l.clicks,
      link_ctr: l.impressions > 0 ? Math.round((l.clicks / l.impressions) * 100000) / 100000 : null,
      dms: l.messages,
      booked: l.booked,
      taken: l.taken_people,
      shown: l.showed_people,
      closes: l.new_clients,
      collected_usd_cents: l.collected_usd_cents,
      collected_roi: l.spend_cents > 0 ? Math.round((l.collected_usd_cents / l.spend_cents) * 100) / 100 : null,
      cost_per_dm_usd_cents: l.messages > 0 ? Math.round(l.spend_cents / l.messages) : null,
      cost_per_booked_call_usd_cents: l.booked > 0 ? Math.round(l.spend_cents / l.booked) : null,
      days_live: run.days_live == null ? null : Number(run.days_live),
      first_active_day: (run.first_active_day as string) ?? null,
      last_active_day: (run.last_active_day as string) ?? null,
      cost_per_call_target_usd_cents: e.cost_per_call_target_usd_cents,
      fatigue: fatigueFor(l.ad_id),
      history: {
        reached_kpi_line_before: Boolean(h && h.roi >= rs.kpiLineMinRoi),
        best_prior_roi: h ? Math.round(h.roi * 100) / 100 : null,
        best_prior_window: h?.label ?? null,
        basis: opts.withHistory
          ? `the ${HISTORY_BLOCKS} trailing windows of the same length immediately before this one, counting only windows where the ad cleared the ${rs.evidenceFloorUsdCents / 100} dollar evidence floor`
          : "history was not read for this mode",
      },
      copy_pointer: {
        ad_creative_copy_ad_id: c ? String(c.ad_id) : null,
        has_primary_text: Boolean(c?.primary_text),
        has_on_image_text: Boolean(c?.on_image_text),
        extracted_at: (c?.extracted_at as string) ?? null,
      },
    };
  });

  // ── Ad-set rollup, grouped by adset_id per structure_rules v1. ──────────
  const budgetByEntity = new Map<string, BudgetRow>();
  for (const b of budgets) budgetByEntity.set(b.entity_id, b);

  const adsetMap = new Map<string, Shared["adsets"][number]>();
  for (const a of ads) {
    const id = a.adset_id || "(no ad set)";
    let g = adsetMap.get(id);
    if (!g) {
      const b = budgetByEntity.get(id);
      const campaignBudget = a.campaign_id ? budgetByEntity.get(a.campaign_id) : undefined;
      g = {
        adset_id: id,
        campaign_id: a.campaign_id,
        adset_name_verbatim: a.adset_name_verbatim,
        campaign_name_verbatim: a.campaign_name_verbatim,
        client: a.client,
        spend_usd_cents: 0,
        dms: 0,
        booked: 0,
        taken: 0,
        shown: 0,
        closes: 0,
        collected_usd_cents: 0,
        collected_roi: null,
        daily_budget_usd_cents: b?.holds ? b.daily_usd_cents : campaignBudget?.holds ? campaignBudget.daily_usd_cents : null,
        budget_level: b?.holds ? "adset" : campaignBudget?.holds ? "campaign" : null,
        ad_ids: [],
      };
      adsetMap.set(id, g);
    }
    g.spend_usd_cents += a.spend_usd_cents;
    g.dms += a.dms;
    g.booked += a.booked;
    g.taken += a.taken;
    g.shown += a.shown;
    g.closes += a.closes;
    g.collected_usd_cents += a.collected_usd_cents;
    g.ad_ids.push(a.ad_id);
  }
  const adsets = [...adsetMap.values()].map((g) => ({
    ...g,
    collected_roi: g.spend_usd_cents > 0 ? Math.round((g.collected_usd_cents / g.spend_usd_cents) * 100) / 100 : null,
  }));
  adsets.sort((a, b) => b.spend_usd_cents - a.spend_usd_cents);

  // ── The budget map, reconciled to yesterday's ACTUAL spend. ─────────────
  const yesterdayLeaves = await leavesFor(ctx, clients, yesterday, yesterday);
  const spendByAdset = new Map<string, number>();
  const spendByCampaign = new Map<string, number>();
  for (const l of yesterdayLeaves) {
    if (l.adset_id) spendByAdset.set(l.adset_id, (spendByAdset.get(l.adset_id) || 0) + l.spend_cents);
    if (l.campaign_id) spendByCampaign.set(l.campaign_id, (spendByCampaign.get(l.campaign_id) || 0) + l.spend_cents);
  }
  const liveBudgets = budgets.filter((b) => b.holds && (b.effective_status || "").toUpperCase() === ACTIVE);
  const mismatches: Shared["budgetMap"]["mismatches"] = [];
  const entities = liveBudgets.map((b) => {
    const spent = (b.entity_level === "adset" ? spendByAdset.get(b.entity_id) : spendByCampaign.get(b.entity_id)) || 0;
    if (spent === 0) {
      mismatches.push({
        what: "budget_with_no_spend",
        entity_id: b.entity_id,
        detail: `${b.entity_level} ${b.entity_id} holds a live daily dial but recorded no spend at all on ${yesterday}.`,
      });
    } else if (b.daily_usd_cents && b.daily_usd_cents > 0) {
      // BRICK 6 FIX to a Brick 3 gap. The invariant this map is supposed to
      // keep is "every live dial either paced inside Meta's roughly 25% daily
      // flex, or it is surfaced": nothing silently unexplained. Only the
      // zero-spend case was ever pushed, so an entity delivering two thirds of
      // its dial fell through the gap and was reported as if it reconciled.
      //
      // Found by Brick 3's OWN live golden, which had never run in an
      // environment with database credentials, so it had never once been
      // checked against real pacing.
      const pacePct = (spent / b.daily_usd_cents) * 100;
      const drift = pacePct - 100;
      if (Math.abs(drift) > META_DAILY_FLEX_PCT) {
        mismatches.push({
          what: drift > 0 ? "spend_above_daily_flex" : "spend_below_daily_flex",
          entity_id: b.entity_id,
          detail: `${b.entity_level} ${b.entity_id} spent ${(spent / 100).toFixed(2)} USD on ${yesterday} against a ${(b.daily_usd_cents / 100).toFixed(2)} USD daily dial, ${
            Math.round(pacePct * 10) / 10
          }% of it. Meta may deliver up to ${META_DAILY_FLEX_PCT}% either side of a daily budget and balance across the week, so this is outside the band that reads as normal delivery.`,
        });
      }
    }
    return {
      level: b.entity_level,
      entity_id: b.entity_id,
      campaign_id: b.campaign_id,
      daily_usd_cents: b.daily_usd_cents,
      delivery_state: "active" as const,
      yesterday_spend_usd_cents: spent,
      pace_pct_of_budget: b.daily_usd_cents ? Math.round((spent / b.daily_usd_cents) * 1000) / 10 : null,
    };
  });
  const budgetedAdsets = new Set(liveBudgets.filter((b) => b.entity_level === "adset").map((b) => b.entity_id));
  const budgetedCampaigns = new Set(liveBudgets.filter((b) => b.entity_level === "campaign").map((b) => b.entity_id));
  for (const [adsetId, spent] of spendByAdset) {
    if (spent <= 0) continue;
    const l = yesterdayLeaves.find((x) => x.adset_id === adsetId);
    if (budgetedAdsets.has(adsetId)) continue;
    if (l?.campaign_id && budgetedCampaigns.has(l.campaign_id)) continue;
    mismatches.push({
      what: "spend_with_no_live_budget_row",
      entity_id: adsetId,
      detail: `ad set ${adsetId} spent ${(spent / 100).toFixed(2)} USD on ${yesterday}, but neither it nor its campaign has a live budget photo for that day. The dial it spent against is not in the record.`,
    });
  }

  // ── Named closes, so the owner can reconcile to the sales sheet by eye. ──
  const closesNamed = await namedCloses(ctx, clients, window.from, window.to, ads);

  const exclusions: AnswerExclusion[] = [
    {
      what: "ads carrying no keyword",
      count: 0,
      why:
        "the whole funnel in this system is joined by keyword, so an ad that never carried one has spend but no DMs, calls or cash that can be tied to it. Those ads are not in this read at all. Their spend is real and is visible in the Ads v2 tab's own totals.",
    },
    {
      what: "organic keyword traffic and rows still awaiting review",
      count: 0,
      why:
        "organic_keywords v1 forbids marked organic keywords from entering ad ROAS, and an awaiting-review row is one nobody has classified yet. Both are excluded from every number here, which understates the funnel rather than flattering it. The receipt's coverage block states the awaiting-review gap in wins and dollars.",
    },
  ];
  if (opts.activeOnly && excludedByStatus > 0) {
    exclusions.push({
      what: "ads not currently ACTIVE",
      count: excludedByStatus,
      why:
        "structure_rules v1 keeps paused history out of a live decision unless history is explicitly asked for. These ads still spent inside the window; they are excluded because a decision is about what is running now.",
    });
  }

  return {
    window,
    runRateWindow,
    clients,
    ads,
    adsets,
    budgetMap: {
      entities,
      mismatches,
      total_daily_usd_cents: entities.reduce((s, e) => s + (e.daily_usd_cents || 0), 0),
      yesterday,
    },
    economics: [...econ.byClient.values()],
    closes_named: closesNamed,
    economicsCaveats: econ.caveats,
    exclusions,
  };
}

/** The named closes behind this window's cash. Read from the stamped sale facts
 *  under exactly the same exclusions the leaf aggregation applies, so the names
 *  add up to the cash rather than to a different, larger set. */
async function namedCloses(
  ctx: TemplateContext,
  clients: readonly string[],
  from: string,
  to: string,
  ads: readonly AdFact[],
): Promise<Shared["closes_named"]> {
  const { data, error } = await ctx.db
    .from("adsv2_sale_facts")
    .select("client_key, keyword_normalized, prospect_name, sale_et_day, collected_usd_cents, closer, is_win, is_organic, awaiting_review")
    .in("client_key", [...clients])
    .gte("sale_et_day", from)
    .lte("sale_et_day", to)
    .eq("is_win", true);
  if (error) throw new Error(`could not read the named closes: ${error.message}`);
  const adsetByKeyword = new Map(ads.map((a) => [`${a.client}|${a.keyword}`, a.adset_id]));
  const out: Shared["closes_named"] = [];
  for (const r of (data || []) as Row[]) {
    if (r.is_organic || r.awaiting_review) continue;
    const kw = r.keyword_normalized ? String(r.keyword_normalized) : null;
    if (!kw) continue;
    out.push({
      adset_id: adsetByKeyword.get(`${String(r.client_key)}|${kw}`) ?? null,
      keyword: kw,
      prospect: (r.prospect_name as string) ?? null,
      sale_day: String(r.sale_et_day),
      collected_usd_cents: num(r.collected_usd_cents),
      closer: (r.closer as string) ?? null,
    });
  }
  out.sort((a, b) => (a.sale_day < b.sale_day ? -1 : a.sale_day > b.sale_day ? 1 : 0));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// WATCH MODE. Flags only, and it may not prescribe.
// ─────────────────────────────────────────────────────────────────────────

interface Flag {
  signal: string;
  magnitude: string;
  duration: string;
  since: string;
  closer: string;
  subject: { level: "ad" | "adset"; id: string; name_verbatim: string | null };
}

async function watchFlags(
  ctx: TemplateContext,
  clients: string[],
  shared: Shared,
  rs: Ruleset,
  selfDetails: Record<string, unknown>,
  closers: { monitor: string; queued: string },
): Promise<{ flags: Flag[]; baselineWindow: { from: string; to: string }; recentWindow: { from: string; to: string } }> {
  const yesterday = shared.budgetMap.yesterday;
  const pacePct = Number(selfDetails.spend_pace_flag_pct);
  const dmMultiple = Number(selfDetails.cost_per_dm_flag_multiple);
  const baselineDays = Number(selfDetails.cost_per_dm_baseline_days);

  const recent = { from: shiftDay(yesterday, -2), to: yesterday };
  const baseline = { from: shiftDay(yesterday, -(baselineDays - 1)), to: yesterday };

  // The 72-hour comparison the fatigue flag needs already lives on the pack, so
  // it is NOT re-fetched here. Two reads of the same window is two chances to
  // disagree with itself.
  const [recentLeaves, baselineLeaves] = await Promise.all([
    leavesFor(ctx, clients, recent.from, recent.to),
    leavesFor(ctx, clients, baseline.from, baseline.to),
  ]);
  const R = new Map(recentLeaves.map((l) => [l.ad_id, l]));

  // The account's own trailing cost per DM, which is the only fair yardstick
  // for one ad's cost per DM. A fixed dollar threshold would flag every ad the
  // week the whole account got more expensive, which is noise, not signal.
  let baseSpend = 0;
  let baseDms = 0;
  for (const l of baselineLeaves) {
    baseSpend += l.spend_cents;
    baseDms += l.messages;
  }
  const baselineCostPerDm = baseDms > 0 ? baseSpend / baseDms : null;

  const flags: Flag[] = [];
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;

  // 1. Spend pace against the live dial, over or under by the signed share.
  for (const e of shared.budgetMap.entities) {
    if (!e.daily_usd_cents || e.pace_pct_of_budget === null) continue;
    const drift = e.pace_pct_of_budget - 100;
    if (Math.abs(drift) < pacePct) continue;
    if (e.yesterday_spend_usd_cents === 0) continue; // covered by the zero-delivery flag
    flags.push({
      signal: drift > 0 ? "spend_pace_above_dial" : "spend_pace_below_dial",
      magnitude: `${money(e.yesterday_spend_usd_cents)} against a ${money(e.daily_usd_cents)} daily dial, ${e.pace_pct_of_budget}% of it`,
      duration: "1 day",
      since: yesterday,
      closer: closers.queued,
      subject: { level: e.level === "adset" ? "adset" : "adset", id: e.entity_id, name_verbatim: null },
    });
  }

  // 2. Zero delivery on something that is live and holds a dial. This is
  //    breakage, not performance, so touch_floor_72h's exception applies and it
  //    does not wait for a 72-hour signal.
  for (const e of shared.budgetMap.entities) {
    if (e.yesterday_spend_usd_cents > 0) continue;
    flags.push({
      signal: "zero_delivery_on_live_entity",
      magnitude: `no spend at all against a ${e.daily_usd_cents === null ? "live" : money(e.daily_usd_cents)} daily dial`,
      duration: "1 day",
      since: yesterday,
      closer: closers.queued,
      subject: { level: "adset", id: e.entity_id, name_verbatim: null },
    });
  }

  // 3. Cost per DM against the account's trailing baseline.
  if (baselineCostPerDm !== null && Number.isFinite(dmMultiple)) {
    for (const a of shared.ads) {
      const r = R.get(a.ad_id);
      if (!r || r.messages === 0 || r.spend_cents === 0) continue;
      const cpd = r.spend_cents / r.messages;
      if (cpd < baselineCostPerDm * dmMultiple) continue;
      flags.push({
        signal: "cost_per_dm_above_account_baseline",
        magnitude: `${money(Math.round(cpd))} per DM against a ${money(Math.round(baselineCostPerDm))} trailing ${baselineDays}-day account baseline, ${(cpd / baselineCostPerDm).toFixed(1)}x`,
        duration: "3 days",
        since: recent.from,
        closer: closers.queued,
        subject: { level: "ad", id: a.ad_id, name_verbatim: a.ad_name_verbatim },
      });
    }
  }

  // 4. Booked drought: funded past the point where one booking was expected,
  //    with none arriving.
  for (const a of shared.ads) {
    if (a.booked > 0) continue;
    if (a.spend_usd_cents < a.cost_per_call_target_usd_cents) continue;
    flags.push({
      signal: "no_bookings_past_expected_first_booking",
      magnitude: `${money(a.spend_usd_cents)} spent against a ${money(a.cost_per_call_target_usd_cents)} target cost per booked call, with 0 bookings and ${a.dms} DMs`,
      duration: `${shared.window.from} to ${shared.window.to}`,
      since: shared.window.from,
      closer: closers.queued,
      subject: { level: "ad", id: a.ad_id, name_verbatim: a.ad_name_verbatim },
    });
  }

  // 5. Fatigue. Read from the SAME 72-hour measurement the pack carries, so the
  //    daily flag and the weekly verdict can never be looking at two different
  //    fatigue signals.
  //
  //    LABELLED UNVALIDATED, because it is: this rule has never been backtested
  //    against what actually happened to the ads it would have flagged, and a
  //    flag that looks as certified as the rest while resting on nothing is
  //    worse than no flag at all.
  for (const a of shared.ads) {
    const f = a.fatigue;
    if (!f || !f.cost_per_result_rising || !f.ctr_falling) continue;
    flags.push({
      signal: "fatigue_signal (unvalidated rule, backtest pending)",
      magnitude: `cost per DM ${money(f.cost_per_dm_before_usd_cents)} then ${money(f.cost_per_dm_now_usd_cents)}, link CTR ${(f.link_ctr_before * 100).toFixed(2)}% then ${(f.link_ctr_now * 100).toFixed(2)}%`,
      duration: `${f.sustained_hours} hours, against the ${f.sustained_hours} hours before them`,
      since: recent.from,
      closer: closers.monitor,
      subject: { level: "ad", id: a.ad_id, name_verbatim: a.ad_name_verbatim },
    });
  }

  // 6. Budget-map mismatches.
  for (const m of shared.budgetMap.mismatches) {
    flags.push({
      signal: `budget_map_mismatch: ${m.what}`,
      magnitude: m.detail,
      duration: "1 day",
      since: yesterday,
      closer: closers.queued,
      subject: { level: "adset", id: m.entity_id, name_verbatim: null },
    });
  }

  return { flags, baselineWindow: baseline, recentWindow: recent };
}

// ─────────────────────────────────────────────────────────────────────────
// THE QUESTION.
// ─────────────────────────────────────────────────────────────────────────

const MODES = ["watch", "decide", "facts"] as const;

export const kill_scale_read: QuestionEntry = {
  key: "kill_scale_read",
  description:
    "The kill-or-scale read for one creator (or all of them): every live ad and ad set with its spend, run rate, funnel, cash and collected ROI. In facts mode it returns the decision inputs with no verdicts at all; in decide mode it adds a verdict per ad and ad set under a named decision ruleset; in watch mode it returns daily flags only, with no recommendation of any kind.",
  params:
    "client (tyson, jake, or all), mode (watch, decide or facts; defaults to decide), date_from and date_to (YYYY-MM-DD; optional, defaults to the trailing 14 days ending yesterday Eastern), ruleset (decide mode only; defaults to zakk_v1).",
  sources: [
    "ads_meta_insights_daily",
    "adsv2_dm_facts",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "adsv2_budget_snapshots",
    "registry_definitions",
    "registry_entities",
    "ad_creative_copy",
  ],
  freshnessSources: ["adsv2_dm_facts", "adsv2_booking_facts", "adsv2_sale_facts", "warehouse.ads"],
  budgetMs: 60_000,
  // Version 1. A money answer, so the coverage block is required. Marked
  // directional because a decision read off a window that ends inside the sales
  // lag is provisional by construction, however exact each number in it is.
  receipt: {
    version: 1,
    windowKind: "trailing_decision_window",
    money: true,
    usesDataVersion: true,
    certainty: "directional",
    definitionsCited: [
      "verdict_floors_kill_tree",
      "scaling_ladder",
      "decision_cadence",
      "daily_run_rate",
      "roi_window",
      "sales_lag",
      "touch_floor_72h",
      "learning_phase_awareness",
      "structure_rules",
      "unit_economics",
      "pricing_currency",
    ],
  },
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "mode", "date_from", "date_to", "ruleset"]);
    const account = await requireAccount(ctx, params);
    const clients = account === "all" ? [...ctx.clients] : [account];

    try {
      return await answer();
    } catch (err) {
      // BRICK 3'S THRESHOLD LAW, enforced at the last possible moment.
      //
      // Every threshold this answer applies comes from a signed definition. If
      // one is missing or unsigned there is exactly one honest move, and it is
      // NOT to fall back to a built-in default: a default would return a
      // confident number computed against a rule nobody signed, which is
      // indistinguishable from a certified answer and worse than silence.
      //
      // So the answer comes back with no numbers in it, its receipt says
      // cannot_answer, and it NAMES what has to be signed.
      if (!(err instanceof CannotAnswer)) throw err;
      return {
        answers: {
          account,
          answered: false,
          cannot_answer: {
            missing: err.missing,
            why: err.message,
            what_to_do:
              "Sign the named definition (or add the named field to it) in registry_definitions, then ask again. No threshold was substituted from code, so nothing here is a partial answer to be salvaged.",
          },
        },
        asOf: [],
        usedParams: { client: account, mode: String(params.mode ?? "decide") },
        certainty: "cannot_answer",
      };
    }

    async function answer(): ReturnType<QuestionEntry["run"]> {
    const modeRaw = (optionalText(params, "mode") || "decide").toLowerCase();
    if (!(MODES as readonly string[]).includes(modeRaw)) {
      throw new BadParams(`mode must be one of: ${MODES.join(", ")}. It defaults to decide.`);
    }
    const mode = modeRaw as (typeof MODES)[number];

    const rulesetAsked = optionalText(params, "ruleset");
    if (rulesetAsked && mode !== "decide") {
      throw new BadParams(
        `ruleset only applies to decide mode, and this was asked in ${mode} mode. ${mode === "facts" ? "Facts mode returns no verdicts at all, so no ruleset applies to it." : "Watch mode returns flags only, never a verdict."}`,
      );
    }
    const rulesetKey = rulesetAsked || DEFAULT_RULESET;

    // decision_cadence v1: decide weekly on a trailing 14 days. The window is
    // read from the definition, not from a number typed here.
    const watchRules = await loadWatchRules(ctx.db);
    let window: { from: string; to: string };
    if (params.date_from !== undefined || params.date_to !== undefined) {
      window = requireRange(params);
    } else {
      const yesterday = shiftDay(todayEt(ctx.now), -1);
      window = { from: shiftDay(yesterday, -(watchRules.decideWindowDays - 1)), to: yesterday };
    }

    const { ruleset, definitions } = await loadRuleset(ctx.db, rulesetKey);
    const self = definitions.find((d) => d.name === ruleset.definition.name)!;

    const shared = await computeShared(ctx, clients, window, ruleset, self.details, {
      activeOnly: true,
      withHistory: mode !== "watch",
    });

    const used = {
      client: account,
      mode,
      date_from: window.from,
      date_to: window.to,
      ...(mode === "decide" ? { ruleset: rulesetKey } : {}),
    };
    const asOf: AsOf[] = [];
    const definitionKeys = ["spend", "messages", "booked", "taken", "newClients", "collected", "collectedRoi"];

    const unitsNote =
      "Money is in USD CENTS throughout. Collected ROI is a multiple. Link CTR is a share between 0 and 1.";

    // ── WATCH ────────────────────────────────────────────────────────────
    if (mode === "watch") {
      const closers = {
        monitor: watchRules.allowedClosers[0] ?? "monitor",
        queued: watchRules.allowedClosers[1] ?? watchRules.allowedClosers[0] ?? "monitor",
      };
      const { flags, baselineWindow, recentWindow } = await watchFlags(
        ctx,
        clients,
        shared,
        ruleset,
        self.details,
        closers,
      );
      return {
        answers: {
          account,
          mode: "watch",
          context_window: shared.window,
          recent_window: recentWindow,
          baseline_window: baselineWindow,
          units: unitsNote,
          flags,
          flag_count: flags.length,
          what_this_is:
            `Daily watch output under decision_cadence v${watchRules.version}: observations only. Each flag carries what was seen, how big it was, how long it has held, and one of the two allowed closers. It contains no instruction of any kind, by design, because the flag is data and the prescription belongs to the weekly decide read.`,
          allowed_closers: watchRules.allowedClosers,
          fatigue_rule_status:
            "The fatigue flag is an UNVALIDATED rule. It has never been backtested against what actually happened to the ads it would have flagged, and it ships labelled that way rather than looking as certified as the rest of this answer.",
          budget_map: shared.budgetMap,
        },
        definitionKeys,
        asOf,
        usedParams: used,
        window,
        exclusions: shared.exclusions,
        registryDefinitionsCited: [ruleset.definition.name, ...ruleset.components],
        note:
          `This is the daily watch read. Under decision_cadence v${watchRules.version} it states observations and nothing else; the weekly decide read is where a judgement is made.`,
      };
    }

    // ── The pack both facts and decide return. ───────────────────────────
    const pack = {
      account,
      window: shared.window,
      run_rate_window: shared.runRateWindow,
      units: unitsNote,
      economics: shared.economics,
      ads: shared.ads,
      ad_sets: shared.adsets,
      budget_map: shared.budgetMap,
      closes_named: shared.closes_named,
      counting_note:
        "booked counts DISTINCT PEOPLE with a booking on a pinned sales calendar, carrying a keyword. taken counts distinct people with a taken-call row in the sales tracker. They are two different populations read from two different systems, so taken can legitimately exceed booked for the same ad: a call booked off-calendar, or through a duplicate contact, is taken without ever being booked here. Treat booked as a floor.",
    };

    // ── FACTS: no verdicts, and nothing that hints at one. ───────────────
    if (mode === "facts") {
      return {
        answers: {
          ...pack,
          mode: "facts",
          what_this_is:
            "The certified decision inputs, complete, with NO judgement applied. Nothing here ranks, rates or recommends. This mode exists so an outside advisor can reach its own conclusion from the same numbers the owner uses, under whatever rules it thinks are right. If you want this system's own reading, ask the same question in decide mode and name a ruleset; you will get these identical numbers with a labelled judgement attached.",
          rulesets_available: [...KNOWN_RULESETS],
        },
        definitionKeys,
        asOf,
        usedParams: used,
        window,
        exclusions: shared.exclusions,
        // Facts mode applies no ruleset, but it DID apply the signed rules that
        // shaped what it measured (the structure rules, the run-rate basis, the
        // touch floor the fatigue window comes from), so it cites them.
        registryDefinitionsCited: [ruleset.definition.name, ...ruleset.components],
        note:
          "Facts mode returns inputs only. No verdict was computed and none is implied; the judgement belongs to whoever is reading this, under a ruleset they name.",
      };
    }

    // ── DECIDE: verdicts, every one stamped with its ruleset. ────────────
    const adVerdicts = new Map<string, AdVerdict>();
    for (const a of shared.ads) {
      const input: AdVerdictInput = {
        ad_id: a.ad_id,
        keyword: a.keyword,
        adset_id: a.adset_id,
        spend_usd_cents: a.spend_usd_cents,
        booked: a.booked,
        taken: a.taken,
        closes: a.closes,
        collected_usd_cents: a.collected_usd_cents,
        cost_per_call_target_usd_cents: a.cost_per_call_target_usd_cents,
        days_live: a.days_live,
        reached_2x_history: a.history.reached_kpi_line_before,
        // The 72-hour measurement, fed in as measured. This is what makes the
        // signed tree's FIXABLE branch reachable: an ad that once cleared the
        // KPI line and is now fatiguing is a relaunch, not a kill, and passing
        // null here would have quietly deleted that branch from the live path
        // and sent every tired winner to the kill pile.
        fatigue: a.fatigue,
        fresh_creative_tested: false,
      };
      adVerdicts.set(a.ad_id, verdictForAd(input, ruleset));
    }

    const activeAdsetsByCampaign = new Map<string, Set<string>>();
    for (const g of shared.adsets) {
      if (!g.campaign_id) continue;
      const s = activeAdsetsByCampaign.get(g.campaign_id) || new Set<string>();
      s.add(g.adset_id);
      activeAdsetsByCampaign.set(g.campaign_id, s);
    }

    const adsetVerdicts = shared.adsets.map((g) =>
      verdictForAdSet(
        {
          adset_id: g.adset_id,
          adset_name_verbatim: g.adset_name_verbatim,
          campaign_id: g.campaign_id,
          spend_usd_cents: g.spend_usd_cents,
          collected_usd_cents: g.collected_usd_cents,
          closes: g.closes,
          booked: g.booked,
          daily_budget_usd_cents: g.daily_budget_usd_cents,
          budget_level: g.budget_level,
          ad_verdicts: g.ad_ids.map((id) => adVerdicts.get(id)!).filter(Boolean),
          sibling_active_adsets: (activeAdsetsByCampaign.get(g.campaign_id || "")?.size ?? 1) - 1,
        },
        ruleset,
      ),
    );

    return {
      answers: {
        ...pack,
        mode: "decide",
        under_ruleset: ruleset.key,
        ruleset_definition: { name: ruleset.definition.name, version: ruleset.definition.version },
        ruleset_components: ruleset.components,
        ad_verdicts: [...adVerdicts.values()],
        ad_set_verdicts: adsetVerdicts,
        what_this_is:
          `Verdicts computed under ruleset ${ruleset.key}, from ${ruleset.definition.name} v${ruleset.definition.version} and the signed definitions it composes. Every verdict carries under_ruleset and a basis naming the definitions and the numbers that earned it. A verdict is ADVICE UNDER A LENS, not the truth: the facts above are the truth, and the same question in facts mode returns them with no judgement at all.`,
        undecidable_inputs: {
          fresh_creative_tested:
            "false for every ad, because nothing in this system records whether fresh creative has already been tested on an ad. It is a conservative default, NOT a finding. It only ever makes the tree gentler: with it false, an ad reaches a kill through the never-reached-2x branch or not at all, so the default cannot manufacture a kill. Where the tested-creative branch would matter, a human has to supply that fact.",
          fatigue:
            "measured over the last 72 hours against the 72 before them, per touch_floor_72h v1, and shown per ad in the pack above. Null for an ad where either half of that comparison had no DMs or no impressions to measure: that is 'not measurable', which is a different fact from 'not fatiguing', and it is never reported as the latter.",
        },
      },
      definitionKeys,
      asOf,
      usedParams: used,
      window,
      exclusions: shared.exclusions,
      registryDefinitionsCited: [ruleset.definition.name, ...ruleset.components],
      note:
        `These verdicts are advice under ruleset ${ruleset.key} and are not the only defensible reading of these numbers. Nothing here executes: no budget was moved and no ad was touched.`,
    };
    }
  },
};
