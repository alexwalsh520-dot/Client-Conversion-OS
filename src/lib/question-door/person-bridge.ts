// ─────────────────────────────────────────────────────────────────────────
// 18. person_timeline and 19. lead_quality_read — BRICK 5, the identity
//     bridge's two questions.
//
// Four id systems name the same human and share no key. Measured on the live
// database, 2026-08-08: 7,623 distinct ManyChat subscriber ids, 36,598
// distinct Instagram-scoped ids, and ONE value in common. Every cross-system
// read before this brick was hand-built, and the hand-built ones were built on
// name matching, which is how "Carter Peterson" nearly became "Carter
// Kovalsky".
//
// registry_persons is the bridge. A link exists only where one stored row
// carried both ids; every link records the row that proved it. These two
// questions read that bridge and, just as importantly, report what it could
// NOT bridge, because person_identity v1 says a zero-row join across id
// systems is never evidence of absence.
//
// Neither question judges anything. person_timeline recounts; lead_quality_read
// counts. kill_scale_read is where a signed ruleset turns numbers into a
// verdict, and that separation is the reason any of it can be audited.
// ─────────────────────────────────────────────────────────────────────────

import { optionalText, rejectUnknown, requireClient, requireRange } from "./params";
import { BadParams, type QuestionEntry, type TemplateContext } from "./types";

type Row = Record<string, unknown>;

/** The stored places these two questions read that no earlier question named. */
export const S_PERSONS = "registry_persons";
export const S_PERSON_CONTEXT = "person_context";

async function rpc(ctx: TemplateContext, fn: string, args: Row): Promise<unknown> {
  const { data, error } = await ctx.db.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
}

/**
 * Turn any identifier into exactly one person, or refuse in writing.
 *
 * A name that two live people answer to is NOT resolved. It comes back as a
 * labelled candidate list, the same discipline person_lookup has always used:
 * two people can share a name, and a wrong answer here would read as fact.
 */
async function resolvePerson(
  ctx: TemplateContext,
  identifier: string,
): Promise<{ personId: string | null; candidates: unknown }> {
  const personId = (await rpc(ctx, "registry_person_resolve", { p_identifier: identifier })) as
    | string
    | null;
  if (personId) return { personId, candidates: null };
  const candidates = await rpc(ctx, "door_person_candidates", { p_identifier: identifier, p_limit: 25 });
  return { personId: null, candidates };
}

// ─────────────────────────────────────────────────────────────────────────
// 18. person_timeline
// ─────────────────────────────────────────────────────────────────────────

export const person_timeline: QuestionEntry = {
  key: "person_timeline",
  description:
    "One person's whole story in the order it happened, across every id system: their first DM from the real thread, the keywords they sent, what they booked, whether they showed, what the tracker recorded and what they paid. Says which links are hard evidence and what could not be bridged at all.",
  params:
    "person (any identifier: a ManyChat subscriber id, an Instagram-scoped id, a GoHighLevel contact id, a person_id, or a name. A name that two people answer to returns a candidate list and never a single story).",
  sources: [S_PERSONS, "ads_keyword_events", "dm_conversation_messages", "adsv2_booking_facts", "adsv2_sale_facts", "sales_tracker_rows"],
  freshnessSources: ["adsv2_booking_facts", "adsv2_sale_facts", "dm_conversation_messages"],
  budgetMs: 30_000,
  // Version 1.
  //
  // money is FALSE, and the reason is worth stating. This answer does show
  // cash: the person's own stamped sale rows, quoted back. What it never shows
  // is a window total, and a coverage block measures how much of a WINDOW is
  // classifiable. Attaching one to a single person's story would be a
  // measurement of nothing wearing a trust badge. why_unattributed (4) is
  // money:false for exactly the same reason.
  receipt: {
    version: 1,
    windowKind: null,
    money: false,
    usesDataVersion: false,
    exclusions: [
      {
        what: "events keyed in an id system this person is not bridged to",
        count: 0,
        why:
          "A link exists only where one stored row carried both ids. Where no such row exists, the events on the far side are unreachable and are reported as unbridged rather than left out silently. Under person_identity v1 an empty list is never evidence that nothing happened.",
      },
    ],
    definitionsCited: ["person_identity"],
  },
  async run(ctx, params) {
    rejectUnknown(params, ["person", "id", "name", "client", "account"]);
    const identifier = optionalText(params, "person") ?? optionalText(params, "id") ?? optionalText(params, "name");
    if (!identifier) {
      throw new BadParams(
        "give a person: a ManyChat subscriber id, an Instagram-scoped id, a GoHighLevel contact id, a person_id, or a name.",
      );
    }

    const { personId, candidates } = await resolvePerson(ctx, identifier);

    if (!personId) {
      const list = Array.isArray(candidates) ? candidates : [];
      return {
        answers: {
          asked_for: identifier,
          answered: false,
          why_not:
            list.length > 1
              ? "More than one person answers to this name. Names are for reading, never for keying, so no single story is being returned. Pick the right person and ask again with their person_id or an exact id."
              : "Nothing in the bridge holds this identifier. That means it has not been linked to a person, NOT that the person does not exist: an id only joins a person where a stored row carried it alongside another id.",
          candidates: list,
        },
        asOf: [],
        usedParams: { person: identifier },
      };
    }

    const story = (await rpc(ctx, "door_person_timeline", { p_person_id: personId })) as Row | null;
    if (!story) {
      throw new Error(`the bridge resolved ${identifier} to ${personId} but no person row came back`);
    }

    const couldNotBridge = Array.isArray(story.could_not_bridge) ? story.could_not_bridge : [];
    return {
      answers: {
        ...story,
        units: "Money is in CENTS.",
        reading_note:
          "Events are in the order they happened. A booking with a dm_day_gap is a booking whose first-DM day is unknown, not a booking that came from nowhere.",
      },
      asOf: [],
      usedParams: { person: identifier, person_id: personId },
      exclusions: couldNotBridge.map((why) => ({
        what: "part of this person's story",
        count: 0,
        why: String(why),
      })),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 19. lead_quality_read
// ─────────────────────────────────────────────────────────────────────────

export const lead_quality_read: QuestionEntry = {
  key: "lead_quality_read",
  description:
    "How good a creator's leads were in a window, split by keyword or ad set, with the N beside every claim: how many people sent the keyword, how many of their conversations can actually be read, how deep those went, how many booked, how many showed on the calendar and off it, and what closed.",
  params:
    "client (tyson or jake), date_from and date_to (YYYY-MM-DD), cohort (keyword or ad_set; defaults to keyword).",
  sources: [S_PERSONS, S_PERSON_CONTEXT, "ads_keyword_events", "dm_conversation_messages", "adsv2_booking_facts", "sales_tracker_rows"],
  freshnessSources: ["ads_keyword_events", "adsv2_booking_facts", "dm_conversation_messages"],
  budgetMs: 40_000,
  // Version 1. A money answer over an explicit window, so the service attaches
  // the four signed coverage buckets. Directional on purpose: a window that
  // ends inside the sales lag has not finished producing its cash, however
  // exact each number in it is today.
  receipt: {
    version: 1,
    windowKind: "explicit_range",
    money: true,
    usesDataVersion: false,
    certainty: "directional",
    exclusions: [
      {
        what: "conversation depth for people whose thread cannot be reached",
        count: 0,
        why:
          "DM depth is measured only over the people bridged to a real thread, and every cohort states that number next to the total. A median computed over four of twenty-seven people is a fact about four people, and printing it without the denominator would be the same mistake as reporting coverage over the rows that happened to join.",
      },
    ],
    definitionsCited: ["person_identity", "sales_lag", "coverage"],
  },
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "date_from", "date_to", "cohort"]);
    const client = await requireClient(ctx, params);
    const { from, to } = requireRange(params);
    const cohort = (optionalText(params, "cohort") ?? "keyword").toLowerCase();
    if (cohort !== "keyword" && cohort !== "ad_set") {
      throw new BadParams(
        'cohort must be "keyword" or "ad_set". A geo split cannot be answered: warehouse.ads stores geo_count, which is how MANY places an ad set targeted, and no stored row records which country or region a PERSON was in.',
      );
    }

    const read = (await rpc(ctx, "door_lead_quality", {
      p_client: client,
      p_from: from,
      p_to: to,
      p_cohort: cohort,
    })) as Row;

    const totals = (read.totals ?? {}) as Row;
    const sent = Number(totals.people_who_sent_the_keyword) || 0;
    const bridged = Number(totals.people_bridged_to_a_thread) || 0;

    return {
      answers: read,
      definitionKeys: ["messages", "booked", "taken", "collected"],
      asOf: [],
      usedParams: { client, date_from: from, date_to: to, cohort },
      exclusions: [
        {
          what: "the conversations of people who could not be bridged to a thread",
          count: Math.max(0, sent - bridged),
          why:
            `${bridged} of ${sent} people in this window are bridged to a readable Instagram thread. The rest sent a keyword, so their conversations happened; they are in an id space no stored row links them across. Their bookings, calls and cash are still counted, because those reach them by other keys.`,
        },
      ],
      note:
        "These are counts and observations, not a verdict. This question informs a decision; kill_scale_read applies the signed ruleset and a person decides.",
    };
  },
};
