// ─────────────────────────────────────────────────────────────────────────
// THE LOCKED QUESTION LIST — version 1, twelve questions.
//
// THE TEMPLATE RULE, which is the heart of Build 4: every allowed question maps
// to exactly ONE fixed template that lives here, is unit-tested, and is the only
// way that question is ever answered. No AI composes SQL through this door. A
// question that is not on this list is refused in writing, with the nearest
// allowed question named, rather than improvised.
//
// Adding a question later is a reviewed change to this file. It is never drift.
//
// Every entry says, in its own comment, which stored place its numbers come
// from and why that place is allowed to be read. The rule those comments follow:
// where a number already exists in the saved answers, the template returns THAT
// number. Stamps, receipts, the change log, the merged ads and people tables,
// and the accuracy rows are stored facts too, so a template may read and count
// them inside its own fixed shape. Nothing here joins raw tables freely.
// ─────────────────────────────────────────────────────────────────────────

import { rangeForPreset, todayEt } from "@/lib/ads-v2/time";
import type { BaseMetrics } from "@/lib/ads-v2/types";
import {
  ANSWERABLE_METRIC_KEYS,
  adLeaves,
  checkMetricKeys,
  describeMissingWindow,
  listLiveWindows,
  metricValue,
  readStoredWindow,
} from "./answers";
import {
  optionalInt,
  optionalStatus,
  optionalText,
  rejectUnknown,
  requireAccount,
  requireClient,
  requireDay,
  requireRange,
  requireText,
} from "./params";
import { BadParams, type AsOf, type QuestionEntry, type TemplateContext } from "./types";

// The stored places, named once so every answer spells them the same way.
const S_ANSWERS = "warehouse.answers";
const S_DEFS = "warehouse.definitions";
const S_CHANGES = "warehouse.ad_changes";
const S_ADS = "warehouse.ads";
const S_PEOPLE = "warehouse.people";
const S_HEALTH = "warehouse.accuracy_checks";
const S_DM = "adsv2_dm_facts";
const S_BOOK = "adsv2_booking_facts";
const S_SALE = "adsv2_sale_facts";

/** Rows arrive from the database as loose objects; this is the honest name. */
type Row = Record<string, unknown>;

async function rpc(ctx: TemplateContext, fn: string, args: Row): Promise<Row[]> {
  const { data, error } = await ctx.db.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return (data || []) as Row[];
}

/** The accounts a window question may name: the active roster, plus "all". */
function accountsFor(ctx: TemplateContext): string[] {
  return ["all", ...ctx.clients];
}

// ─────────────────────────────────────────────────────────────────────────
// 1. metric_value — any defined metric, per active creator, per SAVED window,
//    for the whole window or per ad.
//    Source: warehouse.answers ONLY. A window that was not saved is refused,
//    never built, because a number this door invents is a number the tab has
//    never seen.
// ─────────────────────────────────────────────────────────────────────────

const metric_value: QuestionEntry = {
  key: "metric_value",
  description:
    "The value of any defined metric for one active creator (or all of them together), for a window that has already been saved. Either the whole window's total or a row per ad.",
  params:
    "client (tyson, jake, or all), date_from and date_to (YYYY-MM-DD, and the pair must match a saved window), status (active, finished, or all; defaults to all), metrics (a list of metric keys; defaults to every one), scope (total or per_ad; defaults to total).",
  sources: [S_ANSWERS, S_DEFS],
  freshnessSources: [S_ANSWERS],
  budgetMs: 20_000,
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "date_from", "date_to", "status", "metrics", "scope"]);
    const account = requireAccount(params, ctx.clients);
    const { from, to } = requireRange(params);
    const status = optionalStatus(params);
    const scope = String(params.scope ?? "total").toLowerCase();
    if (scope !== "total" && scope !== "per_ad") {
      throw new BadParams('scope must be "total" or "per_ad".');
    }
    const requested = Array.isArray(params.metrics) && params.metrics.length
      ? checkMetricKeys(params.metrics as string[])
      : [...ANSWERABLE_METRIC_KEYS];

    const key = { account, from, to, status };
    const row = await readStoredWindow(ctx.db, key);
    if (!row) {
      const { windows } = await listLiveWindows(ctx.db);
      throw new BadParams(describeMissingWindow(key, windows));
    }

    const read = (base: BaseMetrics) =>
      Object.fromEntries(requested.map((m) => [m, metricValue(m, base)]));

    const answers: Row = {
      account,
      date_from: from,
      date_to: to,
      status,
      data_version: row.data_version,
      saved_at: row.computed_at,
      units:
        "Money is in CENTS. Rates (CTR, show rate, close rate, DM to call) are a share between 0 and 1. Collected ROAS is a multiple. Each metric's quoted definition names its format.",
      total: read(row.payload.total),
    };
    if (scope === "per_ad") {
      answers.ads = adLeaves(row.payload).map((a) => ({
        ad_id: a.ad_id,
        ad_name: a.ad_name,
        keyword: a.keyword,
        client: a.client_key,
        campaign: a.campaign_name,
        ad_set: a.adset_name,
        status: a.status,
        ...read(a.base),
      }));
    }
    return {
      answers,
      definitionKeys: requested,
      asOf: [],
      usedParams: { client: account, date_from: from, date_to: to, status, scope, metrics: requested },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 2. yesterday_summary — yesterday's saved numbers for one creator, plus every
//    ad change made yesterday.
//    Sources: the SAVED yesterday window (a saved answer, not a recount) and
//    the change log. Yesterday is worked out in Eastern time, the only day
//    boundary this system has.
// ─────────────────────────────────────────────────────────────────────────

const yesterday_summary: QuestionEntry = {
  key: "yesterday_summary",
  description:
    "Yesterday for one creator: spend, DMs, calls booked, calls taken, closes and cash from the saved answer, plus every change made to an ad, ad set or campaign yesterday.",
  params: "client (tyson, jake, or all). Nothing else; yesterday is worked out in Eastern time.",
  sources: [S_ANSWERS, S_CHANGES, S_DEFS],
  freshnessSources: [S_ANSWERS, S_CHANGES],
  budgetMs: 25_000,
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account"]);
    const account = requireAccount(params, ctx.clients);
    const range = rangeForPreset("yesterday", todayEt(ctx.now));
    const key = { account, from: range.from, to: range.to, status: "all" };
    const row = await readStoredWindow(ctx.db, key);
    if (!row) {
      const { windows } = await listLiveWindows(ctx.db);
      throw new BadParams(describeMissingWindow(key, windows));
    }
    const headline = ["spend", "messages", "booked", "taken", "newClients", "collected", "collectedRoi"];
    const clients = account === "all" ? [...ctx.clients] : [account];
    const changes = await rpc(ctx, "question_door_change_history", {
      p_clients: clients,
      p_from: range.from,
      p_to: range.to,
      p_level: null,
      p_entity_id: null,
      p_limit: 500,
    });
    return {
      answers: {
        account,
        day: range.from,
        saved_at: row.computed_at,
        units: "Money is in CENTS. Collected ROAS is a multiple.",
        totals: Object.fromEntries(headline.map((m) => [m, metricValue(m, row.payload.total)])),
        changes_made_yesterday: changes,
        changes_count: changes.length,
      },
      definitionKeys: headline,
      asOf: [],
      usedParams: { client: account, day: range.from },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 3. change_history — what changed on an ad, ad set or campaign (or everything)
//    in a date range: the exact time, the old and new values, and who did it.
//    Source: the change log. Exact ids only; a name is never searched, because
//    two things can share a name and a wrong answer here reads as fact.
// ─────────────────────────────────────────────────────────────────────────

const change_history: QuestionEntry = {
  key: "change_history",
  description:
    "Every recorded change to an ad, ad set or campaign in a date range: turned on, turned off, created, or a budget moved, with the exact time, the old and new values, and who did it.",
  params:
    "client (tyson, jake, or all), date_from and date_to (YYYY-MM-DD), level (ad, adset or campaign; optional), entity_id (an exact id; optional), limit (1 to 2000; defaults to 500).",
  sources: [S_CHANGES],
  freshnessSources: [S_CHANGES],
  budgetMs: 25_000,
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "date_from", "date_to", "level", "entity_id", "limit"]);
    const account = requireAccount(params, ctx.clients);
    const { from, to } = requireRange(params);
    const level = optionalText(params, "level");
    if (level && !["ad", "adset", "campaign"].includes(level)) {
      throw new BadParams('level must be one of: ad, adset, campaign.');
    }
    const entityId = optionalText(params, "entity_id");
    const limit = optionalInt(params, "limit", 500, 1, 2000);
    const clients = account === "all" ? [...ctx.clients] : [account];
    const rows = await rpc(ctx, "question_door_change_history", {
      p_clients: clients,
      p_from: from,
      p_to: to,
      p_level: level,
      p_entity_id: entityId,
      p_limit: limit,
    });
    return {
      answers: {
        account,
        date_from: from,
        date_to: to,
        level: level ?? "all levels",
        entity_id: entityId ?? "everything",
        returned: rows.length,
        limit,
        truncated: rows.length === limit,
        coverage_note:
          "Exact change times come from Meta's own activity history, which reaches back to 30 September 2024 for Tyson and 3 August 2024 for Jake. Day-level budget changes derived from our own daily budget photos start 23 July 2026. There is nothing before those dates to get.",
        changes: rows,
      },
      definitionKeys: ["budget"],
      asOf: [],
      usedParams: { client: account, date_from: from, date_to: to, level, entity_id: entityId, limit },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 4. why_unattributed — why a specific booking, sale or DM carries no ad.
//    Source: the stamp columns on the fact rows. The reason was written the
//    hour the row arrived, so this reads it back rather than investigating.
//    Found by an exact fact key or an exact person id. A name returns a
//    labelled candidate list and never a single silent answer.
// ─────────────────────────────────────────────────────────────────────────

const why_unattributed: QuestionEntry = {
  key: "why_unattributed",
  description:
    "Why one booking, sale or DM carries no ad. Returns the written reason exactly as it was stamped, plus the evidence detail behind it.",
  params:
    "client (tyson or jake), kind (booking, sale or dm), and ONE of: fact_key (the exact appointment, sale or event key), person_id (the exact GoHighLevel contact id for a booking, or the exact ManyChat subscriber id otherwise), or name (which returns a candidate list only, never a single answer).",
  sources: [S_BOOK, S_SALE, S_DM, S_PEOPLE],
  freshnessSources: [S_BOOK, S_SALE, S_DM],
  budgetMs: 25_000,
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "kind", "fact_key", "person_id", "name"]);
    const client = requireClient(params, ctx.clients);
    const kind = requireText(params, "kind").toLowerCase();
    if (!["booking", "sale", "dm"].includes(kind)) {
      throw new BadParams("kind must be one of: booking, sale, dm.");
    }
    const factKey = optionalText(params, "fact_key");
    const personId = optionalText(params, "person_id");
    const name = optionalText(params, "name");
    if (!factKey && !personId && !name) {
      throw new BadParams(
        "give one of fact_key, person_id or name. Without one of them there is no row to explain, and this door never picks a row for you.",
      );
    }
    if (name && !factKey && !personId) {
      // A name is not a key. Return who it could be, and stop there.
      const candidates = await rpc(ctx, "question_door_person_candidates", {
        p_client: client,
        p_name: name,
        p_limit: 25,
      });
      return {
        answers: {
          client,
          kind,
          asked_by_name: name,
          answered: false,
          why_not:
            "A name is never used as a key in this system, because two people can share one and a wrong answer here would read as fact. Here is the labelled candidate list. Pick the right person, then ask again with their exact id.",
          candidates,
        },
        asOf: [],
        usedParams: { client, kind, name },
      };
    }
    const rows = await rpc(ctx, "question_door_why_unattributed", {
      p_client: client,
      p_kind: kind,
      p_fact_key: factKey,
      p_person_id: personId,
    });
    return {
      answers: {
        client,
        kind,
        looked_up_by: factKey ? "fact_key" : "person_id",
        found: rows.length,
        reason_key:
          "blank_reason is the written reason there is no ad. evidence_key is the hard key that proved a match where one exists. Both were stamped when the row arrived.",
        rows,
      },
      asOf: [],
      usedParams: { client, kind, fact_key: factKey, person_id: personId },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 5. ad_setup — everything about how one ad is configured.
//    Source: warehouse.ads, the merged row that already answers copy, image
//    words, audience, placements, budget dial, campaign, status and run dates.
// ─────────────────────────────────────────────────────────────────────────

const ad_setup: QuestionEntry = {
  key: "ad_setup",
  description:
    "How one ad is set up: its written copy, the words on its image, its audience, its placements, where its budget dial lives, its campaign and ad set, its status, and the first and last day it spent.",
  params:
    "client (tyson or jake), and ONE of keyword (the ad's keyword, matched exactly) or ad_id (the exact Meta ad id). A keyword that ran as more than one ad returns every one of them rather than one being picked.",
  sources: [S_ADS],
  freshnessSources: [S_ADS],
  budgetMs: 20_000,
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "keyword", "ad_id"]);
    const client = requireClient(params, ctx.clients);
    const keyword = optionalText(params, "keyword");
    const adId = optionalText(params, "ad_id");
    if (!keyword && !adId) throw new BadParams("give either keyword or ad_id.");
    const rows = await rpc(ctx, "question_door_ad_setup", {
      p_client: client,
      p_keyword: keyword,
      p_ad_id: adId,
    });
    return {
      answers: {
        client,
        looked_up_by: adId ? "ad_id" : "keyword",
        found: rows.length,
        note:
          rows.length > 1
            ? "This keyword ran as more than one ad. Every one is listed; spend is per ad, while the keyword's funnel numbers are a keyword-level truth."
            : undefined,
        ads: rows,
      },
      definitionKeys: ["budget", "spend"],
      asOf: [],
      usedParams: { client, keyword, ad_id: adId },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 6. person_lookup — who a person is and what they did.
//    Sources: warehouse.people plus their stamped facts. An exact id or handle
//    gives the person; a name gives a labelled candidate list and nothing more.
// ─────────────────────────────────────────────────────────────────────────

const person_lookup: QuestionEntry = {
  key: "person_lookup",
  description:
    "One person: every id they have in every tool, when they were first and last seen, and their stamped DMs, bookings and sales. Looked up by an exact id or handle. A name returns a candidate list only.",
  params:
    "ONE of id (an exact ManyChat, GoHighLevel or Instagram id, or the person key), handle (an exact Instagram handle), or name (candidate list only). client (tyson or jake) is optional and narrows the search.",
  sources: [S_PEOPLE, S_DM, S_BOOK, S_SALE],
  freshnessSources: [S_PEOPLE, S_DM, S_BOOK, S_SALE],
  budgetMs: 30_000,
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "id", "handle", "name"]);
    const client = params.client || params.account ? requireClient(params, ctx.clients) : null;
    const id = optionalText(params, "id");
    const handle = optionalText(params, "handle");
    const name = optionalText(params, "name");
    if (!id && !handle && !name) throw new BadParams("give one of id, handle or name.");

    if (!id && !handle) {
      const candidates = await rpc(ctx, "question_door_person_candidates", {
        p_client: client,
        p_name: name,
        p_limit: 25,
      });
      return {
        answers: {
          asked_by_name: name,
          answered: false,
          why_not:
            "Names are for reading, never for keying. This is the labelled candidate list; each row shows the exact ids you can ask with.",
          candidates,
        },
        asOf: [],
        usedParams: { client, name },
      };
    }

    const people = await rpc(ctx, "question_door_person_by_id", {
      p_client: client,
      p_id: id,
      p_handle: handle,
    });
    const withEvents = [];
    for (const p of people) {
      const events = await rpc(ctx, "question_door_person_events", {
        p_client: p.client_key,
        p_subscriber_ids: (p.manychat_subscriber_ids as string[]) || [],
        p_contact_ids: (p.ghl_contact_ids as string[]) || [],
      });
      withEvents.push({ ...p, events, event_count: events.length });
    }
    return {
      answers: {
        looked_up_by: id ? "id" : "handle",
        found: withEvents.length,
        people: withEvents,
        conflict_note:
          "has_identity_conflict marks a person whose ids disagree across tools. It is flagged rather than silently merged.",
      },
      asOf: [],
      usedParams: { client, id, handle },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 7. sales_cycle — how long it takes a DM to become money.
//    Source: the stamped sale facts joined to the stamped DM facts inside one
//    fixed template. It reports what it could NOT measure alongside what it could.
// ─────────────────────────────────────────────────────────────────────────

const sales_cycle: QuestionEntry = {
  key: "sales_cycle",
  description:
    "How many days pass between a person first sending an ad's keyword and the day they buy, for sales that carry hard evidence. Reported as the middle, the quarters, and the ninetieth day mark.",
  params: "client (tyson or jake), date_from and date_to (YYYY-MM-DD), filtering on the day of the sale.",
  sources: [S_SALE, S_DM],
  freshnessSources: [S_SALE, S_DM],
  budgetMs: 35_000,
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "date_from", "date_to"]);
    const client = requireClient(params, ctx.clients);
    const { from, to } = requireRange(params);
    const rows = await rpc(ctx, "question_door_sales_cycle", {
      p_client: client,
      p_from: from,
      p_to: to,
    });
    const r = rows[0] || {};
    return {
      answers: {
        client,
        date_from: from,
        date_to: to,
        days_from_first_keyword_to_close: {
          measured_sales: r.measured_sales ?? 0,
          could_not_measure: r.excluded_sales ?? 0,
          p25: r.p25_days ?? null,
          median: r.median_days ?? null,
          p75: r.p75_days ?? null,
          p90: r.p90_days ?? null,
          fastest: r.min_days ?? null,
          slowest: r.max_days ?? null,
          within_7_days: r.within_7_days ?? 0,
          within_14_days: r.within_14_days ?? 0,
        },
        cohort_note:
          "A sale is measured only when it carries a hard evidence key, a keyword, and a ManyChat id, AND that same person has a stamped DM of that same keyword on or before the day they bought. Sales that fail any of those are counted under could_not_measure rather than quietly dropped.",
      },
      asOf: [],
      usedParams: { client, date_from: from, date_to: to },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 8. attribution_share — where a window's cash actually sits.
//    Source: the stamped sale facts. Roster-wide on purpose: cash with no ad
//    evidence carries no creator, because the engine refuses to guess one.
// ─────────────────────────────────────────────────────────────────────────

const attribution_share: QuestionEntry = {
  key: "attribution_share",
  description:
    "Where a window's cash sits: proved to an active creator's ad and counted by the tab, proved but still held back for review, honestly labelled as a former creator's ad, or carrying no ad evidence at all with the written reason.",
  params:
    "date_from and date_to (YYYY-MM-DD), filtering on the day of the sale. This question is roster-wide: cash with no ad evidence has no creator on it, so it cannot be asked per creator.",
  sources: [S_SALE],
  freshnessSources: [S_SALE],
  budgetMs: 35_000,
  async run(ctx, params) {
    rejectUnknown(params, ["date_from", "date_to"]);
    const { from, to } = requireRange(params);
    const rows = await rpc(ctx, "question_door_attribution_share", {
      p_active_clients: [...ctx.clients],
      p_from: from,
      p_to: to,
    });
    const totals: Record<string, { sales: number; wins: number; cash_usd_cents: number }> = {};
    for (const r of rows) {
      const b = String(r.bucket);
      totals[b] = totals[b] || { sales: 0, wins: 0, cash_usd_cents: 0 };
      totals[b].sales += Number(r.sales) || 0;
      totals[b].wins += Number(r.wins) || 0;
      totals[b].cash_usd_cents += Number(r.cash_usd_cents) || 0;
    }
    return {
      answers: {
        date_from: from,
        date_to: to,
        active_roster: [...ctx.clients],
        units: "Money is in CENTS.",
        totals_by_bucket: totals,
        rows,
        bucket_key: {
          counted_by_the_tab:
            "a hard evidence key, a keyword, an active creator, and nothing held back. This is the ONLY bucket the Ads v2 tab's saved cash counts.",
          proved_but_held_back:
            "an evidence key exists but the row is still marked awaiting review, so the tab leaves it out.",
          former_creator_ad:
            "the honest label for a sale that came through a creator who has since left the roster.",
          no_ad_evidence:
            "nothing proved an ad. The written reason is on the row. These rows carry no creator, by design.",
        },
      },
      definitionKeys: ["collected"],
      asOf: [],
      usedParams: { date_from: from, date_to: to },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 9. leak_map — where attribution leaks, and which way it is moving.
//    Source: the written blank reasons on the stamped facts.
// ─────────────────────────────────────────────────────────────────────────

const leak_map: QuestionEntry = {
  key: "leak_map",
  description:
    "Every written reason a booking, sale or DM in a window carries no ad, counted, with the cash behind the sales, plus how keywordless bookings compare with the window before.",
  params: "date_from and date_to (YYYY-MM-DD). Roster-wide, for the same reason attribution_share is.",
  sources: [S_BOOK, S_SALE, S_DM],
  freshnessSources: [S_BOOK, S_SALE, S_DM],
  budgetMs: 35_000,
  async run(ctx, params) {
    rejectUnknown(params, ["date_from", "date_to"]);
    const { from, to } = requireRange(params);
    const [rows, trend] = await Promise.all([
      rpc(ctx, "question_door_leak_map", { p_from: from, p_to: to }),
      rpc(ctx, "question_door_leak_trend", { p_from: from, p_to: to }),
    ]);
    return {
      answers: {
        date_from: from,
        date_to: to,
        units: "Money is in CENTS. Cash is only shown for sales.",
        by_reason: rows,
        keywordless_booking_trend: trend,
        reason_key: {
          no_utm_on_booking_link:
            "the person booked through a link that carried no keyword tag. This is the biggest fixable gap and it is fixable at the source.",
          keyword_after_booking:
            "the person sent a keyword, but only after they had already booked, so the ad did not earn the booking.",
          no_keyword_ever: "this person never sent a keyword at all.",
          former_creator_ad: "the sale came through a creator who has since left the roster.",
          unknown: "nothing in the record proved an ad, and no narrower reason applied.",
        },
      },
      asOf: [],
      usedParams: { date_from: from, date_to: to },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 10. kill_scale_inputs — the facts a kill-or-scale decision is made ON.
//     Source: the saved answer for the window, plus each ad's run dates from
//     the merged ads table. It returns INPUTS. The verdict is not the
//     service's to give, and the answer says so in one line.
// ─────────────────────────────────────────────────────────────────────────

const kill_scale_inputs: QuestionEntry = {
  key: "kill_scale_inputs",
  description:
    "For every ad in a saved window: spend, days live, DMs, calls booked, closes, cash and collected ROAS, presented as the inputs a kill-or-scale decision is made on.",
  params:
    "client (tyson, jake, or all), date_from and date_to (YYYY-MM-DD, matching a saved window), status (defaults to active, since a decision is about ads that are running).",
  sources: [S_ANSWERS, S_ADS, S_DEFS],
  freshnessSources: [S_ANSWERS, S_ADS],
  budgetMs: 30_000,
  async run(ctx, params) {
    rejectUnknown(params, ["client", "account", "date_from", "date_to", "status"]);
    const account = requireAccount(params, ctx.clients);
    const { from, to } = requireRange(params);
    const status = params.status === undefined ? "active" : optionalStatus(params);
    const key = { account, from, to, status };
    const row = await readStoredWindow(ctx.db, key);
    if (!row) {
      const { windows } = await listLiveWindows(ctx.db);
      throw new BadParams(describeMissingWindow(key, windows));
    }
    const clients = account === "all" ? [...ctx.clients] : [account];
    const runDates = new Map<string, Row>();
    for (const c of clients) {
      for (const r of await rpc(ctx, "question_door_ad_run_dates", { p_client: c })) {
        runDates.set(String(r.ad_id), r);
      }
    }
    const metrics = ["spend", "messages", "booked", "taken", "newClients", "collected", "collectedRoi", "costPerMessage", "costPerBooked"];
    const ads: Row[] = adLeaves(row.payload).map((a) => {
      const run = runDates.get(a.ad_id) || {};
      return {
        ad_id: a.ad_id,
        ad_name: a.ad_name,
        keyword: a.keyword,
        client: a.client_key,
        campaign: a.campaign_name,
        ad_set: a.adset_name,
        status: a.status,
        days_live: run.days_live ?? null,
        first_active_day: run.first_active_day ?? null,
        last_active_day: run.last_active_day ?? null,
        budget_level: run.budget_level ?? null,
        daily_budget_usd_cents: run.daily_budget_usd_cents ?? null,
        ...Object.fromEntries(metrics.map((m) => [m, metricValue(m, a.base)])),
      };
    });
    ads.sort((x, y) => (Number(y.spend) || 0) - (Number(x.spend) || 0));
    return {
      answers: {
        account,
        date_from: from,
        date_to: to,
        status,
        saved_at: row.computed_at,
        units: "Money is in CENTS. Collected ROAS is a multiple.",
        ads,
      },
      definitionKeys: metrics,
      asOf: [],
      usedParams: { client: account, date_from: from, date_to: to, status },
      note:
        "These are INPUTS, not a verdict. This service does not decide whether to kill or scale an ad; that judgement belongs to a person, using the standing decision rules.",
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 11. data_health — the latest accuracy run, verbatim.
//     Source: warehouse.accuracy_checks. Nothing summarised away: every row,
//     its status, its written tolerance note and its what-to-do text.
// ─────────────────────────────────────────────────────────────────────────

const data_health: QuestionEntry = {
  key: "data_health",
  description:
    "The most recent daily accuracy run, every row exactly as recorded: what was compared, the two numbers, green, amber or red, the written tolerance, and what to do about it.",
  params: "none.",
  sources: [S_HEALTH],
  freshnessSources: [S_HEALTH],
  budgetMs: 20_000,
  async run(ctx, params) {
    rejectUnknown(params, []);
    const rows = await rpc(ctx, "question_door_data_health", {});
    const counts: Record<string, number> = { green: 0, amber: 0, red: 0, error: 0 };
    for (const r of rows) counts[String(r.status)] = (counts[String(r.status)] || 0) + 1;
    return {
      answers: {
        checks: rows.length,
        counts,
        ran_at: rows.length ? rows[rows.length - 1].ran_at : null,
        et_day: rows.length ? rows[0].et_day : null,
        rows,
        status_key: {
          green: "the numbers agree.",
          amber: "they differ for a written, understood reason.",
          red: "a real disagreement. Any difference in actual money is red, always.",
          error: "the check itself could not run, so it proved nothing today.",
        },
      },
      asOf: [],
      usedParams: {},
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 12. define — quote a metric's stored meaning, or list them all.
//     Source: warehouse.definitions, the one written meaning per number.
// ─────────────────────────────────────────────────────────────────────────

const define: QuestionEntry = {
  key: "define",
  description:
    "The stored meaning of any number this system reports, quoted exactly as written, or all twenty-one of them.",
  params: "metric (one metric key; optional. Leave it out to get every definition).",
  sources: [S_DEFS],
  freshnessSources: [S_DEFS],
  budgetMs: 15_000,
  async run(ctx, params) {
    rejectUnknown(params, ["metric"]);
    const metric = optionalText(params, "metric");
    const rows = await rpc(ctx, "question_door_definitions", {
      p_keys: metric ? [metric] : null,
    });
    if (metric && !rows.length) {
      throw new BadParams(
        `"${metric}" is not a number this system defines. Ask define with no metric to see all twenty-one.`,
      );
    }
    return {
      answers: { asked_for: metric ?? "everything", count: rows.length, definitions: rows },
      asOf: [],
      usedParams: { metric },
    };
  },
};

/** THE LOCKED LIST. Order is the order a caller should read them in. */
export const QUESTIONS: readonly QuestionEntry[] = [
  metric_value,
  yesterday_summary,
  change_history,
  why_unattributed,
  ad_setup,
  person_lookup,
  sales_cycle,
  attribution_share,
  leak_map,
  kill_scale_inputs,
  data_health,
  define,
];

export const QUESTION_KEYS: readonly string[] = QUESTIONS.map((q) => q.key);

export const QUESTION_BY_KEY: Record<string, QuestionEntry> = Object.fromEntries(
  QUESTIONS.map((q) => [q.key, q]),
);

/** The accounts every window question accepts, for the refusal text. */
export function servedAccounts(ctx: TemplateContext): string[] {
  return accountsFor(ctx);
}

/** Kept for the tests: an entry's declared freshness sources must be real. */
export const ALL_KNOWN_SOURCES: readonly string[] = [
  S_ANSWERS,
  S_DEFS,
  S_CHANGES,
  S_ADS,
  S_PEOPLE,
  S_HEALTH,
  S_DM,
  S_BOOK,
  S_SALE,
];

export type { AsOf };
