// Foundation sync worker — the incremental, compute-once engine.
// Reads only rows newer than each source's watermark, maps them to unified
// activity_events (idempotent), then rebuilds lead_context for the subscribers
// touched this run. Cheap to run often; safe to run repeatedly.
//
// POST /api/foundation/sync?lookbackMin=60         → incremental catch-up (cron)
// POST /api/foundation/sync?backfillFrom=2026-04-01 → historical backfill (paged by time budget)

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  mapDmMessage,
  mapKeywordEvent,
  mapSalesRow,
  mapGhlAppointment,
  mapFathomCall,
  buildStory,
  type FoundationEvent,
  type LeadRollup,
} from "@/lib/foundation/stitch";
import { buildIdMaps, personKey, normName, type IdMaps } from "@/lib/foundation/resolve";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BATCH = 1000;
const TIME_BUDGET_MS = 260_000; // leave a little headroom of the 300s limit

// Postgres text/jsonb reject the NUL character AND unpaired UTF-16 surrogates
// (scraped Instagram DM bodies carry both via broken emoji). Strip them everywhere.
function stripBad(v: string | null): string | null {
  if (typeof v !== "string") return v;
  return v
    .replace(/\x00/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function deepClean(obj: unknown): unknown {
  if (obj == null) return obj;
  if (typeof obj === "string") return stripBad(obj);
  if (Array.isArray(obj)) return obj.map(deepClean);
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj as Record<string, unknown>)) out[k] = deepClean(val);
    return out;
  }
  return obj;
}

type SourceCfg = {
  table: string;
  cursor: string;
  map: (row: Record<string, unknown>, ctx: SyncCtx) => FoundationEvent[] | Promise<FoundationEvent[]>;
};

type SyncCtx = { sb: ReturnType<typeof getServiceSupabase> };

const SOURCES: SourceCfg[] = [
  { table: "dm_conversation_messages", cursor: "sent_at", map: (r) => wrap(mapDmMessage(r)) },
  { table: "ads_keyword_events", cursor: "event_at", map: (r) => wrap(mapKeywordEvent(r)) },
  { table: "sales_tracker_rows", cursor: "created_at", map: (r) => mapSalesRow(r) },
  // GHL has no subscriber_id; identity is resolved later by the person resolver.
  { table: "ghl_appointments", cursor: "created_at", map: (r) => wrap(mapGhlAppointment(r, null)) },
  { table: "fathom_calls", cursor: "recorded_at", map: (r) => wrap(mapFathomCall(r)) },
];

function wrap(e: FoundationEvent | null): FoundationEvent[] {
  return e ? [e] : [];
}

function sanitizeEvent(e: FoundationEvent): FoundationEvent {
  const rawName = stripBad(e.display_name);
  // Drop ManyChat merge-field placeholders so they can never be a match key or a lead's name.
  const display_name = rawName && /[{}]/.test(rawName) ? null : rawName;
  return {
    ...e,
    subscriber_id: stripBad(e.subscriber_id),
    contact_id: stripBad(e.contact_id),
    display_name,
    keyword_normalized: stripBad(e.keyword_normalized),
    actor: stripBad(e.actor),
    summary: stripBad(e.summary) || "(no content)",
    source_id: stripBad(e.source_id) || e.source_id,
    client_key: stripBad(e.client_key) || e.client_key,
    // Trust flag: the event carried a hard id, or it links only by name.
    link_confidence: e.subscriber_id || e.contact_id ? "id" : "name",
    payload: (e.payload ? deepClean(e.payload) : e.payload) as Record<string, unknown> | null,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const lookbackMin = Number(url.searchParams.get("lookbackMin") ?? 60);
  const backfillFrom = url.searchParams.get("backfillFrom"); // ISO date or null
  const only = url.searchParams.get("source"); // optional single-source run

  const sb = getServiceSupabase();
  const ctx: SyncCtx = { sb };
  const startedAt = Date.now();
  const touched = new Set<string>();
  const perSource: Record<string, { read: number; written: number; done: boolean }> = {};

  // rebuild=all: recompute the whole person_context from activity_events in one pass.
  if (url.searchParams.get("rebuild") === "all") {
    const res = await rebuildPersonsAll(sb, startedAt);
    return NextResponse.json({ ok: true, mode: "rebuild=all", ...res, durationMs: Date.now() - startedAt });
  }

  for (const cfg of SOURCES) {
    if (only && cfg.table !== only) continue;

    const { data: wmRows } = await sb
      .from("feed_watermarks")
      .select("*")
      .eq("source", cfg.table)
      .limit(1);
    const wm = wmRows?.[0];
    // Resume from the watermark, never before the optional backfill floor. This makes
    // repeated backfill calls continue where they left off instead of restarting.
    const wmMs = wm?.cursor_value ? new Date(wm.cursor_value).getTime() : 0;
    const floorMs = backfillFrom ? new Date(backfillFrom).getTime() : 0;
    const base = new Date(Math.max(floorMs, wmMs - lookbackMin * 60_000)).toISOString();

    let cursor = base;
    let firstPage = true;
    let read = 0;
    let written = 0;
    let done = false;

    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      let q = sb.from(cfg.table).select("*").order(cfg.cursor, { ascending: true }).limit(BATCH);
      q = firstPage ? q.gte(cfg.cursor, cursor) : q.gt(cfg.cursor, cursor);
      const { data: rows, error } = await q;
      if (error) {
        perSource[cfg.table] = { read, written, done: false };
        return NextResponse.json({ error: `read ${cfg.table}: ${error.message}` }, { status: 500 });
      }
      if (!rows || rows.length === 0) {
        done = true;
        break;
      }
      read += rows.length;

      // build events
      const events: FoundationEvent[] = [];
      for (const row of rows) {
        const mapped = await cfg.map(row as Record<string, unknown>, ctx);
        for (const e of mapped) {
          const clean = sanitizeEvent(e);
          events.push(clean);
          if (clean.subscriber_id) touched.add(clean.subscriber_id);
        }
      }

      // dedupe within batch on the conflict key, then upsert
      const seen = new Set<string>();
      const deduped = events.filter((e) => {
        const k = `${e.source}|${e.source_id}|${e.event_type}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      for (const part of chunk(deduped, 500)) {
        const { error: upErr } = await sb
          .from("activity_events")
          .upsert(part, { onConflict: "source,source_id,event_type" });
        if (upErr) {
          return NextResponse.json(
            { error: `upsert ${cfg.table}: ${upErr.message}` },
            { status: 500 },
          );
        }
        written += part.length;
      }

      // advance cursor to the last row's timestamp; persist so it's resumable
      const last = rows[rows.length - 1] as Record<string, unknown>;
      const newCursor = last[cfg.cursor] ? String(last[cfg.cursor]) : cursor;
      cursor = newCursor;
      firstPage = false;
      await sb
        .from("feed_watermarks")
        .update({ cursor_value: newCursor, last_run_at: new Date().toISOString(), rows_last_run: read })
        .eq("source", cfg.table);

      if (rows.length < BATCH) {
        done = true;
        break;
      }
    }

    perSource[cfg.table] = { read, written, done };
  }

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    mode: backfillFrom ? `backfill from ${backfillFrom}` : `incremental (lookback ${lookbackMin}m)`,
    perSource,
    touchedSubscribers: touched.size,
  });
}

// ---- person_context rebuild ------------------------------------------------
// One pass over every activity_event: resolve each to a canonical person (ManyChat
// subscriber + GHL contact unified), accumulate the rollup, then attach stage-state
// and write person_context. Deterministic and idempotent.

type Acc = {
  client_key: string;
  via: string | null;
  subs: Set<string>;
  contacts: Set<string>;
  names: Set<string>;
  display_name: string | null;
  first_seen_at: string | null;
  last_activity_at: string | null;
  first_keyword: string | null;
  first_keyword_at: string | null;
  dm_in: number;
  dm_out: number;
  booked: boolean;
  taken: boolean;
  closed: boolean;
  amount_cents: number;
  setter_name: string | null;
  setter_at: string | null;
  closer_name: string | null;
  closer_at: string | null;
};

function newAcc(): Acc {
  return {
    client_key: "",
    via: null,
    subs: new Set(),
    contacts: new Set(),
    names: new Set(),
    display_name: null,
    first_seen_at: null,
    last_activity_at: null,
    first_keyword: null,
    first_keyword_at: null,
    dm_in: 0,
    dm_out: 0,
    booked: false,
    taken: false,
    closed: false,
    amount_cents: 0,
    setter_name: null,
    setter_at: null,
    closer_name: null,
    closer_at: null,
  };
}

async function rebuildPersonsAll(
  sb: ReturnType<typeof getServiceSupabase>,
  startedAt: number,
): Promise<{ persons: number; error: string | null; skippedNoIdentity: number; removed: number }> {
  const maps: IdMaps = await buildIdMaps(sb);
  const people = new Map<string, Acc>();
  let skipped = 0;
  const runStamp = new Date().toISOString(); // one stamp for the whole rebuild → sweep stale rows after

  // single streaming pass over all events
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    const { data, error } = await sb
      .from("activity_events")
      .select(
        "subscriber_id, contact_id, display_name, client_key, event_type, keyword_normalized, occurred_at, amount_cents, actor",
      )
      .range(from, from + PAGE - 1);
    if (error) return { persons: 0, error: error.message, skippedNoIdentity: skipped, removed: 0 };
    if (!data || data.length === 0) break;
    for (const e of data) {
      const { key, via } = personKey(e as Record<string, unknown>, maps);
      if (!key) {
        skipped += 1;
        continue;
      }
      let a = people.get(key);
      if (!a) { a = newAcc(); a.via = via; people.set(key, a); }
      accumulate(a, e as Record<string, unknown>);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // attach stage-state for every ManyChat subscriber across all persons
  const allSubs = [...people.values()].flatMap((a) => [...a.subs]);
  const stageBySub = await loadStages(sb, allSubs);

  // build + upsert person rows
  let upserted = 0;
  let firstError: string | null = null;
  const rows: Record<string, unknown>[] = [];
  for (const [key, a] of people) {
    // best stage across the person's subscribers
    let qualified = false;
    let readiness = 0;
    let aiConf = 0;
    let evidence: unknown = null;
    for (const sub of a.subs) {
      const st = stageBySub.get(sub);
      if (!st) continue;
      if (st.qualified) qualified = true;
      const r = Number(st.booking_readiness_score ?? 0);
      if (r > readiness) { readiness = r; aiConf = Number(st.ai_confidence ?? 0); evidence = st.stage_evidence ?? evidence; }
    }
    const rollup: LeadRollup = {
      first_keyword: a.first_keyword,
      first_seen_at: a.first_seen_at,
      dm_in_count: a.dm_in,
      dm_out_count: a.dm_out,
      qualified,
      booking_readiness_score: readiness,
      booked: a.booked,
      taken: a.taken,
      closed: a.closed,
      amount_cents: a.amount_cents || null,
      setter_name: a.setter_name,
      closer_name: a.closer_name,
    };
    rows.push({
      person_key: key,
      client_key: stripBad(a.client_key) || null,
      display_name: stripBad(a.display_name),
      subscriber_ids: [...a.subs],
      contact_ids: [...a.contacts],
      first_keyword: stripBad(a.first_keyword),
      first_seen_at: a.first_seen_at,
      last_activity_at: a.last_activity_at,
      dm_in_count: a.dm_in,
      dm_out_count: a.dm_out,
      qualified,
      booking_readiness_score: readiness,
      ai_confidence: aiConf,
      stage_evidence: evidence ? deepClean(evidence) : null,
      booked: a.booked,
      taken: a.taken,
      closed: a.closed,
      amount_cents: a.amount_cents || null,
      setter_name: stripBad(a.setter_name),
      closer_name: stripBad(a.closer_name),
      linked_via: key.startsWith("sub:") ? "subscriber" : key.startsWith("ghl:") ? "contact" : "name",
      story: stripBad(buildStory(rollup)),
      updated_at: runStamp,
    });
  }
  for (const part of chunk(rows, 500)) {
    const { error } = await sb.from("person_context").upsert(part, { onConflict: "person_key" });
    if (error) firstError = firstError ?? error.message;
    else upserted += part.length;
  }
  // Sweep persons not present in this full rebuild (e.g. old placeholder-name keys) so the
  // rollup only ever reflects who currently exists. Safe: person_context is fully derived.
  let removed = 0;
  if (!firstError && upserted > 0) {
    const { count } = await sb
      .from("person_context")
      .delete({ count: "exact" })
      .lt("updated_at", runStamp);
    removed = count ?? 0;
  }
  return { persons: upserted, error: firstError, skippedNoIdentity: skipped, removed };
}

function accumulate(a: Acc, e: Record<string, unknown>) {
  const at = e.occurred_at ? String(e.occurred_at) : null;
  if (at && (!a.first_seen_at || at < a.first_seen_at)) a.first_seen_at = at;
  if (at && (!a.last_activity_at || at > a.last_activity_at)) a.last_activity_at = at;
  if (!a.client_key && e.client_key) a.client_key = String(e.client_key);
  if (e.subscriber_id) a.subs.add(String(e.subscriber_id));
  if (e.contact_id) a.contacts.add(String(e.contact_id));
  const nm = normName(e.display_name as string);
  if (nm) { a.names.add(nm); if (!a.display_name) a.display_name = String(e.display_name).trim(); }
  const type = String(e.event_type);
  const actor = e.actor ? String(e.actor) : null;
  if (type === "dm_in") a.dm_in += 1;
  else if (type === "dm_out") {
    a.dm_out += 1;
    if (actor && at && (!a.setter_at || at > a.setter_at)) { a.setter_name = actor; a.setter_at = at; }
  } else if (type === "keyword_hit") {
    if (e.keyword_normalized && (!a.first_keyword_at || (at && at < a.first_keyword_at))) {
      a.first_keyword = String(e.keyword_normalized);
      a.first_keyword_at = at;
    }
    if (actor && at && (!a.setter_at || at > a.setter_at)) { a.setter_name = actor; a.setter_at = at; }
  } else if (type === "call_booked") {
    a.booked = true;
    if (actor && at && (!a.setter_at || at > a.setter_at)) { a.setter_name = actor; a.setter_at = at; }
  } else if (type === "call_taken") {
    a.taken = true;
    if (actor && at && (!a.closer_at || at > a.closer_at)) { a.closer_name = actor; a.closer_at = at; }
  } else if (type === "sale") {
    a.closed = true;
    a.amount_cents += Number(e.amount_cents ?? 0) || 0;
    if (actor && at && (!a.closer_at || at > a.closer_at)) { a.closer_name = actor; a.closer_at = at; }
  }
}

async function loadStages(
  sb: ReturnType<typeof getServiceSupabase>,
  subs: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const byId = new Map<string, Record<string, unknown>>();
  const uniq = [...new Set(subs)];
  for (const ids of chunk(uniq, 300)) {
    const { data } = await sb
      .from("dm_conversation_stage_state")
      .select("subscriber_id, qualified, booking_readiness_score, ai_confidence, stage_evidence, latest_message_at, updated_at")
      .in("subscriber_id", ids);
    for (const s of data ?? []) {
      const id = String(s.subscriber_id);
      const prev = byId.get(id);
      const t = (r: Record<string, unknown>) =>
        new Date(String(r.latest_message_at ?? r.updated_at ?? 0)).getTime();
      if (!prev || t(s) >= t(prev)) byId.set(id, s);
    }
  }
  return byId;
}
