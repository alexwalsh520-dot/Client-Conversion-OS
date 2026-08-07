// ─────────────────────────────────────────────────────────────────────────
// 17. capture_health: are the pipes that FEED the numbers still running?
//
// health_check (Brick 3) asks whether the ads can deliver. This asks whether
// what they deliver is still being CAPTURED. They are different failures with
// different symptoms, and this one is the quieter and more expensive of the
// two: an ad that stops delivering shows up as a spend of zero, while a
// capture break shows up as nothing at all. The money keeps arriving, it just
// stops being attributable, and by the time anyone notices, the window where
// it could have been recovered has closed.
//
// This is a TRUST answer, not a money answer. Its coverage block is null with
// a note, because a coverage block on a question that reports no cash would be
// a measurement of nothing dressed as a measurement.
//
// ── THE FINDING THAT SHAPED THIS QUESTION ────────────────────────────────
// ads_keyword_events.subscriber_id and dm_conversation_messages.subscriber_id
// are DIFFERENT ID SPACES. Measured on 2026-08-07: 7,585 distinct ids in one,
// 29,897 in the other, and ONE id in common.
//
// The obvious detector for a broken organic automation is "find a person who
// sent the keyword in their DMs and has no keyword event". Across two disjoint
// id spaces that query returns EVERY person, every day, forever, including all
// the ones the automation handled perfectly. It would be a false-alarm engine
// wearing a trust badge, which is worse than having no detector: the first
// week nobody believes it, and the second week nobody reads it.
//
// So the organic detector compares COHORT COUNTS per creator, per keyword, per
// day. It never claims to know that a particular DM belongs to a particular
// event, only that N people said the word on a day and M events were recorded.
// That needs no identity bridge, and it is the signal that actually matters.
// Bridging the id spaces is Brick 5 and is deliberately not attempted here.
// ─────────────────────────────────────────────────────────────────────────

import { shiftDay, todayEt } from "@/lib/ads-v2/time";
import { optionalInt, rejectUnknown, requireAccount } from "./params";
import { readFreshness } from "./sources";
import type { AsOf, Db, QuestionEntry, TemplateContext } from "./types";

type Row = Record<string, unknown>;

/**
 * THREE OUTCOMES, NOT TWO, and the middle one is the point.
 *
 * A pipe with events flowing but misses present is NOT healthy, and it is also
 * not down. Collapsing that into "no_go" makes every partial loss look like an
 * outage and the reader stops reacting to either. Collapsing it into "go"
 * loses the only early warning there is.
 */
export type PipeVerdict = "go" | "degraded" | "no_go";

export interface Pipe {
  pipe: string;
  verdict: PipeVerdict;
  /** What was measured, in plain words, with the numbers in it. */
  evidence: string;
  detail: unknown;
}

/** Take the worst of a set of verdicts. "go" never wins over anything. */
export function worst(verdicts: readonly PipeVerdict[]): PipeVerdict {
  if (verdicts.some((v) => v === "no_go")) return "no_go";
  if (verdicts.some((v) => v === "degraded")) return "degraded";
  return "go";
}

/** The stored staleness threshold for a source, or null when none is set. */
async function thresholdHours(db: Db, source: string): Promise<number | null> {
  const { data, error } = await db
    .from("door_freshness_thresholds")
    .select("threshold_hours")
    .eq("source", source)
    .maybeSingle();
  if (error) return null;
  const n = Number((data as { threshold_hours?: number } | null)?.threshold_hours);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────
// PIPE 1. Keyword events flowing.
// ─────────────────────────────────────────────────────────────────────────

async function keywordFlowPipe(db: Db, clients: readonly string[]): Promise<Pipe> {
  const [{ data, error }, limit] = await Promise.all([
    db.rpc("door_capture_keyword_flow", { p_clients: [...clients] }),
    thresholdHours(db, "ads_keyword_events"),
  ]);
  if (error) throw new Error(`could not read the keyword flow: ${error.message}`);
  const rows = (data || []) as Row[];

  // No threshold means no judgement. The ages are still reported, because an
  // unjudged number a reader can see beats a verdict computed against a rule
  // nobody wrote down.
  if (limit === null) {
    return {
      pipe: "keyword_events_flowing",
      verdict: "degraded",
      evidence:
        'No staleness threshold is stored for ads_keyword_events, so this pipe cannot be judged. The ages are reported unjudged rather than being passed as healthy, because "we did not check" must never read as "it was fine".',
      detail: rows,
    };
  }

  const silent = rows.filter((r) => r.last_event_at === null || (Number(r.hours_since_last) || 0) > limit);
  const never = rows.filter((r) => r.last_event_at === null);
  const verdict: PipeVerdict = never.length ? "no_go" : silent.length ? "no_go" : "go";
  const evidence = never.length
    ? `${never.map((r) => r.client_key).join(", ")} ${never.length === 1 ? "has" : "have"} never produced a keyword event at all. Nothing they run can be attributed.`
    : silent.length
      ? `${silent.map((r) => `${r.client_key} (${r.hours_since_last} hours)`).join(", ")} past the ${limit} hour threshold. A live ad with no keyword events is a capture break, and it is invisible in the money until the sales stop.`
      : `every creator produced a keyword event inside the ${limit} hour threshold: ${rows.map((r) => `${r.client_key} ${r.hours_since_last}h ago`).join(", ")}.`;

  return { pipe: "keyword_events_flowing", verdict, evidence, detail: rows };
}

// ─────────────────────────────────────────────────────────────────────────
// PIPE 2. Webhook keyword misses (the known lead_engaged flow gap).
// ─────────────────────────────────────────────────────────────────────────

async function webhookMissPipe(
  db: Db,
  clients: readonly string[],
  from: string,
  to: string,
  sample: number,
): Promise<Pipe> {
  const { data, error } = await db.rpc("door_capture_webhook_misses", {
    p_clients: [...clients],
    p_from: from,
    p_to: to,
    p_limit: sample,
  });
  if (error) throw new Error(`could not read the webhook misses: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as
    | { rows_with_subscriber?: number; rows_with_zero_events?: number; sample?: unknown }
    | undefined;
  const total = Number(r?.rows_with_subscriber) || 0;
  const misses = Number(r?.rows_with_zero_events) || 0;
  const pct = total ? Math.round((misses / total) * 1000) / 10 : 0;

  // A miss rate is degraded, not down: these sales still arrive and are still
  // counted in the money. What is lost is the ability to say which ad earned
  // them. Only a total loss of capture is a no_go.
  const verdict: PipeVerdict = total === 0 ? "degraded" : misses === total ? "no_go" : misses > 0 ? "degraded" : "go";
  const evidence =
    total === 0
      ? "no sale in this window carried a ManyChat subscriber id at all, so this pipe could not be measured."
      : misses === 0
        ? `every one of the ${total} sales carrying a ManyChat subscriber id has keyword events for that subscriber.`
        : `${misses} of ${total} sales carrying a ManyChat subscriber id (${pct}%) have NO keyword event for that subscriber at all. That is the lead_engaged flow gap: the person is in ManyChat, the sale knows their id, and the webhook never recorded them sending anything. Those sales can never be attributed to an ad by hard evidence.`;

  return {
    pipe: "webhook_keyword_misses",
    verdict,
    evidence,
    detail: { rows_with_subscriber: total, rows_with_zero_events: misses, miss_pct: pct, sample: r?.sample ?? [] },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PIPE 3. Organic automation breaks. Cohort counts, never a person join.
// ─────────────────────────────────────────────────────────────────────────

async function organicBreakPipe(
  db: Db,
  clients: readonly string[],
  from: string,
  to: string,
): Promise<Pipe> {
  const { data, error } = await db.rpc("door_capture_organic_breaks", {
    p_clients: [...clients],
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`could not read the organic breaks: ${error.message}`);
  const rows = (data || []) as Row[];

  const arrivals = rows.filter((r) => (Number(r.dm_senders) || 0) > 0);
  const dead = arrivals.filter((r) => (Number(r.keyword_events) || 0) === 0);
  const senders = arrivals.reduce((s, r) => s + (Number(r.dm_senders) || 0), 0);
  const lost = dead.reduce((s, r) => s + (Number(r.dm_senders) || 0), 0);

  // THE THREE OUTCOMES, and why the middle one exists.
  //
  // Every arrival day dead = the automation is not running. Some dead = it is
  // running and dropping people, which is the state that precedes and follows
  // every outage and is the only one you can act on early.
  const verdict: PipeVerdict =
    arrivals.length === 0 ? "go" : dead.length === arrivals.length ? "no_go" : dead.length > 0 ? "degraded" : "go";

  const evidence =
    arrivals.length === 0
      ? "nobody sent a registered organic keyword in this window, so there was nothing for the automation to catch."
      : dead.length === arrivals.length
        ? `on every one of the ${arrivals.length} days somebody sent a registered organic keyword, ZERO keyword events were recorded (${senders} senders, 0 events). The organic automation is not running.`
        : dead.length > 0
          ? `${lost} of ${senders} organic keyword senders across ${dead.length} of ${arrivals.length} active days produced no keyword event. Events ARE flowing, so the automation is running and dropping people rather than being down.`
          : `all ${senders} organic keyword senders across ${arrivals.length} days produced keyword events.`;

  return {
    pipe: "organic_automation",
    verdict,
    evidence,
    detail: {
      by_day: rows,
      method:
        "COHORT counts per creator, per keyword, per day: how many people sent the word in their DMs against how many keyword events were recorded. It is deliberately NOT a person-to-person join, because ads_keyword_events and dm_conversation_messages use different subscriber id spaces (1 id in common out of 7,585) and joining them would report every organic sender as a break forever. Bridging those spaces is a later brick.",
      what_this_cannot_say:
        "It cannot name WHICH people were dropped, only how many. Naming them needs the identity bridge.",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PIPE 4. Misc-chat recoverables.
// ─────────────────────────────────────────────────────────────────────────

async function miscRecoverablePipe(
  db: Db,
  clients: readonly string[],
  from: string,
  to: string,
  sample: number,
): Promise<Pipe> {
  const { data, error } = await db.rpc("door_capture_misc_recoverable", {
    p_clients: [...clients],
    p_from: from,
    p_to: to,
    p_limit: sample,
  });
  if (error) throw new Error(`could not read the misc-chat recoverables: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as
    | { misc_chat_wins?: number; recoverable?: number; sample?: unknown }
    | undefined;
  const misc = Number(r?.misc_chat_wins) || 0;
  const recoverable = Number(r?.recoverable) || 0;

  return {
    pipe: "misc_chat_recoverable",
    verdict: recoverable > 0 ? "degraded" : "go",
    evidence:
      recoverable > 0
        ? `${recoverable} of ${misc} misc-chat wins belong to a subscriber who DID send a keyword before the sale. Those are misclassifications a person can flip in one look.`
        : `none of the ${misc} misc-chat wins belong to a subscriber with keyword events before the sale, so there is nothing here to recover by this route.`,
    detail: {
      misc_chat_wins: misc,
      recoverable,
      sample: r?.sample ?? [],
      method:
        "Uses the ManyChat subscriber id the sale row already carries, which is the SAME id space as ads_keyword_events, so no identity bridge is involved. It cannot see a person whose thread carries the keyword but whose sale row pasted a different ManyChat account: that is the Hunter Chapman failure mode and it needs a human, or the identity bridge.",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PIPE 5. The stored sources, against their own thresholds.
// ─────────────────────────────────────────────────────────────────────────

async function freshnessPipe(db: Db, freshness: Map<string, AsOf>, now: Date): Promise<Pipe> {
  const watched = ["sales_tracker_rows", "adsv2_dm_facts", "adsv2_budget_snapshots"];
  const { data } = await db.from("door_freshness_thresholds").select("source, threshold_hours, note");
  const limits = new Map<string, number>();
  for (const r of (data || []) as Array<{ source: string; threshold_hours: number }>) {
    limits.set(r.source, Number(r.threshold_hours));
  }

  const rows = watched.map((source) => {
    const f = freshness.get(source);
    const limit = limits.get(source) ?? null;
    const written = f?.last_written_at ? Date.parse(f.last_written_at) : NaN;
    const ageHours = Number.isFinite(written) ? Math.round(((now.getTime() - written) / 3_600_000) * 10) / 10 : null;
    return {
      source,
      last_written_at: f?.last_written_at ?? null,
      age_hours: ageHours,
      threshold_hours: limit,
      // A source with no reported write time is UNKNOWN, never fresh. That
      // distinction is the whole reason this reports a state per source rather
      // than a boolean.
      state:
        limit === null ? "not_judged" : ageHours === null ? "unknown" : ageHours > limit ? "stale" : "fresh",
    };
  });

  const stale = rows.filter((r) => r.state === "stale");
  const unknown = rows.filter((r) => r.state === "unknown");
  return {
    pipe: "stored_source_freshness",
    verdict: stale.length ? "no_go" : unknown.length ? "degraded" : "go",
    evidence: stale.length
      ? `${stale.map((r) => `${r.source} (${r.age_hours}h, limit ${r.threshold_hours}h)`).join(", ")} past its threshold.`
      : unknown.length
        ? `${unknown.map((r) => r.source).join(", ")} reported no write time at all, so its freshness is unknown and must not be assumed current.`
        : "every watched source is inside its stored threshold.",
    detail: rows,
  };
}

// ─────────────────────────────────────────────────────────────────────────

export const capture_health: QuestionEntry = {
  key: "capture_health",
  description:
    "Whether the pipes that feed the attribution numbers are still running: keyword events flowing per creator, webhook keyword misses, broken organic automations, misc-chat wins that are recoverable, and whether the stored sources are inside their thresholds. Each pipe gets go, degraded or no-go with the evidence behind it.",
  params:
    "client (tyson, jake, or all; defaults to all), days (1 to 90; how far back to look, defaults to 14), sample (1 to 25; how many example rows per pipe, defaults to 5).",
  sources: ["ads_keyword_events", "dm_conversation_messages", "adsv2_sale_facts", "registry_keywords", "sales_tracker_rows"],
  freshnessSources: ["ads_keyword_events", "adsv2_sale_facts", "sales_tracker_rows"],
  budgetMs: 45_000,
  // Version 1. A TRUST answer. It reports no cash, so its coverage is null with
  // a note rather than an empty block pretending to be a measurement.
  receipt: {
    version: 1,
    windowKind: "explicit_range",
    money: false,
    usesDataVersion: false,
    exclusions: [
      {
        what: "any statement about how much money a break has cost",
        count: 0,
        why: "this question reports whether capture is working, never what the failure was worth. Sizing a break needs the identity bridge to say which people were lost, and that is a later brick. Ask coverage_report for what is currently unclassified.",
      },
      {
        what: "naming the individual people an organic automation dropped",
        count: 0,
        why: "the keyword events and the DM messages use different subscriber id spaces, with one id in common out of 7,585. The organic detector therefore compares cohort counts per day and can say HOW MANY were dropped but never WHICH. Joining across those spaces would report every organic sender as a break forever.",
      },
    ],
    definitionsCited: ["certainty_buckets", "organic_keywords", "sale_to_ad_chain"],
  },
  async run(ctx: TemplateContext, params) {
    rejectUnknown(params, ["client", "account", "days", "sample"]);
    const account = params.client ?? params.account ? await requireAccount(ctx, params) : "all";
    const days = optionalInt(params, "days", 14, 1, 90);
    const sample = optionalInt(params, "sample", 5, 1, 25);
    const clients = account === "all" ? [...ctx.clients] : [account];

    // Eastern days, like every other window in this system.
    const to = todayEt(ctx.now);
    const from = shiftDay(to, -(days - 1));

    const freshness = await readFreshness(ctx.db);

    // Each pipe is read independently. One pipe that cannot be read must not
    // take the others down: a partial health answer is worth having, and a
    // pipe that errored is reported as errored rather than as healthy.
    const settled = await Promise.allSettled([
      keywordFlowPipe(ctx.db, clients),
      webhookMissPipe(ctx.db, clients, from, to, sample),
      organicBreakPipe(ctx.db, clients, from, to),
      miscRecoverablePipe(ctx.db, clients, from, to, sample),
      freshnessPipe(ctx.db, freshness, ctx.now),
    ]);
    const names = [
      "keyword_events_flowing",
      "webhook_keyword_misses",
      "organic_automation",
      "misc_chat_recoverable",
      "stored_source_freshness",
    ];
    const pipes: Pipe[] = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : {
            pipe: names[i],
            // A pipe that could not be read has NOT been checked, and an
            // unchecked pipe is never a pass. Same law as health_check's
            // "unchecked": the field a machine reads must never say all-clear
            // when nothing was looked at.
            verdict: "no_go" as PipeVerdict,
            evidence: `this pipe could not be read, so it was NOT checked and must not be treated as healthy: ${
              s.reason instanceof Error ? s.reason.message : String(s.reason)
            }`,
            detail: null,
          },
    );

    return {
      answers: {
        client: account,
        date_from: from,
        date_to: to,
        days,
        checked_at: ctx.now.toISOString(),
        overall: worst(pipes.map((p) => p.verdict)),
        pipes,
        outcome_key: {
          go: "this pipe is working, on the evidence stated.",
          degraded:
            "this pipe is running and losing some of what it should catch. It is its own outcome on purpose: folding it into no-go makes every partial loss look like an outage, and folding it into go throws away the only early warning there is.",
          no_go: "this pipe is not doing its job, or could not be checked. Either way nothing here should be read as healthy.",
        },
        what_this_is_not:
          "This says whether capture is WORKING, never whether the ads are. An account can be capturing perfectly and losing money, and every pipe here would read go. Ask kill_scale_read for the money and health_check for whether the ads can deliver.",
        standing_note:
          'certainty_buckets v1 already anticipates this question in writing: "broken organic-keyword automations have mislabeled some real keyword leads as misc chat; capture_health watches for keyword-recoverable misc chats". This is that watch.',
      },
      asOf: [],
      usedParams: { client: account, days, sample },
      window: { from, to },
      note:
        "Nothing here was changed or fixed. This question only looks. Anything it finds is BREAKAGE rather than a performance signal, so it is acted on when it is found rather than waiting for a sustained trend.",
    };
  },
};
