// ─────────────────────────────────────────────────────────────────────────
// 16. resolution_queue: the working list, in one call.
//
// coverage_report says the gap is 41 wins and 40,195.00 USD. This says WHICH
// 41, newest first, with the ManyChat link on each one, which is the whole
// reason a person can clear one of these in under a minute.
//
// This is the list Alex hand-worked on 2026-07-31 and again on 2026-08-07. It
// was rebuilt by hand both times, from a fresh query written on the day. That
// is the thing being replaced: a working list that has to be reconstructed
// before it can be worked is a list nobody works.
//
// door_miss_backlog is the certification backlog for QUESTIONS. This is the
// certification backlog for MONEY, and the two are the same idea pointed at
// different gaps.
//
// IT DECIDES NOTHING. Every row is a row for a person to look at. The answer
// says how to record what they find and never guesses at what they will find.
// ─────────────────────────────────────────────────────────────────────────

import { optionalInt, rejectUnknown } from "./params";
import type { QuestionEntry, TemplateContext } from "./types";

type Row = Record<string, unknown>;

/** How a person records a decision once they have looked. Stated on every
 *  answer, because a queue that does not say how to clear it is a report. */
const HOW_TO_RESOLVE =
  'Write one row into adsv2_sale_resolutions with the sale_key from this list. Put the keyword in keyword_normalized to attribute the sale to that keyword; leave keyword_normalized NULL to record "I looked, this is not an ad sale", which is a resolution too and closes the row just as firmly. Fill in resolved_by with who decided and note with what they saw. The labeler applies it on the next run: a keyword resolution stamps the keyword, and a NULL-keyword resolution stamps blank_reason human_confirmed_non_ad. Either way the row leaves this queue and stops being re-reviewed.';

export const resolution_queue: QuestionEntry = {
  key: "resolution_queue",
  description:
    "Every win still awaiting review, newest first: the day, the person, the cash, the tracker call type, the setter, the closer and the ManyChat link, so each one can be looked at and decided. Plus the zero-cash oddities listed separately so they stop haunting the queue.",
  params: "limit (1 to 500; defaults to 100). Nothing else: the queue is the whole gap, business-wide, by design.",
  sources: ["adsv2_sale_facts", "sales_tracker_rows", "ads_keyword_events"],
  freshnessSources: ["adsv2_sale_facts", "sales_tracker_rows"],
  budgetMs: 30_000,
  // Version 1. It reads sale rows and reports their cash, so it is a money
  // answer and carries the coverage block: a queue that did not say what share
  // of the money it represents would be a list without a denominator.
  receipt: {
    version: 1,
    windowKind: "explicit_range",
    money: true,
    usesDataVersion: false,
    exclusions: [
      {
        what: "wins that have already been classified",
        count: 0,
        why: "this question is the OUTSTANDING work only. A win already stamped as ad, organic, misc chat or human-confirmed non-ad is finished, and listing it again would mean the queue never appeared to empty. Ask coverage_report for the whole picture.",
      },
    ],
    definitionsCited: ["certainty_buckets", "coverage", "win_definition"],
  },
  async run(ctx: TemplateContext, params) {
    rejectUnknown(params, ["limit"]);
    const limit = optionalInt(params, "limit", 100, 1, 500);

    const { data, error } = await ctx.db.rpc("door_resolution_queue", { p_limit: limit });
    if (error) throw new Error(`could not read the resolution queue: ${error.message}`);
    const rows = (data || []) as Row[];

    // THE HUGO MAGANA CLASS, listed separately.
    //
    // A zero-cash win sits in the queue forever: it is worth nothing, so it is
    // never worth anyone's minute, so it is never resolved, so it is counted in
    // every coverage number as an open gap. It quietly makes the queue look
    // worse than it is and trains readers to skim past the last few rows.
    //
    // Splitting them out is not hiding them. They stay counted in the totals
    // and in every coverage block. They are simply named, so the rows that are
    // worth a minute are not buried behind the rows that are not.
    const zeroCash = rows.filter((r) => (Number(r.collected_usd_cents) || 0) === 0);
    const worthLooking = rows.filter((r) => (Number(r.collected_usd_cents) || 0) > 0);

    const shape = (r: Row) => ({
      sale_key: r.sale_key,
      day: r.sale_et_day,
      prospect: r.prospect_name,
      client: r.client_key,
      cash_usd_cents: r.collected_usd_cents,
      call_type: r.call_type,
      setter: r.setter_name,
      closer: r.closer,
      subscriber_id: r.subscriber_id,
      manychat_link: r.manychat_link,
      // A subscriber who DID produce keyword events but whose sale carries no
      // keyword is the fastest kind of row to resolve, so it is flagged rather
      // than left to be discovered one thread at a time.
      subscriber_has_keyword_events: r.has_keyword_events,
      blank_reason: r.blank_reason,
    });

    const totalCash = rows.reduce((s, r) => s + (Number(r.collected_usd_cents) || 0), 0);
    const withLink = rows.filter((r) => Boolean(r.manychat_link)).length;
    const fastest = worthLooking.filter((r) => r.has_keyword_events === true).length;

    return {
      answers: {
        returned: rows.length,
        limit,
        truncated: rows.length === limit,
        total_cash_usd_cents: totalCash,
        units: "Money is in CENTS.",
        with_manychat_link: withLink,
        without_manychat_link: rows.length - withLink,
        likely_fastest_to_resolve: fastest,
        queue: worthLooking.map(shape),
        zero_cash_oddities: {
          count: zeroCash.length,
          why_listed_separately:
            "A win worth nothing is never worth anyone's minute, so it is never resolved, so it sits in the gap forever making the queue look worse than it is. These are still counted in every total and in every coverage block. They are listed apart so the rows that are worth a minute are not buried behind the rows that are not.",
          rows: zeroCash.map(shape),
        },
        how_to_resolve: HOW_TO_RESOLVE,
        link_note:
          "The ManyChat link comes from the tracker row, joined on the sale key the fact row already carries, so it is a hard key and never a name match. A row with no link is one whose tracker row carried none; it is still in the queue, because a queue shorter than the gap would be a lie about the gap.",
      },
      asOf: [],
      usedParams: { limit },
      // The queue is business-wide by design, and so is its coverage block: an
      // awaiting-review win has no creator on it precisely because nobody has
      // said whose it is yet.
      coverageClients: [...ctx.clients],
      window: rows.length
        ? {
            from: String(rows[rows.length - 1].sale_et_day),
            to: String(rows[0].sale_et_day),
          }
        : null,
      note: HOW_TO_RESOLVE,
    };
  },
};
