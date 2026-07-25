// ─────────────────────────────────────────────────────────────────────────
// AD CHANGE LOG — the exact moment every ad, ad set, and campaign was created,
// turned on, turned off, or had its budget moved, forever.
//
// Source: Meta's own activity history (/act_X/activities). Two modes share one
// mapper, so a backfilled row and a live row are byte-identical in shape:
//   * backfill — walks BACKWARD through history in windows, resumable, paced.
//   * forward  — the hourly step, picks up where the last run finished.
//
// Three things this file gets right that are easy to get wrong:
//
// 1. Meta's activities feed uses LEGACY object names. Verified against our own
//    ads_meta_insights_daily rows on 2026-07-25 before a line was written:
//        ADGROUP        = an AD, and its extra_data.campaign_id is the AD SET id
//        CAMPAIGN       = an AD SET
//        CAMPAIGN_GROUP = a CAMPAIGN
//    Taking those names at face value would silently mis-join every row.
//
// 2. Without an explicit since/until, Meta returns only the last few days and
//    no next page. Every request here is date-bounded on purpose.
//
// 3. Re-running must add nothing. Each row gets a fingerprint (change_uid) and
//    the insert is ON CONFLICT DO NOTHING, so overlapping windows are free.
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { ACTIVE_CREATORS, firstEnv, normalizeAdAccountId, type Creator } from "@/lib/creators";
import { creatorCurrency } from "@/lib/fx/rates";
import { etDay } from "./time";
import { startRun, finishRun, type Db } from "./db";

const GRAPH = "https://graph.facebook.com/v21.0";
const FIELDS =
  "event_type,event_time,object_id,object_name,object_type,extra_data,actor_id,actor_name,translated_event_type";

/** Meta's legacy object_type -> what the thing actually is. */
const LEVEL_BY_OBJECT_TYPE: Record<string, "campaign" | "adset" | "ad" | "account"> = {
  CAMPAIGN_GROUP: "campaign",
  CAMPAIGN: "adset",
  ADGROUP: "ad",
  ACCOUNT: "account",
};

/** Meta event names that mean "this thing was created". */
const CREATED_EVENTS = new Set(["create_ad", "create_ad_set", "create_campaign_group"]);

/** Meta event names that carry an on/off status change. */
const STATUS_EVENTS = new Set([
  "update_ad_run_status",
  "update_ad_set_run_status",
  "update_campaign_run_status",
  "update_ad_run_status_to_be_set_after_review",
]);

/** Meta event names that move a budget dial. */
const BUDGET_EVENTS = new Set([
  "update_ad_set_budget",
  "update_campaign_budget",
  "update_campaign_group_budget",
  "update_campaign_high_demand_periods",
]);

/** Status words Meta uses that mean the thing is running. */
const ON_WORDS = new Set(["active", "started delivery"]);

export interface MetaActivity {
  event_type?: string;
  event_time?: string;
  object_id?: string;
  object_name?: string;
  object_type?: string;
  extra_data?: string;
  actor_id?: string;
  actor_name?: string;
  translated_event_type?: string;
}

export interface AdChangeRow {
  change_uid: string;
  client_key: string;
  account_id: string | null;
  level: "campaign" | "adset" | "ad" | "account";
  entity_id: string;
  entity_name: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  change_type: "created" | "status_on" | "status_off" | "budget_change" | "other";
  old_value: string | null;
  new_value: string | null;
  old_budget_cents: number | null;
  new_budget_cents: number | null;
  currency: string | null;
  changed_at_utc: string;
  actor: string | null;
  source: "meta_activity_backfill" | "meta_activity_sync" | "derived_snapshot_diff";
  meta_event_type: string | null;
  raw: unknown;
}

function parseExtra(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Meta writes an id either as a plain scalar (`campaign_id: 123`) or, on
 * creation events, as an object (`campaign_id: {mutation_input: 123, new: 123}`).
 * Both forms mean the same id, so both are read.
 */
function readId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") {
    const s = String(value).trim();
    return s && s !== "0" ? s : null;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return readId(o.new ?? o.new_value ?? o.mutation_input);
  }
  return null;
}

/**
 * Budget amounts arrive nested inside Meta's "composite_data" shape:
 *   old_value: { type: "payment_amount", old_value: 9250, currency: "USD" }
 *   new_value: { type: "payment_amount", new_value: 5000, currency: "USD" }
 * Values are minor units (9250 = 92.50 per day).
 */
function readBudgetCents(value: unknown, side: "old" | "new"): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const inner = side === "old" ? o.old_value : o.new_value;
    if (typeof inner === "number") return Number.isFinite(inner) && inner > 0 ? Math.round(inner) : null;
    const budgetValue = o.budget_value;
    if (typeof budgetValue === "number") return Math.round(budgetValue);
  }
  return null;
}

/** A human-readable version of whatever Meta put in old_value / new_value. */
function readWord(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 500) || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const inner = o.new_value ?? o.old_value;
    if (typeof inner === "string" || typeof inner === "number") return String(inner).slice(0, 500);
  }
  return null;
}

function classifyChange(
  eventType: string,
  extra: Record<string, unknown>,
): { type: AdChangeRow["change_type"]; onOff: "on" | "off" | null } {
  if (CREATED_EVENTS.has(eventType)) return { type: "created", onOff: null };
  if (BUDGET_EVENTS.has(eventType)) return { type: "budget_change", onOff: null };
  if (STATUS_EVENTS.has(eventType)) {
    const word = (readWord(extra.new_value) || "").trim().toLowerCase();
    // Anything that is not an explicit "running" word means it stopped running.
    // "Pending Process" is Meta's review limbo: not delivering, so not "on".
    if (ON_WORDS.has(word)) return { type: "status_on", onOff: "on" };
    if (word) return { type: "status_off", onOff: "off" };
    return { type: "other", onOff: null };
  }
  return { type: "other", onOff: null };
}

/**
 * Fingerprint a change so a repeat sync adds nothing. Includes the payload
 * because Meta legitimately emits several different events for one entity in
 * the same second (a status flip logs both the review state and the run state).
 */
function fingerprint(clientKey: string, a: MetaActivity): string {
  const h = createHash("sha1");
  h.update(
    [clientKey, a.event_type || "", a.object_id || "", a.event_time || "", a.extra_data || ""].join("|"),
  );
  return h.digest("hex");
}

/** Turn one Meta activity record into one change-log row. */
export function mapActivity(
  activity: MetaActivity,
  ctx: { clientKey: string; accountId: string; currency: string; source: AdChangeRow["source"] },
): AdChangeRow | null {
  const eventType = activity.event_type || "";
  const objectId = activity.object_id ? String(activity.object_id) : "";
  const when = activity.event_time;
  if (!eventType || !objectId || !when) return null;

  const level = LEVEL_BY_OBJECT_TYPE[activity.object_type || ""] ?? null;
  if (!level) return null; // an object type we have never seen: skipped, not guessed

  const extra = parseExtra(activity.extra_data);
  const { type } = classifyChange(eventType, extra);

  // Legacy naming, handled once, here. For an AD, Meta's "campaign_id" is the
  // AD SET id. The true campaign is filled in later from our own spend history.
  let adId: string | null = null;
  let adsetId: string | null = null;
  let campaignId: string | null = null;
  if (level === "ad") {
    adId = objectId;
    adsetId = readId(extra.campaign_id);
  } else if (level === "adset") {
    adsetId = objectId;
  } else if (level === "campaign") {
    campaignId = objectId;
  }

  const isBudget = type === "budget_change" || CREATED_EVENTS.has(eventType);

  return {
    change_uid: fingerprint(ctx.clientKey, activity),
    client_key: ctx.clientKey,
    account_id: ctx.accountId,
    level,
    entity_id: objectId,
    entity_name: activity.object_name ?? null,
    campaign_id: campaignId,
    adset_id: adsetId,
    ad_id: adId,
    change_type: type,
    old_value: readWord(extra.old_value),
    new_value: readWord(extra.new_value),
    old_budget_cents: isBudget ? readBudgetCents(extra.old_value, "old") : null,
    new_budget_cents: isBudget
      ? readBudgetCents(extra.new_value, "new") ?? readBudgetCents(extra.new_budget_schedule, "new")
      : null,
    currency: isBudget ? ((extra.currency as string) || ctx.currency) : null,
    changed_at_utc: new Date(when).toISOString(),
    actor: activity.actor_name ?? null,
    source: ctx.source,
    meta_event_type: eventType,
    raw: activity as unknown,
  };
}

/**
 * Fetch one date-bounded page-set of activities, backing off politely when Meta
 * rate-limits us. The backfill must never compete with the hourly spend sync,
 * so a throttle response pauses rather than hammers.
 */
async function fetchActivityWindow(
  account: string,
  token: string,
  since: string,
  until: string,
  opts: { maxPages: number; deadlineMs: number; pauseMs: number },
): Promise<{ rows: MetaActivity[]; throttled: boolean; complete: boolean }> {
  const out: MetaActivity[] = [];
  let url: string | undefined =
    `${GRAPH}/${account}/activities?fields=${FIELDS}&since=${since}&until=${until}&limit=500&access_token=${token}`;
  let throttled = false;

  for (let page = 0; page < opts.maxPages && url; page++) {
    if (Date.now() > opts.deadlineMs) return { rows: out, throttled, complete: false };

    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 429 || res.status === 613) {
      throttled = true;
      return { rows: out, throttled, complete: false };
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      // Meta reports its own throttling as a 400 with code 17 or 80004.
      if (/rate limit|too many calls|request limit|#17\b|80004/i.test(body)) {
        throttled = true;
        return { rows: out, throttled, complete: false };
      }
      throw new Error(`Meta activities ${res.status}: ${body}`);
    }

    const json = (await res.json()) as { data?: MetaActivity[]; paging?: { next?: string } };
    const rows = json.data || [];
    out.push(...rows);
    if (!rows.length) return { rows: out, throttled, complete: true };
    url = json.paging?.next;
    if (url) await new Promise((r) => setTimeout(r, opts.pauseMs));
  }
  return { rows: out, throttled, complete: !url };
}

/** Push mapped rows into warehouse.ad_changes through the ingest function. */
async function ingest(db: Db, rows: AdChangeRow[]): Promise<number> {
  if (!rows.length) return 0;
  let inserted = 0;
  const CHUNK = 400; // keeps each statement well inside the 20s service timeout
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { data, error } = await db.rpc("adsv2_ingest_ad_changes", {
      p_rows: slice as unknown as object,
    });
    if (error) throw new Error(`ad_changes ingest failed: ${error.message}`);
    inserted += Number(data ?? 0);
  }
  return inserted;
}

interface CreatorTarget {
  creator: Creator;
  account: string;
  token: string;
  currency: string;
}

/** The active creators whose Meta account we can actually read right now. */
function resolveTargets(): { targets: CreatorTarget[]; skipped: { client: string; reason: string }[] } {
  const targets: CreatorTarget[] = [];
  const skipped: { client: string; reason: string }[] = [];
  for (const creator of ACTIVE_CREATORS) {
    const token = firstEnv(creator.tokenEnv);
    const account = firstEnv(creator.adAccountEnv) || creator.defaultAdAccountId;
    if (!token || !account) {
      skipped.push({ client: creator.key, reason: !token ? "no access token" : "no ad account" });
      continue;
    }
    targets.push({
      creator,
      account: normalizeAdAccountId(account),
      token,
      currency: creatorCurrency(creator.key),
    });
  }
  return { targets, skipped };
}

// ── Forward capture (the hourly step) ────────────────────────────────────

const CURSOR_KEY = "activity_forward_cursor";
/** Overlap re-read, so a change landing mid-run is never skipped. */
const FORWARD_OVERLAP_HOURS = 6;

export interface ActivitySyncResult {
  clients: string[];
  fetched: number;
  inserted: number;
  resolved: number;
  skipped: { client: string; reason: string }[];
  throttled: boolean;
  since: string;
  until: string;
}

/**
 * Append any activity that happened since the last run. Called by the hourly
 * sync under its own timeout, so a slow or failing Meta never blocks spend.
 */
export async function runActivitySync(
  now: Date = new Date(),
  opts: { budgetMs?: number } = {},
): Promise<ActivitySyncResult> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "activity");
  const started = Date.now();
  const deadlineMs = started + (opts.budgetMs ?? 60_000);

  try {
    const { data: cursorRow } = await db
      .from("adsv2_meta")
      .select("value")
      .eq("key", CURSOR_KEY)
      .maybeSingle();
    const cursorIso = (cursorRow?.value as { at?: string } | undefined)?.at ?? null;

    const untilDate = new Date(now.getTime() + 24 * 3600_000); // Meta's until is exclusive-ish
    const sinceDate = cursorIso
      ? new Date(new Date(cursorIso).getTime() - FORWARD_OVERLAP_HOURS * 3600_000)
      : new Date(now.getTime() - 7 * 86_400_000); // first ever run: last 7 days
    const since = sinceDate.toISOString().slice(0, 10);
    const until = untilDate.toISOString().slice(0, 10);

    const { targets, skipped } = resolveTargets();
    const clients: string[] = [];
    let fetched = 0;
    let inserted = 0;
    let throttled = false;

    for (const t of targets) {
      try {
        const res = await fetchActivityWindow(t.account, t.token, since, until, {
          maxPages: 12,
          deadlineMs,
          pauseMs: 300,
        });
        throttled = throttled || res.throttled;
        fetched += res.rows.length;
        const mapped = res.rows
          .map((a) =>
            mapActivity(a, {
              clientKey: t.creator.key,
              accountId: t.account,
              currency: t.currency,
              source: "meta_activity_sync",
            }),
          )
          .filter((r): r is AdChangeRow => r !== null);
        inserted += await ingest(db, mapped);
        clients.push(t.creator.key);
      } catch (err) {
        // One creator failing never blocks the others.
        skipped.push({ client: t.creator.key, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    const { data: resolvedCount } = await db.rpc("adsv2_resolve_ad_change_parents");

    // Only advance the cursor when nobody was throttled and at least one client
    // actually completed, so a throttled run re-reads rather than skips.
    if (!throttled && clients.length) {
      await db.from("adsv2_meta").upsert(
        {
          key: CURSOR_KEY,
          value: { at: now.toISOString() } as unknown as object,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    }

    const result: ActivitySyncResult = {
      clients,
      fetched,
      inserted,
      resolved: Number(resolvedCount ?? 0),
      skipped,
      throttled,
      since,
      until,
    };
    await finishRun(db, runId, {
      status: "ok",
      rows: inserted,
      durationMs: Date.now() - started,
      detail: result,
    });
    return result;
  } catch (err) {
    await finishRun(db, runId, {
      status: "error",
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── Backfill (one-time history pull, resumable) ──────────────────────────

const BACKFILL_KEY = "activity_backfill_cursor";
/** How big a bite of history each pass takes. */
const BACKFILL_WINDOW_DAYS = 30;
/** Stop walking back once we reach here; Meta returns nothing before this. */
const BACKFILL_FLOOR = "2024-01-01";

interface BackfillState {
  /** The oldest day we have already pulled. The next pass walks back from here. */
  cursor?: string;
  done?: boolean;
  emptyStreak?: number;
  totalInserted?: number;
  oldestSeen?: string | null;
}

export interface BackfillResult {
  ran: boolean;
  done: boolean;
  windowsProcessed: { since: string; until: string; fetched: number; inserted: number }[];
  cursor: string;
  totalInserted: number;
  oldestSeen: string | null;
  throttled: boolean;
  skipped: { client: string; reason: string }[];
}

/**
 * Walk BACKWARD through Meta's activity history one window at a time, saving
 * progress after every window. Designed to be called repeatedly: each call does
 * a bounded amount of work, then returns. Nothing is lost if it stops early.
 */
export async function runActivityBackfill(
  now: Date = new Date(),
  opts: { budgetMs?: number; maxWindows?: number } = {},
): Promise<BackfillResult> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "activity_backfill");
  const started = Date.now();
  const deadlineMs = started + (opts.budgetMs ?? 240_000);
  const maxWindows = opts.maxWindows ?? 12;

  try {
    const { data: stateRow } = await db
      .from("adsv2_meta")
      .select("value")
      .eq("key", BACKFILL_KEY)
      .maybeSingle();
    const state = (stateRow?.value as BackfillState | undefined) ?? {};

    let cursor = state.cursor || new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
    let emptyStreak = state.emptyStreak ?? 0;
    let totalInserted = state.totalInserted ?? 0;
    let oldestSeen = state.oldestSeen ?? null;
    let done = state.done ?? false;

    const { targets, skipped } = resolveTargets();
    const windows: BackfillResult["windowsProcessed"] = [];
    let throttled = false;

    while (!done && windows.length < maxWindows && Date.now() < deadlineMs && !throttled) {
      const until = cursor;
      const since = shiftIsoDay(until, -BACKFILL_WINDOW_DAYS);

      let fetched = 0;
      let inserted = 0;
      for (const t of targets) {
        try {
          const res = await fetchActivityWindow(t.account, t.token, since, until, {
            maxPages: 25,
            deadlineMs,
            pauseMs: 400,
          });
          if (res.throttled) throttled = true;
          fetched += res.rows.length;
          for (const a of res.rows) {
            if (a.event_time && (!oldestSeen || a.event_time < oldestSeen)) oldestSeen = a.event_time;
          }
          const mapped = res.rows
            .map((a) =>
              mapActivity(a, {
                clientKey: t.creator.key,
                accountId: t.account,
                currency: t.currency,
                source: "meta_activity_backfill",
              }),
            )
            .filter((r): r is AdChangeRow => r !== null);
          inserted += await ingest(db, mapped);
        } catch (err) {
          skipped.push({ client: t.creator.key, reason: err instanceof Error ? err.message : String(err) });
        }
      }

      // A throttled window is incomplete: do not move the cursor past it.
      if (throttled) break;

      windows.push({ since, until, fetched, inserted });
      totalInserted += inserted;
      cursor = since;

      // Stop when history genuinely runs out: three consecutive empty windows,
      // or the floor. Honest about where the data actually ends.
      emptyStreak = fetched === 0 ? emptyStreak + 1 : 0;
      if (emptyStreak >= 3 || since <= BACKFILL_FLOOR) done = true;
    }

    await db.rpc("adsv2_resolve_ad_change_parents");

    const nextState: BackfillState = { cursor, done, emptyStreak, totalInserted, oldestSeen };
    await db.from("adsv2_meta").upsert(
      {
        key: BACKFILL_KEY,
        value: nextState as unknown as object,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

    const result: BackfillResult = {
      ran: true,
      done,
      windowsProcessed: windows,
      cursor,
      totalInserted,
      oldestSeen,
      throttled,
      skipped,
    };
    await finishRun(db, runId, {
      status: "ok",
      rows: windows.reduce((s, w) => s + w.inserted, 0),
      durationMs: Date.now() - started,
      detail: result,
    });
    return result;
  } catch (err) {
    await finishRun(db, runId, {
      status: "error",
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function shiftIsoDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Exported for the derived-snapshot-diff step and tests. */
export { etDay as activityEtDay };
