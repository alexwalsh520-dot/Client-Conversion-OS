// ─────────────────────────────────────────────────────────────────────────
// THE RECEIPT (Brick 2). One place where an answer's proof is assembled.
//
// Build 4 made the door refuse honestly. Brick 2 makes it ANSWER honestly:
// every answer states what it covered, what it left out, how fresh it was and
// how certain it is, so that a reader trusts the system rather than the AI
// that carried the number.
//
// EVERYTHING IN HERE IS DERIVED, NEVER AUTHORED PER CALL. The caveats come
// from signed definitions and stored thresholds. A template cannot talk its
// way out of a caveat, and cannot invent one either. That is the whole point:
// a caveat a person can forget is a caveat that will be forgotten on the day
// it mattered.
// ─────────────────────────────────────────────────────────────────────────

import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";
import type {
  AliasTrail,
  AnswerExclusion,
  AnswerReceipt,
  AsOf,
  CoverageBlock,
  Db,
  StaleSource,
} from "./types";

/** Cheap process-level caches. The roster, the thresholds and the signed
 *  definitions change on the order of weeks, while the accuracy check alone
 *  asks the door seventy-two questions in a run. Re-reading them per ask
 *  would be pure waste on the request path, which law 4 of this build
 *  forbids. Sixty seconds is short enough that an ops change lands within a
 *  minute and long enough that a burst of asks costs one read. */
const CACHE_MS = 60_000;

interface Cached<T> {
  at: number;
  value: T;
}

let rosterCache: Cached<string[] | null> | null = null;
let thresholdCache: Cached<Map<string, { hours: number; note: string }>> | null = null;
let definitionCache: Cached<Map<string, { version: number; statement: string }>> | null = null;

/** Only the tests need this; production never wants a cold cache on purpose. */
export function resetReceiptCaches(): void {
  rosterCache = null;
  thresholdCache = null;
  definitionCache = null;
}

function fresh<T>(c: Cached<T> | null, now: number): c is Cached<T> {
  return c !== null && now - c.at < CACHE_MS;
}

// ─────────────────────────────────────────────────────────────────────────
// THE ACTIVE ROSTER, from the registry rather than a hardcoded list.
// ─────────────────────────────────────────────────────────────────────────

export interface RosterRead {
  clients: string[];
  /** True when the registry could not be read and the fallback list is in use.
   *  This goes on the receipt as a caveat: an answer computed against a
   *  fallback roster must say so rather than look identical to a certified one. */
  usedFallback: boolean;
}

/**
 * The creators the door serves. Read from registry_entities (kind creator,
 * status active), which is where Brick 1 put the roster. ADSV2_SERVED_CLIENTS
 * stays as a fallback so a registry outage degrades to the old behaviour
 * rather than to an empty roster that refuses every question.
 */
export async function activeRoster(db: Db, now: Date = new Date()): Promise<RosterRead> {
  const t = now.getTime();
  if (fresh(rosterCache, t)) {
    const v = rosterCache.value;
    return v ? { clients: [...v], usedFallback: false } : { clients: [...ADSV2_SERVED_CLIENTS], usedFallback: true };
  }
  try {
    const { data, error } = await db
      .from("registry_entities")
      .select("canonical_key")
      .eq("kind", "creator")
      .eq("status", "active");
    if (error) throw new Error(error.message);
    const keys = ((data || []) as Array<{ canonical_key: string }>).map((r) => r.canonical_key).sort();
    // An empty roster is treated as a failed read, not as "we serve nobody".
    // Answering "no creators exist" from an empty table would be the door
    // stating a catastrophic falsehood with total confidence.
    if (!keys.length) throw new Error("the registry returned no active creators");
    rosterCache = { at: t, value: keys };
    return { clients: keys, usedFallback: false };
  } catch {
    rosterCache = { at: t, value: null };
    return { clients: [...ADSV2_SERVED_CLIENTS], usedFallback: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// STALENESS. Operational thresholds, stored so ops can tune them.
// ─────────────────────────────────────────────────────────────────────────

async function thresholds(db: Db, now: Date): Promise<Map<string, { hours: number; note: string }>> {
  const t = now.getTime();
  if (fresh(thresholdCache, t)) return thresholdCache.value;
  const map = new Map<string, { hours: number; note: string }>();
  try {
    const { data, error } = await db
      .from("door_freshness_thresholds")
      .select("source, threshold_hours, note");
    if (error) throw new Error(error.message);
    for (const r of (data || []) as Array<{ source: string; threshold_hours: number; note: string }>) {
      map.set(r.source, { hours: Number(r.threshold_hours), note: r.note });
    }
  } catch {
    // No thresholds read means nothing is CALLED stale. It never means
    // everything is fresh: the freshness timestamps themselves are still on
    // the answer, so a reader can always see the real write times.
  }
  thresholdCache = { at: t, value: map };
  return map;
}

/**
 * Which of an answer's sources are past their threshold. A source with no
 * threshold row is not judged. A source that reports no write time at all is
 * flagged, because an unknown freshness is exactly the case where a reader
 * must not assume a fresh one.
 */
export async function staleSources(db: Db, freshness: AsOf[], now: Date): Promise<StaleSource[]> {
  const limits = await thresholds(db, now);
  const out: StaleSource[] = [];
  for (const f of freshness) {
    const limit = limits.get(f.source);
    if (!limit) continue;
    if (!f.last_written_at) {
      out.push({
        source: f.source,
        last_written_at: null,
        threshold_hours: limit.hours,
        note: `${f.source} reported no write time at all, so its freshness is unknown and must not be assumed to be current.`,
      });
      continue;
    }
    const written = new Date(f.last_written_at).getTime();
    if (!Number.isFinite(written)) continue;
    const ageHours = (now.getTime() - written) / 3_600_000;
    if (ageHours > limit.hours) {
      out.push({
        source: f.source,
        last_written_at: f.last_written_at,
        threshold_hours: limit.hours,
        note: `${f.source} was last written ${ageHours.toFixed(1)} hours ago, past its ${limit.hours} hour threshold (${limit.note}).`,
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// THE SIGNED DEFINITIONS the caveat rules quote.
// ─────────────────────────────────────────────────────────────────────────

async function signedDefinitions(db: Db, now: Date): Promise<Map<string, { version: number; statement: string }>> {
  const t = now.getTime();
  if (fresh(definitionCache, t)) return definitionCache.value;
  const map = new Map<string, { version: number; statement: string }>();
  try {
    const { data, error } = await db
      .from("registry_definitions_current")
      .select("name, version, statement, status");
    if (error) throw new Error(error.message);
    for (const r of (data || []) as Array<{ name: string; version: number; statement: string; status: string }>) {
      // An 'open' definition is not signed, so it is never quoted as if it were.
      if (r.status !== "signed") continue;
      map.set(r.name, { version: Number(r.version), statement: r.statement });
    }
  } catch {
    // A caveat that cannot be quoted is not silently dropped: buildCaveats
    // falls back to naming the rule in its own words below.
  }
  definitionCache = { at: t, value: map };
  return map;
}

// ─────────────────────────────────────────────────────────────────────────
// THE COVERAGE BLOCK. One shared read, one shared shape.
// ─────────────────────────────────────────────────────────────────────────

interface CoverageRow {
  window_wins_total: number;
  window_cash_usd_cents: number;
  ad_wins: number;
  ad_cash_usd_cents: number;
  organic_wins: number;
  organic_cash_usd_cents: number;
  misc_chat_wins: number;
  misc_chat_cash_usd_cents: number;
  awaiting_wins: number;
  awaiting_cash_usd_cents: number;
  unassigned_awaiting_wins: number;
  misc_chat_awaiting_overlap: number;
}

function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Read the four signed buckets for a window. Every money answer shares this,
 * so a bucket cannot drift between questions.
 *
 * THE NOTE IS THE POINT. Every awaiting-review win in this database carries no
 * creator, by design, because nobody has looked at it yet. A per-creator
 * coverage read that filtered them out would report 100% every time, which is
 * the exact false claim this brick exists to kill. door_coverage_block always
 * includes that unassigned pool, and the note says so in plain words instead
 * of leaving the reader to work out why the numbers do not tie to one creator.
 */
export async function coverageFor(
  db: Db,
  clients: readonly string[],
  from: string,
  to: string,
): Promise<CoverageBlock | null> {
  const { data, error } = await db.rpc("door_coverage_block", {
    p_clients: [...clients],
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`could not read the coverage block: ${error.message}`);
  const rows = (data || []) as CoverageRow[];
  // door_coverage_block always returns exactly one row, even for an empty
  // window. No row means the read did not happen. A money answer that shipped
  // with a missing coverage block would look exactly like one with nothing to
  // report, which is the false "100% coverage" this brick exists to kill, so
  // this throws and the door refuses instead.
  if (!rows.length) {
    throw new Error(
      "the coverage block came back empty, so this money answer cannot state what it covered and is not being returned",
    );
  }
  const r = rows[0];

  const total = Number(r.window_wins_total) || 0;
  const cashTotal = Number(r.window_cash_usd_cents) || 0;
  const buckets = {
    ad: { wins: Number(r.ad_wins) || 0, cash_usd_cents: Number(r.ad_cash_usd_cents) || 0 },
    organic: { wins: Number(r.organic_wins) || 0, cash_usd_cents: Number(r.organic_cash_usd_cents) || 0 },
    misc_chat: { wins: Number(r.misc_chat_wins) || 0, cash_usd_cents: Number(r.misc_chat_cash_usd_cents) || 0 },
    awaiting_review: { wins: Number(r.awaiting_wins) || 0, cash_usd_cents: Number(r.awaiting_cash_usd_cents) || 0 },
  };
  const classifiedWins = buckets.ad.wins + buckets.organic.wins + buckets.misc_chat.wins;
  const classifiedCash =
    buckets.ad.cash_usd_cents + buckets.organic.cash_usd_cents + buckets.misc_chat.cash_usd_cents;

  const parts: string[] = [
    "awaiting_review is the only bucket that counts as a gap; ad, organic and misc chat are all classified.",
  ];
  const unassigned = Number(r.unassigned_awaiting_wins) || 0;
  if (unassigned > 0) {
    parts.push(
      `${unassigned} of the ${buckets.awaiting_review.wins} awaiting-review wins carry no creator at all, because nobody has classified them yet. They are counted here on purpose even when this answer is about one creator: leaving them out is exactly how a coverage number reads 100% while real money sits unclassified.`,
    );
  }
  const overlap = Number(r.misc_chat_awaiting_overlap) || 0;
  if (overlap > 0) {
    parts.push(
      `${overlap} of the awaiting-review wins already carry the team's own "Miscellaneous Chat" label. They are counted as awaiting review rather than as misc chat, which understates coverage rather than flattering it. Moving them belongs to the labeler, not to this read.`,
    );
  }

  return {
    window_wins_total: total,
    window_cash_usd_cents_total: cashTotal,
    buckets,
    classified_pct_wins: pct(classifiedWins, total),
    classified_pct_cash: pct(classifiedCash, cashTotal),
    note: parts.join(" "),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE CAVEAT RULES. Data-driven, in one place, applied to every answer.
// ─────────────────────────────────────────────────────────────────────────

/** Whole days between an ISO day and the answer's own "now". */
function daysAgo(day: string, now: Date): number {
  const then = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - then) / 86_400_000);
}

/** Quote a signed definition, or name the rule plainly if it cannot be read. */
function quote(
  defs: Map<string, { version: number; statement: string }>,
  name: string,
  fallback: string,
): { text: string; version: number | null } {
  const d = defs.get(name);
  if (!d) return { text: fallback, version: null };
  return { text: `${name} v${d.version}: ${d.statement}`, version: d.version };
}

export interface CaveatInput {
  window: { from: string; to: string } | null;
  /**
   * The creators this answer ACTUALLY covers, not the whole roster. A
   * tyson-only answer must not carry Jake's currency caveat: a caveat that
   * fires when it does not apply trains the reader to skip caveats, which
   * costs more than the caveat was ever worth.
   */
  clients: readonly string[];
  /** Params after resolution, so a former creator named in them is visible. */
  params: Record<string, unknown>;
  stale: StaleSource[];
  coverage: CoverageBlock | null;
  /** True when the roster came from the fallback list, not the registry. */
  rosterFallback: boolean;
  /** The question's own standing note, carried into the caveats. */
  note?: string;
  now: Date;
}

export interface CaveatResult {
  caveats: string[];
  cited: Array<{ registry: "registry_definitions"; name: string; version?: number }>;
}

/** The definition names whose rules are applied automatically. */
const FORMER_CREATORS = new Set(["antwan", "keith", "lucy", "zoe_and_emily"]);
/** Creators whose Meta ad account bills in a currency other than USD. */
const NON_USD_AD_ACCOUNTS = new Set(["jake"]);

export async function buildCaveats(db: Db, input: CaveatInput): Promise<CaveatResult> {
  const defs = await signedDefinitions(db, input.now);
  const caveats: string[] = [];
  const cited: CaveatResult["cited"] = [];

  const cite = (name: string, fallback: string) => {
    const q = quote(defs, name, fallback);
    caveats.push(q.text);
    cited.push(q.version === null ? { registry: "registry_definitions", name } : { registry: "registry_definitions", name, version: q.version });
  };

  // A question's own standing note is a caveat too. It stays on `note` for
  // backward compatibility and appears here so one field carries them all.
  if (input.note) caveats.push(input.note);

  // RULE 1: a window ending inside the sales lag understates itself.
  if (input.window && daysAgo(input.window.to, input.now) <= 14) {
    cite(
      "sales_lag",
      "Sales lag is a median of 2 days and a p90 of 13 days, so a window ending in the last fortnight understates itself.",
    );
    caveats.push(
      `This window ends ${input.window.to}, inside the sales lag, so its cash and close numbers will keep rising after this answer was given. A recent dip here is provisional and is never on its own a reason to kill an ad.`,
    );
  }

  // RULE 2: anything past its freshness threshold is named, by source.
  for (const s of input.stale) caveats.push(s.note);

  // Who this answer is actually about: the creators it covers, plus whoever
  // the caller named. Deliberately NOT every string parameter: an ad keyword
  // that happened to spell a former creator's name would otherwise fire a
  // caveat about a creator the answer never touched.
  const named = [input.params.client, input.params.account]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase());
  const touched = new Set([...input.clients.map((c) => String(c).toLowerCase()), ...named]);

  // RULE 3: spend for a non-USD ad account has been converted.
  if ([...NON_USD_AD_ACCOUNTS].some((c) => touched.has(c))) {
    cite(
      "pricing_currency",
      "Revenue reports in USD. Jake's ad account bills in AUD and spend converts at the synced rate.",
    );
    caveats.push(
      "Jake's ad account bills in AUD, so his spend in this answer has been converted to USD at the synced rate, while the sale money was already USD and was never converted.",
    );
  }

  // RULE 4: a former creator named anywhere in the parameters.
  const formerNamed = [...touched].filter((v) => FORMER_CREATORS.has(v));
  if (formerNamed.length) {
    cite(
      "former_creators",
      "Antwan, Keith, Zoe and Emily are former creators; their trailing sales are labeled former_creator_ad and never counted for or against active ads.",
    );
    caveats.push(
      `${formerNamed.join(", ")} is a former creator. Any trailing sale is labeled former_creator_ad and is never counted for or against the active roster.`,
    );
  }

  // RULE 5: the roster could not be read from the registry.
  if (input.rosterFallback) {
    caveats.push(
      "The active roster could not be read from registry_entities for this answer, so the engine's built-in list was used instead. The numbers are unaffected, but the roster behind them is not the certified one.",
    );
  }

  // RULE 6: a real gap in coverage is stated as a caveat, not just a number.
  // A reader who skims past the coverage block still cannot miss this.
  if (input.coverage && input.coverage.buckets.awaiting_review.wins > 0) {
    const g = input.coverage.buckets.awaiting_review;
    cite(
      "coverage",
      "Coverage is the share of wins and cash sitting in the ad, organic or misc chat buckets, with awaiting review counted separately as the true gap.",
    );
    caveats.push(
      `${g.wins} win${g.wins === 1 ? "" : "s"} worth ${(g.cash_usd_cents / 100).toFixed(2)} USD in this window are still awaiting review, so ${input.coverage.classified_pct_wins}% of wins and ${input.coverage.classified_pct_cash}% of cash are classified. This answer is not a claim of full coverage.`,
    );
  }

  return { caveats, cited };
}

// ─────────────────────────────────────────────────────────────────────────
// ASSEMBLY.
// ─────────────────────────────────────────────────────────────────────────

export interface AssembleInput {
  db: Db;
  questionKey: string;
  questionVersion: number;
  caller: string;
  now: Date;
  params: Record<string, unknown>;
  trail: AliasTrail;
  window: { from: string; to: string; kind: string } | null;
  dataVersion: number | null;
  freshness: AsOf[];
  coverage: CoverageBlock | null;
  clients: readonly string[];
  rosterFallback: boolean;
  exclusions: AnswerExclusion[];
  definitionKeys: readonly string[];
  /**
   * SIGNED registry definitions this answer APPLIED, by name.
   *
   * Brick 2 let a question declare these and then never read the declaration,
   * so eight questions named the rules they leaned on and none of those names
   * reached a receipt. Brick 3's threshold law makes that unacceptable: every
   * threshold a kill/scale verdict applies is read from the registry, and an
   * answer that applies a signed rule without citing it is asking to be taken
   * on trust, which is the one thing this layer exists to stop.
   */
  registryDefinitions?: readonly string[];
  certainty: AnswerReceipt["certainty"];
  note?: string;
}

export async function assembleReceipt(input: AssembleInput): Promise<AnswerReceipt> {
  const stale = await staleSources(input.db, input.freshness, input.now);
  const { caveats, cited } = await buildCaveats(input.db, {
    window: input.window ? { from: input.window.from, to: input.window.to } : null,
    clients: input.clients,
    params: input.params,
    stale,
    coverage: input.coverage,
    rosterFallback: input.rosterFallback,
    note: input.note,
    now: input.now,
  });

  // Every metric the answer names is a definition it cited, alongside the
  // signed registry rules the caveats came from AND the signed rules the answer
  // actually applied. Two registries, both named, so a reader can go and read
  // the source of either.
  //
  // The applied rules are resolved to their REAL versions here rather than
  // assumed to be v1, so the day an owner signs v2 of a rule, every answer that
  // applied it says v2 without anyone remembering to update a citation.
  const signed = await signedDefinitions(input.db, input.now);
  const applied: AnswerReceipt["definitions_cited"] = (input.registryDefinitions ?? []).map((name) => {
    const d = signed.get(name);
    return d
      ? { registry: "registry_definitions" as const, name, version: d.version }
      : { registry: "registry_definitions" as const, name };
  });

  const definitions_cited: AnswerReceipt["definitions_cited"] = [];
  const seen = new Set<string>();
  for (const c of [
    ...input.definitionKeys.map((name) => ({ registry: "warehouse.definitions" as const, name })),
    ...cited,
    ...applied,
  ]) {
    const key = `${c.registry}|${c.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    definitions_cited.push(c);
  }

  return {
    contract_version: 2,
    question_key: input.questionKey,
    question_version: input.questionVersion,
    asked_at: input.now.toISOString(),
    caller: input.caller,
    params_as_resolved: input.params,
    aliases_resolved: [...input.trail.entries],
    window: input.window,
    data_version: input.dataVersion,
    freshness: input.freshness,
    stale,
    coverage: input.coverage,
    exclusions: input.exclusions,
    caveats,
    certainty: input.certainty,
    definitions_cited,
  };
}
