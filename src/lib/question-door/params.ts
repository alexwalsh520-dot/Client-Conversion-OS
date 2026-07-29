// ─────────────────────────────────────────────────────────────────────────
// PARAMETER CHECKING — small, strict, and shared by every template.
//
// A malformed parameter is refused, never repaired by guessing. This is the
// same discipline as the attribution engine: hard keys only, no fuzzy match,
// no silent best guess. A caller that asks the wrong way is told exactly what
// it should have sent.
// ─────────────────────────────────────────────────────────────────────────

import { BadParams } from "./types";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An inclusive Eastern-time day, YYYY-MM-DD. Anything else is refused. */
export function requireDay(params: Record<string, unknown>, name: string): string {
  const v = params[name];
  if (typeof v !== "string" || !ISO_DAY.test(v)) {
    throw new BadParams(`${name} must be a day written as YYYY-MM-DD, for example 2026-07-28.`);
  }
  // Reject a well-shaped but impossible day (2026-02-31) rather than let the
  // database silently reinterpret it.
  const [y, m, d] = v.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new BadParams(`${name} is not a real calendar day: ${v}.`);
  }
  return v;
}

export function optionalDay(params: Record<string, unknown>, name: string): string | null {
  if (params[name] === undefined || params[name] === null || params[name] === "") return null;
  return requireDay(params, name);
}

/**
 * An ACTIVE creator, or "all". Law 7 of this build: the roster is read from the
 * engine's own list, never hardcoded here. A former creator is refused by name
 * so the caller understands why rather than seeing an empty answer.
 */
export function requireAccount(
  params: Record<string, unknown>,
  clients: readonly string[],
  opts: { allowAll?: boolean } = {},
): string {
  const allowAll = opts.allowAll !== false;
  const raw = params.client ?? params.account;
  if (typeof raw !== "string" || !raw.trim()) {
    const list = [...(allowAll ? ["all"] : []), ...clients].join(", ");
    throw new BadParams(`client is required. The ones this door serves are: ${list}.`);
  }
  const v = raw.trim().toLowerCase();
  if (v === "all") {
    if (!allowAll) throw new BadParams(`this question needs one creator, not "all". Ask for one of: ${clients.join(", ")}.`);
    return "all";
  }
  if (clients.includes(v)) return v;
  const list = [...(allowAll ? ["all"] : []), ...clients].join(", ");
  throw new BadParams(
    `"${v}" is not a creator this door serves. It serves the active roster only: ${list}. A creator who has left the roster is not answered here; their old ads appear only inside honest labels such as former_creator_ad.`,
  );
}

/** One creator, never "all". Used where an answer only makes sense per creator. */
export function requireClient(params: Record<string, unknown>, clients: readonly string[]): string {
  return requireAccount(params, clients, { allowAll: false });
}

const STATUSES = ["active", "finished", "all"] as const;
export type StoredStatus = (typeof STATUSES)[number];

/** Which ads the stored answer covers. Defaults to "all", the widest saved view. */
export function optionalStatus(params: Record<string, unknown>): StoredStatus {
  const raw = params.status;
  if (raw === undefined || raw === null || raw === "") return "all";
  const v = String(raw).trim().toLowerCase();
  if ((STATUSES as readonly string[]).includes(v)) return v as StoredStatus;
  throw new BadParams(`status must be one of: ${STATUSES.join(", ")}.`);
}

/** A non-empty exact string. Never trimmed into a different value silently. */
export function requireText(params: Record<string, unknown>, name: string): string {
  const v = params[name];
  if (typeof v !== "string" || !v.trim()) {
    throw new BadParams(`${name} is required and must be text.`);
  }
  return v.trim();
}

export function optionalText(params: Record<string, unknown>, name: string): string | null {
  const v = params[name];
  if (v === undefined || v === null || v === "") return null;
  return requireText(params, name);
}

/** A whole number inside a stated range. Out of range is refused, not clamped. */
export function optionalInt(
  params: Record<string, unknown>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const v = params[name];
  if (v === undefined || v === null || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadParams(`${name} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

/** from must not be after to. A backwards range is a mistake, not a window. */
export function requireRange(params: Record<string, unknown>): { from: string; to: string } {
  const from = requireDay(params, "date_from");
  const to = requireDay(params, "date_to");
  if (from > to) throw new BadParams(`date_from (${from}) cannot be after date_to (${to}).`);
  return { from, to };
}

/** Reject any parameter the question does not take, so a caller never believes
 *  a filter was applied that this template silently ignored. */
export function rejectUnknown(params: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(params).filter((k) => !allowed.includes(k));
  if (extra.length) {
    const takes = allowed.length ? `It takes: ${allowed.join(", ")}.` : "It takes no parameters at all.";
    throw new BadParams(
      `this question does not take ${extra.join(", ")}. ${takes} Nothing was filtered by the extra parameter, so the answer is not being returned.`,
    );
  }
}
