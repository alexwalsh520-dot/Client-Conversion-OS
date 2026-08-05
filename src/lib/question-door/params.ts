// ─────────────────────────────────────────────────────────────────────────
// PARAMETER CHECKING — small, strict, and shared by every template.
//
// A malformed parameter is refused, never repaired by guessing. This is the
// same discipline as the attribution engine: hard keys only, no fuzzy match,
// no silent best guess. A caller that asks the wrong way is told exactly what
// it should have sent.
// ─────────────────────────────────────────────────────────────────────────

import { BadParams, type AliasTrail, type Db } from "./types";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// ─────────────────────────────────────────────────────────────────────────
// REGISTRY RESOLUTION (Brick 2).
//
// Brick 1 put every spelling every system uses into registry_entities. This is
// where the door starts using it. "jake_divljak", "Jake Divijak" (the tracker's
// own misspelling), "rrf" and "JAKE" are all the same creator, and the door
// now knows that instead of refusing four names for one person.
//
// The failure this kills: an AI reported "Jake has zero DMs" because the
// message store keys him jake_divljak while the warehouse keys him jake.
//
// Resolution is NOT fuzzy matching. registry_resolve_entity does exact,
// case-insensitive lookup over declared aliases only. An unknown name is still
// refused; it is never repaired by guessing at the nearest creator.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve one alias to its canonical key through the registry, recording the
 * hop on the trail so the receipt can show the caller what its input became.
 * Cached per ask: the same alias costs one round trip however many parameters
 * mention it.
 *
 * Returns null when the registry names nothing. The CALLER decides what an
 * unresolvable name means, because "not a creator" and "not a person" need
 * different refusals.
 */
export async function resolveEntity(
  db: Db,
  trail: AliasTrail,
  given: string,
): Promise<string | null> {
  const key = given.trim().toLowerCase();
  if (!key) return null;
  if (trail.cache.has(key)) return trail.cache.get(key) ?? null;

  let resolved: string | null = null;
  try {
    const { data, error } = await db.rpc("registry_resolve_entity", { p_alias: given.trim() });
    if (error) throw new Error(error.message);
    resolved = typeof data === "string" && data ? data : null;
  } catch {
    // A registry that cannot be reached must not turn a valid question into a
    // refusal. Null falls through to the caller's own membership check, which
    // is the pre-Brick-2 behaviour: strictly no worse than before.
    resolved = null;
  }

  trail.cache.set(key, resolved);
  // Only a real rename is worth recording. An input that was already the
  // canonical key is not an "alias resolved", it is just a correct input.
  if (resolved && resolved.toLowerCase() !== key) {
    trail.entries.push({ given, resolved_to: resolved });
  }
  return resolved;
}

/**
 * Resolve an alias that MUST name an entity of one of the given kinds. Used
 * where a wrong answer would be worse than no answer.
 */
export async function resolveEntityOrThrow(
  db: Db,
  trail: AliasTrail,
  given: string,
  expectedKinds: readonly string[],
): Promise<string> {
  const resolved = await resolveEntity(db, trail, given);
  if (!resolved) {
    throw new BadParams(
      `"${given}" does not name anyone the registry knows. Names are resolved against the declared aliases in registry_entities only; nothing is guessed at.`,
    );
  }
  if (expectedKinds.length) {
    const { data } = await db
      .from("registry_entities")
      .select("kind")
      .eq("canonical_key", resolved)
      .maybeSingle();
    const kind = (data as { kind?: string } | null)?.kind;
    if (kind && !expectedKinds.includes(kind)) {
      throw new BadParams(
        `"${given}" resolves to ${resolved}, who is a ${kind}, but this question needs one of: ${expectedKinds.join(", ")}.`,
      );
    }
  }
  return resolved;
}

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
 * engine's own roster, never hardcoded here. Since Brick 2 that roster comes
 * from registry_entities, and the name given is resolved through the registry
 * first, so every declared spelling of a creator works.
 *
 * A former creator is still refused BY NAME so the caller understands why
 * rather than seeing an empty answer. That refusal is now better, not worse:
 * "antwan" resolves to a real entity the registry knows is former, so the door
 * can say which creator it means instead of saying the word is unknown.
 */
export async function requireAccount(
  ctx: { db: Db; clients: readonly string[]; resolved: AliasTrail },
  params: Record<string, unknown>,
  opts: { allowAll?: boolean } = {},
): Promise<string> {
  const { clients } = ctx;
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
  // Already canonical: no registry round trip needed for the common case.
  if (clients.includes(v)) return v;

  // Not a name we serve as written. Ask the registry what it is before
  // refusing, so an alias is answered and a former creator is named.
  const resolved = await resolveEntity(ctx.db, ctx.resolved, v);
  if (resolved && clients.includes(resolved)) return resolved;

  const list = [...(allowAll ? ["all"] : []), ...clients].join(", ");
  if (resolved) {
    throw new BadParams(
      `"${raw.trim()}" is ${resolved}, who is not on the active roster this door serves: ${list}. A creator who has left the roster is not answered here; their old ads appear only inside honest labels such as former_creator_ad.`,
    );
  }
  throw new BadParams(
    `"${v}" is not a creator this door serves. It serves the active roster only: ${list}. The name was checked against every alias in the registry before this refusal, so it is not a spelling problem. A creator who has left the roster is not answered here; their old ads appear only inside honest labels such as former_creator_ad.`,
  );
}

/** One creator, never "all". Used where an answer only makes sense per creator. */
export function requireClient(
  ctx: { db: Db; clients: readonly string[]; resolved: AliasTrail },
  params: Record<string, unknown>,
): Promise<string> {
  return requireAccount(ctx, params, { allowAll: false });
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
