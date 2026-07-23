// ─────────────────────────────────────────────────────────────────────────
// SERVE — the request path. It reads ONE precomputed snapshot row and returns
// it. On a cold custom window it builds the window from the already-computed
// facts (indexed reads + set-based aggregation, a couple of seconds) and caches
// it. It never fetches from an external API and never recomputes history.
//
// Cache invalidation is explicit, not vibes: every snapshot is stamped with the
// current data_version. A sync bumps the version, so any stale snapshot is
// ignored and rebuilt on next read. An identical request returns a byte-
// identical payload.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { getDataVersion, type Db } from "./db";
import { buildWindow } from "./windows";
import type { AdsV2Payload, AdsV2Query } from "./types";

// Level is a view concern (which rows are shown first); the data is the full
// campaign tree, so snapshots are stored once per account/window/status.
const SNAPSHOT_LEVEL = "tree";

function snapKey(q: AdsV2Query): string {
  return `${q.account}|${q.dateFrom}|${q.dateTo}|${q.status}`;
}

// De-dupe concurrent identical computes within a single server instance.
const inFlight = new Map<string, Promise<AdsV2Payload>>();

export async function serveWindow(query: AdsV2Query): Promise<AdsV2Payload> {
  const db = getServiceSupabase();
  const version = await getDataVersion(db);

  const cached = await readSnapshot(db, query, version);
  if (cached) return withLevel(cached, query);

  const key = snapKey(query);
  const running = inFlight.get(key);
  if (running) return withLevel(await running, query);

  const promise = computeAndStore(db, query, version).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return withLevel(await promise, query);
}

async function readSnapshot(db: Db, query: AdsV2Query, version: number): Promise<AdsV2Payload | null> {
  const { data } = await db
    .from("adsv2_window_snapshots")
    .select("payload, data_version")
    .eq("account", query.account)
    .eq("date_from", query.dateFrom)
    .eq("date_to", query.dateTo)
    .eq("level", SNAPSHOT_LEVEL)
    .eq("status", query.status)
    .maybeSingle();
  if (!data) return null;
  if (Number(data.data_version) !== version) return null;
  return data.payload as AdsV2Payload;
}

export async function computeAndStore(db: Db, query: AdsV2Query, version: number): Promise<AdsV2Payload> {
  const payload = await buildWindow(query, version);
  await db.from("adsv2_window_snapshots").upsert(
    {
      account: query.account,
      date_from: query.dateFrom,
      date_to: query.dateTo,
      level: SNAPSHOT_LEVEL,
      status: query.status,
      data_version: version,
      payload: payload as unknown as object,
      compute_ms: payload.computeMs,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "account,date_from,date_to,level,status" },
  );
  return payload;
}

// The stored payload is level-agnostic; stamp the requested level on the way
// out so the response echoes what was asked for (view concern only).
function withLevel(payload: AdsV2Payload, query: AdsV2Query): AdsV2Payload {
  if (payload.level === query.level) return payload;
  return { ...payload, level: query.level };
}
