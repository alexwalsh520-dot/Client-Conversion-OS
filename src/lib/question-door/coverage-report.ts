// ─────────────────────────────────────────────────────────────────────────
// 15. coverage_report: is the gap SHRINKING?
//
// Brick 2 made every money answer state its own coverage, which was the
// difference between an honest answer and a flattering one. But an honest
// number that never moves is just a number you learn to live with. This
// question exists so the gap has a direction.
//
// It answers three things a single coverage block cannot:
//
//   1. THE TREND. The same four buckets for the three windows before this one,
//      all the same length, so "85% classified" can be read as recovering or
//      slipping instead of taken as a fact of life.
//   2. THE BUSINESS-WIDE VIEW, always, alongside any per-creator one. This is
//      not a nicety. Every unclassified win in this database carries no
//      creator, so a per-creator coverage read that stood alone would report a
//      number that cannot be reconciled with the money.
//   3. DEPOSITS PENDING CLOSE. win_definition v1 says cash-bearing PCFU rows
//      "surface in answers as deposits pending close so they are visible,
//      never lost". Until now nothing implemented that sentence.
//
// Every number here comes from door_coverage_block, the same one function
// every other money answer uses. This question runs it four times over four
// windows and adds nothing of its own, so a bucket can never mean one thing
// here and something else in a receipt.
// ─────────────────────────────────────────────────────────────────────────

import { coverageFor } from "./receipts";
import { optionalDay, rejectUnknown, requireAccount } from "./params";
import { BadParams, type CoverageBlock, type Db, type QuestionEntry, type TemplateContext } from "./types";

/** Whole days between two ISO days, inclusive of both ends. */
function windowLength(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Shift an ISO day by a whole number of days, in UTC. */
function shift(day: string, days: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The three windows immediately before this one, each the same length, newest
 * first. Equal lengths are the point: comparing a 14 day window against a
 * 30 day one would show a "trend" that is only arithmetic.
 */
export function priorWindows(from: string, to: string, count = 3): Array<{ from: string; to: string }> {
  const len = windowLength(from, to);
  const out: Array<{ from: string; to: string }> = [];
  let cursorTo = shift(from, -1);
  for (let i = 0; i < count; i++) {
    const cursorFrom = shift(cursorTo, -(len - 1));
    out.push({ from: cursorFrom, to: cursorTo });
    cursorTo = shift(cursorFrom, -1);
  }
  return out;
}

interface Deposits {
  rows: number;
  cash_usd_cents: number;
  detail: unknown;
}

async function depositsPendingClose(db: Db, from: string, to: string): Promise<Deposits> {
  const { data, error } = await db.rpc("door_deposits_pending_close", { p_from: from, p_to: to });
  if (error) throw new Error(`could not read the deposits pending close: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as
    | { rows_count?: number; cash_usd_cents?: number; detail?: unknown }
    | undefined;
  return {
    rows: Number(r?.rows_count) || 0,
    cash_usd_cents: Number(r?.cash_usd_cents) || 0,
    detail: r?.detail ?? [],
  };
}

/** The shape a window contributes to the answer. */
function summarise(from: string, to: string, c: CoverageBlock) {
  return {
    date_from: from,
    date_to: to,
    wins: c.window_wins_total,
    cash_usd_cents: c.window_cash_usd_cents_total,
    buckets: c.buckets,
    classified_pct_wins: c.classified_pct_wins,
    classified_pct_cash: c.classified_pct_cash,
  };
}

export const coverage_report: QuestionEntry = {
  key: "coverage_report",
  description:
    "How much of a window's wins and cash are classified, in the four signed buckets, for one creator and for the whole business side by side, plus the same buckets for the three windows before it so the gap can be seen shrinking or growing. Includes cash-bearing PCFU rows as deposits pending close.",
  params:
    "client (tyson, jake, or all; defaults to all), date_from and date_to (YYYY-MM-DD; default to the trailing 14 days ending yesterday).",
  sources: ["adsv2_sale_facts", "registry_keywords", "sales_tracker_rows"],
  freshnessSources: ["adsv2_sale_facts", "sales_tracker_rows"],
  budgetMs: 40_000,
  // Version 1. A money answer whose whole subject IS coverage, so it carries a
  // coverage block like every other money answer rather than being treated as
  // a special case that gets to describe itself.
  receipt: {
    version: 1,
    windowKind: "explicit_range",
    money: true,
    usesDataVersion: false,
    exclusions: [
      {
        what: "anything that is not a WIN",
        count: 0,
        why: "coverage is measured on wins and their cash, per coverage v1. Calls that did not close are not part of it. Cash-bearing PCFU rows are reported separately as deposits pending close, because win_definition v1 says they must be visible without ever being counted as wins.",
      },
    ],
    definitionsCited: ["coverage", "certainty_buckets", "win_definition", "organic_keywords"],
  },
  async run(ctx: TemplateContext, params) {
    rejectUnknown(params, ["client", "account", "date_from", "date_to"]);
    const account = params.client ?? params.account ? await requireAccount(ctx, params) : "all";

    // The default window is the trailing fortnight ending YESTERDAY. Today is
    // excluded on purpose: a part-finished day makes every trend line dip at
    // the right-hand end, and a dip that is an artefact of the clock is worse
    // than no trend at all.
    const explicitFrom = optionalDay(params, "date_from");
    const explicitTo = optionalDay(params, "date_to");
    if (Boolean(explicitFrom) !== Boolean(explicitTo)) {
      throw new BadParams("give both date_from and date_to, or neither. Half a window is not a window.");
    }
    const yesterday = new Date(ctx.now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const to = explicitTo ?? yesterday;
    const from = explicitFrom ?? shift(to, -13);
    if (from > to) throw new BadParams(`date_from (${from}) cannot be after date_to (${to}).`);

    const subjects = account === "all" ? [...ctx.clients] : [account];
    const roster = [...ctx.clients];

    const priors = priorWindows(from, to, 3);

    // The scoped view, the business-wide view, and the trend. The business-wide
    // read is NOT skipped when the caller already asked for "all": returning
    // the same block twice is cheap and costs one round trip, while a shape
    // that changes depending on the parameters is something every caller has to
    // write a branch for.
    const [scoped, businessWide, ...priorBlocks] = await Promise.all([
      coverageFor(ctx.db, subjects, from, to),
      coverageFor(ctx.db, roster, from, to),
      ...priors.map((w) => coverageFor(ctx.db, subjects, w.from, w.to)),
    ]);
    const deposits = await depositsPendingClose(ctx.db, from, to);

    if (!scoped || !businessWide) {
      throw new Error("the coverage block could not be read, so this answer is not being returned");
    }

    const trend = priors.map((w, i) => {
      const block = priorBlocks[i];
      return block ? summarise(w.from, w.to, block) : null;
    });

    // The direction, stated once so nobody has to subtract two percentages in
    // their head and get the sign wrong.
    const previous = trend[0];
    const movement =
      previous === null
        ? "there is no comparable window before this one, so no direction can be given."
        : previous.wins === 0
          ? "the window before this one had no wins at all, so a percentage comparison would be meaningless."
          : (() => {
              const delta = Math.round((scoped.classified_pct_wins - previous.classified_pct_wins) * 10) / 10;
              if (delta === 0) return "classified coverage is exactly level with the window before.";
              return `classified coverage is ${Math.abs(delta)} points ${delta > 0 ? "higher" : "lower"} than the window before.`;
            })();

    return {
      answers: {
        client: account,
        date_from: from,
        date_to: to,
        window_days: windowLength(from, to),
        units: "Money is in CENTS.",
        this_window: summarise(from, to, scoped),
        // ALWAYS present, and this is the law from Brick 2 rather than a
        // convenience: every unclassified win in this database carries no
        // creator at all, so a per-creator coverage number that stood on its
        // own would be reconcilable with nothing.
        business_wide: {
          ...summarise(from, to, businessWide),
          roster: roster,
          why_always_shown:
            "Every awaiting-review win carries no creator, because nobody has classified it yet. A per-creator coverage number on its own therefore cannot be reconciled with the money, which is exactly how a false 100% gets reported. This block is here on every answer so it never has to be asked for.",
        },
        trend_prior_windows: trend,
        movement,
        deposits_pending_close: {
          rows: deposits.rows,
          cash_usd_cents: deposits.cash_usd_cents,
          rows_detail: deposits.detail,
          note:
            "Cash-bearing PCFU rows: money in the door from someone the closers have not closed yet. Per win_definition v1 these are NOT wins and are never counted as wins, because a PCFU person who later buys gets a NEW row with outcome WIN and counting both would double them. They are surfaced here so the cash is visible rather than lost.",
        },
        bucket_key: {
          ad: "a machine-stamped keyword, or a human resolution to an ad.",
          organic: "a marked organic keyword from the registry, or a human resolution to organic. Never enters ad ROAS.",
          misc_chat:
            "the team's own callType label reading Miscellaneous Chat, where the keyword is unknown. A CLASSIFIED bucket, not dark data: the team deliberately does not chase these.",
          awaiting_review: "nobody has looked yet. The only bucket that counts as a gap.",
        },
        how_to_shrink_the_gap:
          "Ask resolution_queue for the working list. Every row there is one awaiting-review win with its ManyChat link. Resolving one moves it out of the gap on the next label run.",
      },
      asOf: [],
      usedParams: { client: account, date_from: from, date_to: to },
      window: { from, to },
      coverageClients: subjects,
    };
  },
};
