// ─────────────────────────────────────────────────────────────────────────
// creator_funnel: spend -> DMs -> booked -> taken -> shown -> closes -> cash.
//
// The whole funnel for one creator (or all of them), with the rate and the cost
// at every stage, measured against that creator's OWN trailing baseline rather
// than against a benchmark somebody else set.
//
// THE ONE THING THIS QUESTION EXISTS TO GET RIGHT (the 2026-08-05 law):
// BOOKED AND TAKEN ARE TWO DIFFERENT POPULATIONS, READ FROM TWO DIFFERENT
// SYSTEMS, AND THEY ARE ALWAYS SHOWN SIDE BY SIDE WITH THE GAP NAMED.
//
//   booked = distinct people with a booking on a PINNED SALES CALENDAR carrying
//            a keyword. It is a FLOOR, not a count of calls.
//   taken  = distinct people with a taken-call row in the SALES TRACKER.
//
// A call booked off-calendar, or through a duplicated GHL contact, is taken
// without ever being booked here. So taken legitimately exceeds booked, and on
// Tyson's trailing fortnight it does, by more than double. The 8/5 investigation
// established this is NOT a math bug. A reader who mistakes one for the other
// will compute a show rate above 100%, conclude the data is broken, and stop
// trusting the tab. So this answer never prints one without the other, and it
// states the gap in words as well as in numbers.
//
// Every number here comes through the certified leaf aggregation (leaves.ts),
// which is the same pre-aggregation the Ads v2 tab paints from, and every RATE
// comes from the tab's own derive() applied to the summed bases. A total is a
// formula over the union, never an average of per-row ratios.
// ─────────────────────────────────────────────────────────────────────────

import { derive } from "@/lib/ads-v2/metrics";
import { daysBetween, shiftDay, todayEt } from "@/lib/ads-v2/time";
import { leavesFor, sumLeaves, toBaseMetrics, type FunnelBase, type Leaf } from "./leaves";
import { rejectUnknown, requireAccount, requireRange } from "./params";
import type { AsOf, QuestionEntry } from "./types";

/** The default window: the trailing fortnight ending yesterday, Eastern. Same
 *  shape as the weekly decision window, so the funnel a reader looks at is the
 *  funnel the kill/scale read was decided on. */
const DEFAULT_WINDOW_DAYS = 14;

function ratio(v: number | null, places = 4): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/**
 * A change against the baseline, or null percent when there is no baseline to
 * change FROM. Dividing by zero produces "new", not "infinite growth".
 *
 * `absolute` is rounded to four places because subtracting two 2-decimal ROI
 * multiples in binary floating point yields 1.1500000000000004, and a certified
 * answer that prints seventeen significant figures for "up 1.15x" teaches the
 * reader that its numbers are sloppy. Integers are unaffected.
 */
function delta(now: number, before: number): { absolute: number; pct_change: number | null } {
  return {
    absolute: Math.round((now - before) * 10000) / 10000,
    pct_change: before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10,
  };
}

/** One creator's funnel over one window: the counts, the rates, the costs. */
function funnelFor(base: FunnelBase) {
  const d = derive(toBaseMetrics(base));
  return {
    // ── The stages, in order. Counts only. ──────────────────────────────
    stages: {
      spend_usd_cents: base.spend_usd_cents,
      dms: base.dms,
      booked: base.booked,
      taken: base.taken,
      shown: base.shown,
      closes: base.closes,
      collected_usd_cents: base.collected_usd_cents,
    },
    // ── Stage to stage. Each rate names the two stages it spans, so no
    //    reader has to guess which way round it is. ────────────────────────
    stage_rates: {
      dm_to_booked: ratio(d.msgToCall),
      booked_to_shown: ratio(d.showRate),
      taken_to_close: ratio(d.closeRate),
      link_ctr: ratio(d.ctr, 5),
    },
    // ── What each stage cost. ────────────────────────────────────────────
    cost_per_stage_usd_cents: {
      per_dm: d.costPerMessageCents,
      per_booked_call: d.costPerBookedCents,
      per_taken_call: d.costPerTakenCents,
      per_close: d.costPerClientCents,
    },
    collected_roi: ratio(d.collectedRoi, 2),
    // ── THE 8/5 LAW, structural. ─────────────────────────────────────────
    booked_vs_taken: {
      booked: base.booked,
      taken: base.taken,
      gap: base.taken - base.booked,
      upcoming_not_yet_due: base.upcoming,
      reading:
        base.taken === base.booked
          ? `booked and taken agree at ${base.booked} for this window, which is the ordinary case and not evidence of anything.`
          : base.taken > base.booked
            ? `taken (${base.taken}) EXCEEDS booked (${base.booked}) by ${base.taken - base.booked}. This is not a counting error. booked is read from pinned sales-calendar bookings carrying a keyword; taken is read from taken-call rows in the sales tracker. A call booked off-calendar, or through a duplicate contact record, is taken here without ever having been booked here. Treat booked as a FLOOR on demand, never as the number of calls that happened.`
            : `booked (${base.booked}) exceeds taken (${base.taken}) by ${base.booked - base.taken}, which is the expected direction: ${base.upcoming} of those bookings are still upcoming and not yet due, and the rest are no-shows.`,
      why_no_single_show_rate:
        "booked_to_shown is computed the one way the tab computes it: of the people BOOKED in this window and already due (booked minus upcoming), the share with a hard-key-linked taken record. It is deliberately NOT taken divided by booked, because those two counts come from different systems and their ratio can exceed 1, which is meaningless as a show rate.",
    },
  };
}

type Funnel = ReturnType<typeof funnelFor>;

/** The deltas that matter, stage by stage, against the creator's own prior
 *  equal-length window. */
function compare(now: Funnel, before: Funnel) {
  const n = now.stages;
  const b = before.stages;
  return {
    spend_usd_cents: delta(n.spend_usd_cents, b.spend_usd_cents),
    dms: delta(n.dms, b.dms),
    booked: delta(n.booked, b.booked),
    taken: delta(n.taken, b.taken),
    shown: delta(n.shown, b.shown),
    closes: delta(n.closes, b.closes),
    collected_usd_cents: delta(n.collected_usd_cents, b.collected_usd_cents),
    cost_per_dm_usd_cents:
      now.cost_per_stage_usd_cents.per_dm !== null && before.cost_per_stage_usd_cents.per_dm !== null
        ? delta(now.cost_per_stage_usd_cents.per_dm, before.cost_per_stage_usd_cents.per_dm)
        : null,
    collected_roi:
      now.collected_roi !== null && before.collected_roi !== null
        ? delta(now.collected_roi, before.collected_roi)
        : null,
  };
}

export const creator_funnel: QuestionEntry = {
  key: "creator_funnel",
  description:
    "The whole funnel for one creator (or all of them together) over a window: spend, DMs, booked calls, calls taken, people shown, closes and cash, with the rate and the cost at every stage, compared against that creator's own previous window of the same length. Booked and taken are always reported side by side with the gap between them explained.",
  params:
    "client (tyson, jake, or all), date_from and date_to (YYYY-MM-DD; optional, defaults to the trailing 14 days ending yesterday Eastern).",
  sources: [
    "ads_meta_insights_daily",
    "adsv2_dm_facts",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "registry_entities",
  ],
  freshnessSources: ["adsv2_dm_facts", "adsv2_booking_facts", "adsv2_sale_facts", "warehouse.ads"],
  budgetMs: 45_000,
  // Version 1. A money answer, so the coverage block is required. Directional
  // for the same reason kill_scale_read is: a window ending inside the sales
  // lag is provisional however exact each number in it is.
  receipt: {
    version: 1,
    windowKind: "trailing_funnel_window",
    money: true,
    usesDataVersion: true,
    certainty: "directional",
    definitionsCited: ["roi_window", "sales_lag", "collected_vs_contracted", "structure_rules", "win_definition"],
    exclusions: [
      {
        what: "ads carrying no keyword",
        count: 0,
        why:
          "the whole funnel in this system is joined by keyword, so an ad that never carried one has spend but no DMs, calls or cash that can be tied to it. Its spend is real and appears in the Ads v2 tab's own totals; it is not in this funnel.",
      },
      {
        what: "organic keyword traffic and rows still awaiting review",
        count: 0,
        why:
          "organic_keywords v1 forbids marked organic keywords from entering ad ROAS, and an awaiting-review row is one nobody has classified yet. Both are out of every number here, which understates the funnel rather than flattering it. The receipt's coverage block states the awaiting-review gap in wins and dollars.",
      },
    ],
  },
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "date_from", "date_to"]);
    const account = await requireAccount(ctx, params);
    const clients = account === "all" ? [...ctx.clients] : [account];

    let window: { from: string; to: string };
    if (params.date_from !== undefined || params.date_to !== undefined) {
      window = requireRange(params);
    } else {
      const yesterday = shiftDay(todayEt(ctx.now), -1);
      window = { from: shiftDay(yesterday, -(DEFAULT_WINDOW_DAYS - 1)), to: yesterday };
    }

    // roi_window v1: the same window on both sides, always. The baseline is the
    // immediately preceding window of the SAME LENGTH, so "up 20%" is measured
    // against a comparable period rather than against a differently shaped one.
    const spanDays = daysBetween(window.from, window.to) + 1;
    const baseline = {
      from: shiftDay(window.from, -spanDays),
      to: shiftDay(window.from, -1),
    };

    const [nowLeaves, beforeLeaves] = await Promise.all([
      leavesFor(ctx.db, clients, window.from, window.to),
      leavesFor(ctx.db, clients, baseline.from, baseline.to),
    ]);

    const byClient = (leaves: readonly Leaf[], client: string) => leaves.filter((l) => l.client_key === client);

    const perCreator = clients.map((c) => {
      const now = funnelFor(sumLeaves(byClient(nowLeaves, c)));
      const before = funnelFor(sumLeaves(byClient(beforeLeaves, c)));
      return {
        client: c,
        window: now,
        baseline: before,
        change_vs_baseline: compare(now, before),
      };
    });

    // The roster-wide total is summed from the LEAVES, not from the per-creator
    // funnels, so every rate in it is a formula over the union rather than an
    // average of two creators' ratios.
    const totalNow = funnelFor(sumLeaves(nowLeaves));
    const totalBefore = funnelFor(sumLeaves(beforeLeaves));

    return {
      answers: {
        account,
        window,
        baseline_window: baseline,
        units:
          "Money is in USD CENTS. Stage rates are a share between 0 and 1. Collected ROI is a multiple. pct_change is in percent.",
        funnel_order: ["spend", "dms", "booked", "taken", "shown", "closes", "collected"],
        per_creator: perCreator,
        total: {
          window: totalNow,
          baseline: totalBefore,
          change_vs_baseline: compare(totalNow, totalBefore),
        },
        baseline_basis: `the ${spanDays} days immediately before this window (${baseline.from} to ${baseline.to}), which is the same length as the window itself, per roi_window v1. It is this creator's own past, not a benchmark from anyone else.`,
        counting_note:
          "booked counts DISTINCT PEOPLE with a booking on a pinned sales calendar carrying a keyword. taken counts distinct people with a taken-call row in the sales tracker. shown counts the booked-in-window people already due who have a hard-key-linked taken record. They are three different reads of three different systems: see booked_vs_taken on every funnel for what their gap means.",
      },
      definitionKeys: [
        "spend",
        "messages",
        "booked",
        "taken",
        "newClients",
        "collected",
        "collectedRoi",
        "costPerMessage",
        "costPerBooked",
        "costPerTaken",
        "costPerClient",
        "showRate",
        "closeRate",
        "msgToCall",
      ],
      asOf: [] as AsOf[],
      usedParams: { client: account, date_from: window.from, date_to: window.to },
      window,
    };
  },
};

/** Exported for the golden fixtures, which pin the funnel arithmetic itself
 *  with fixed inputs rather than going through the whole door. */
export const __testables = { funnelFor, compare, delta };
