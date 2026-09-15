// Server-side validator/parser for the Coaching V3 Everfit sync JSON.
// Rejects malformed input with clear messages; caller returns 400. Never
// throws on shape it can salvage (e.g. one bad row) — those rows are
// dropped and reported back in the API response so the upload still lands.

import type { V3ClientRow, V3Report } from "./types";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optInt(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function optIso(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function optStr(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function parseV3ClientRow(raw: unknown): V3ClientRow | null {
  if (!isObject(raw)) return null;
  const everfit_id = optStr(raw.everfit_id, 128);
  const name = optStr(raw.name, 200);
  if (!everfit_id || !name) return null;

  const assigned = optInt(raw.workouts_assigned_7d);
  const completed = optInt(raw.workouts_completed_7d);
  // completed can never exceed assigned; if the JSON says otherwise, trust
  // assigned and cap completed. Preserves the fraction shape (3/5).
  const workouts_completed_7d =
    completed !== null && assigned !== null && completed > assigned ? assigned : completed;

  return {
    everfit_id,
    name,
    coach: optStr(raw.coach, 200),
    workouts_completed_7d,
    workouts_assigned_7d: assigned,
    client_replies_7d: optInt(raw.client_replies_7d),
    activity_7d: optInt(raw.activity_7d),
    last_client_message_at: optIso(raw.last_client_message_at),
    last_coach_message_at: optIso(raw.last_coach_message_at),
    summary: optStr(raw.summary, 400),
  };
}

export interface ParseResult {
  report: V3Report;
  droppedRows: number;
}

export function parseV3Report(raw: unknown): ParseResult {
  if (!isObject(raw)) throw new Error("Report must be a JSON object.");
  if (raw.schema_version !== 3)
    throw new Error("Use the Coaching V3 sync format (schema_version: 3).");
  const captured_at = optIso(raw.captured_at);
  if (!captured_at) throw new Error("captured_at must be an ISO timestamp.");
  if (!Array.isArray(raw.clients))
    throw new Error("clients must be an array.");

  const seen = new Set<string>();
  const out: V3ClientRow[] = [];
  let dropped = 0;
  for (const item of raw.clients) {
    const row = parseV3ClientRow(item);
    if (!row) {
      dropped += 1;
      continue;
    }
    if (seen.has(row.everfit_id)) {
      dropped += 1;
      continue;
    }
    seen.add(row.everfit_id);
    out.push(row);
  }

  return {
    report: { schema_version: 3, captured_at, clients: out },
    droppedRows: dropped,
  };
}
