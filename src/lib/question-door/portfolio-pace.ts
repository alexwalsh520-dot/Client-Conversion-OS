// ─────────────────────────────────────────────────────────────────────────
// portfolio_pace: the LEVEL and the TREND, never one without the other.
//
// This question is the signed level_vs_trend v1 definition turned into code:
//
//   "Any pace or per-month claim must include the actual calendar month
//    (month-to-date plus prior month) AND the weekly trend shape. A trailing
//    window alone is never a level claim."
//
// THE MISTAKE IT EXISTS TO PREVENT (2026-07-02, paid for in a real decision):
// a trailing-30 window was read as "the monthly number". It is not. A trailing
// window slides, a calendar month does not, and the owner's mental model, his
// bank balance and his tax year all run on calendar months. Reporting a
// trailing extrapolation as the level makes a business look like it is doing
// something it is not.
//
// So this answer is built so the mistake is structurally hard to make:
//   - `level` carries ONLY calendar figures: month-to-date and the prior FULL
//     month. Nothing extrapolated ever enters it.
//   - `trend` carries the weekly shape, eight weeks of it.
//   - the extrapolation exists, because it is genuinely useful, but it lives
//     inside `trend` as a `trend_line`, is stamped `is_level_claim: false`, and
//     says in its own words what it may not be used for.
//
// AND THE 2026-08-08 LAW: a BLEND IS NEVER SHOWN WITHOUT ITS SHAPE. Blended ROI
// over a month can hide a decaying tail entirely (the PRO scale retraction: a
// 14-day blend concealed a falling 3-day and 7-day tail). Every blended ROI in
// this answer therefore ships attached to the weekly series that produced it.
// ─────────────────────────────────────────────────────────────────────────

import { daysBetween, firstOfMonth, lastOfMonth, shiftDay, todayEt } from "@/lib/ads-v2/time";
import { leavesFor, sumLeaves, type Leaf } from "./leaves";
import { loadSignedDefinitions } from "./rulesets";
import { optionalInt, rejectUnknown, requireAccount } from "./params";
import type { AsOf, QuestionEntry } from "./types";

/** How many trailing weeks of shape the answer carries by default. */
const DEFAULT_TREND_WEEKS = 8;

function roi(collected: number, spend: number): number | null {
  if (spend <= 0) return null;
  return Math.round((collected / spend) * 100) / 100;
}

/** The first day of the month BEFORE the month `iso` falls in. */
function firstOfPriorMonth(iso: string): string {
  return firstOfMonth(shiftDay(firstOfMonth(iso), -1));
}

interface Bucket {
  from: string;
  to: string;
  spend_usd_cents: number;
  collected_usd_cents: number;
  blended_collected_roi: number | null;
  dms: number;
  closes: number;
}

function bucketOf(leaves: readonly Leaf[], from: string, to: string): Bucket {
  const b = sumLeaves(leaves);
  return {
    from,
    to,
    spend_usd_cents: b.spend_usd_cents,
    collected_usd_cents: b.collected_usd_cents,
    blended_collected_roi: roi(b.collected_usd_cents, b.spend_usd_cents),
    dms: b.dms,
    closes: b.closes,
  };
}

export const portfolio_pace: QuestionEntry = {
  key: "portfolio_pace",
  description:
    "Where the money actually stands and which way it is moving: the calendar month to date and the prior full month (the LEVEL), alongside the weekly shape of the trailing eight weeks (the TREND), with spend, cash collected and blended collected ROI per creator and for the whole portfolio. A trailing extrapolation is offered only as a labelled trend line and is never presented as the level.",
  params:
    "client (tyson, jake, or all; defaults to all), trend_weeks (a whole number from 2 to 26; defaults to 8).",
  sources: [
    "ads_meta_insights_daily",
    "adsv2_dm_facts",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "registry_definitions",
    "registry_entities",
  ],
  freshnessSources: ["adsv2_dm_facts", "adsv2_booking_facts", "adsv2_sale_facts", "warehouse.ads"],
  budgetMs: 60_000,
  // Version 1. A money answer. The window on the receipt is the LEVEL window
  // (the calendar month to date), because that is the claim this question is
  // actually making; the trend windows are stated inside the answer.
  receipt: {
    version: 1,
    windowKind: "calendar_month_to_date",
    money: true,
    usesDataVersion: true,
    certainty: "directional",
    definitionsCited: ["level_vs_trend", "sales_lag", "roi_window", "collected_vs_contracted"],
    exclusions: [
      {
        what: "organic keyword traffic and rows still awaiting review",
        count: 0,
        why:
          "organic_keywords v1 keeps marked organic keywords out of ad ROAS, and an awaiting-review row is one nobody has classified yet. Both are out of every figure here, which understates cash rather than flattering it. The coverage block states the awaiting-review gap for the month-to-date window.",
      },
      {
        what: "the current, incomplete week and the current, incomplete month",
        count: 0,
        why:
          "both are reported as partial ON PURPOSE and are labelled `complete: false`. They are never annualised, never grossed up, and never compared like-for-like against a full period without that label being attached.",
      },
    ],
  },
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "trend_weeks"]);
    const account = params.client === undefined && params.account === undefined
      ? "all"
      : await requireAccount(ctx, params);
    const clients = account === "all" ? [...ctx.clients] : [account];
    const trendWeeks = optionalInt(params, "trend_weeks", DEFAULT_TREND_WEEKS, 2, 26);

    // Everything is anchored on yesterday Eastern: today is still being written
    // and a partial day at the end of a series reads as a collapse.
    const today = todayEt(ctx.now);
    const yesterday = shiftDay(today, -1);

    // ── THE LEVEL: calendar months only. ──────────────────────────────────
    const mtd = { from: firstOfMonth(yesterday), to: yesterday };
    const priorFrom = firstOfPriorMonth(yesterday);
    const prior = { from: priorFrom, to: lastOfMonth(priorFrom) };

    // ── THE TREND: whole weeks back from yesterday, oldest first. ─────────
    const weekWindows: Array<{ from: string; to: string }> = [];
    for (let i = trendWeeks - 1; i >= 0; i--) {
      const to = shiftDay(yesterday, -7 * i);
      weekWindows.push({ from: shiftDay(to, -6), to });
    }

    const [mtdLeaves, priorLeaves, ...weekLeaves] = await Promise.all([
      leavesFor(ctx.db, clients, mtd.from, mtd.to),
      leavesFor(ctx.db, clients, prior.from, prior.to),
      ...weekWindows.map((w) => leavesFor(ctx.db, clients, w.from, w.to)),
    ]);

    const forClient = (leaves: readonly Leaf[], c: string) => leaves.filter((l) => l.client_key === c);

    // ── The sales-lag p90, READ FROM THE REGISTRY, never typed here. ──────
    // It only ever LABELS which buckets are still collecting cash; no figure in
    // this answer is adjusted by it. But it is a number the owner signed, and a
    // signed number copied into a deploy keeps applying the old rule after he
    // signs a new one, so it is read at answer time like every other threshold.
    // Unreadable means the label says "unknown", not "no".
    let lagP90Days: number | null = null;
    let lagStatement: string | null = null;
    try {
      const defs = await loadSignedDefinitions(ctx.db, ["sales_lag"]);
      const d = defs.get("sales_lag");
      if (d) {
        lagStatement = `sales_lag v${d.version}: ${d.statement}`;
        const p90 = Number(d.details.p90_days);
        if (Number.isFinite(p90)) lagP90Days = p90;
      }
    } catch {
      // The numbers in this answer do not depend on it, and the receipt carries
      // the sales-lag caveat on its own, so a failed read degrades the LABEL
      // and nothing else.
    }

    // The trailing extrapolation, from the LAST COMPLETE week's pace. It is a
    // trend line and nothing more; see the labels attached to it below.
    const latestWeekWindow = weekWindows.length >= 2 ? weekWindows[weekWindows.length - 1] : null;

    const build = (leavesOf: (l: readonly Leaf[]) => readonly Leaf[]) => {
      const mtdBucket = bucketOf(leavesOf(mtdLeaves), mtd.from, mtd.to);
      const priorBucket = bucketOf(leavesOf(priorLeaves), prior.from, prior.to);
      const weeks = weekWindows.map((w, i) => ({
        ...bucketOf(leavesOf(weekLeaves[i]), w.from, w.to),
        days: 7,
        // Every bucket is a full seven ELAPSED days, so none of them is
        // "incomplete" in the calendar sense. What is genuinely unfinished is
        // the CASH: sales_lag v1 puts the p90 at 13 days, so a bucket ending
        // inside that window will still be collecting money it has already paid
        // the spend for. That, not day-count, is what a reader must not miss.
        cash_still_landing: lagP90Days === null ? null : daysBetween(w.to, yesterday) < lagP90Days,
        week_index: i - (weekWindows.length - 1),
      }));

      // The last bucket ENDS on yesterday, so it is a full seven days of data
      // but the calendar week it sits in may not be over. It is labelled by
      // what it is: a trailing seven days, not "this week".
      const lastWeek = weeks[weeks.length - 1];
      const monthEnd = lastOfMonth(mtd.from);
      const daysElapsed = Number(mtd.to.slice(8)) || 1;
      const daysInMonth = Number(monthEnd.slice(8));
      const monthComplete = mtd.to === monthEnd;

      return {
        // ── LEVEL. Calendar only. Nothing extrapolated lives in here. ────
        level: {
          month_to_date: {
            ...mtdBucket,
            complete: monthComplete,
            days_elapsed: daysElapsed,
            days_in_month: daysInMonth,
            note: monthComplete
              ? `${mtd.from} to ${mtd.to}: all ${daysInMonth} days of the calendar month, so this month is complete and IS comparable like-for-like with the prior full month.`
              : `${mtd.from} to ${mtd.to}: ${daysElapsed} of ${daysInMonth} days of the calendar month. This is a PARTIAL month and is not comparable to the prior full month without saying so.`,
          },
          prior_full_month: { ...priorBucket, complete: true },
          basis:
            "level_vs_trend v1: a level claim is a CALENDAR figure. Both numbers here are real calendar periods with no extrapolation of any kind in them.",
        },
        // ── TREND. The shape, plus the clearly-labelled projection. ──────
        trend: {
          weekly: weeks,
          weekly_basis: `${weeks.length} trailing seven-day buckets ending ${yesterday}, oldest first. Each bucket is a real seven days of data; the last one ends yesterday and is not a calendar week. cash_still_landing marks a bucket that ends inside the signed sales-lag p90${lagP90Days === null ? " (unreadable from the registry for this answer, so the flag is null rather than a guess)" : ` of ${lagP90Days} days`}: its spend is fully recorded and its cash is not.`,
          trend_line: latestWeekWindow
            ? {
                is_level_claim: false,
                label: "TREND LINE, NOT A LEVEL",
                basis_window: latestWeekWindow,
                daily_pace_spend_usd_cents: Math.round(lastWeek.spend_usd_cents / 7),
                daily_pace_collected_usd_cents: Math.round(lastWeek.collected_usd_cents / 7),
                if_this_pace_held_for_a_full_month: {
                  spend_usd_cents: Math.round((lastWeek.spend_usd_cents / 7) * daysInMonth),
                  collected_usd_cents: Math.round((lastWeek.collected_usd_cents / 7) * daysInMonth),
                },
                what_this_is_not:
                  "This is an extrapolation of the last seven days across a whole month. It is NOT this month's number, it is NOT a forecast, and under level_vs_trend v1 it may never be reported as the level. The level is in the `level` block above, and it is a calendar figure. This line exists to show direction only.",
              }
            : null,
        },
        blend_warning:
          "Every blended ROI on this answer is a ratio over a whole period, and a blend can hide its own tail: a fortnight at 3x can contain a final three days at 0.5x. That is why the weekly series ships attached to every blend here and is never omitted. Read the shape before you act on the blend.",
      };
    };

    const perCreator = clients.map((c) => ({
      client: c,
      ...build((l) => forClient(l, c)),
    }));
    const total = build((l) => l);

    return {
      answers: {
        account,
        as_of_day: yesterday,
        units: "Money is in USD CENTS. Blended collected ROI is a multiple. Nothing here is annualised.",
        level_window: mtd,
        prior_month_window: prior,
        per_creator: perCreator,
        total,
        the_rule:
          "level_vs_trend v1: any pace or per-month claim must carry the actual calendar month (month-to-date plus prior month) AND the weekly trend shape. A trailing window alone is never a level claim. This answer is built so that reading it correctly is the path of least resistance: the calendar figures and the trend shape are separate blocks, and the extrapolation is inside the trend block, stamped is_level_claim false.",
        current_week_caveat:
          (lagStatement ??
            "The signed sales_lag definition could not be read for this answer, so it is not being quoted from memory here. The receipt carries the sales-lag caveat independently.") +
          ` The newest bucket ends ${yesterday} and its cash WILL rise after this answer was given: the spend is already recorded and the sales it produced mostly are not. A falling last bar is the expected shape of a healthy account, not evidence of a problem, and on its own it is never a reason to kill anything.`,
      },
      definitionKeys: ["spend", "collected", "collectedRoi", "messages", "newClients"],
      asOf: [] as AsOf[],
      usedParams: { client: account, trend_weeks: trendWeeks, date_from: mtd.from, date_to: mtd.to },
      window: mtd,
      registryDefinitionsCited: ["level_vs_trend", "sales_lag"],
    };
  },
};
