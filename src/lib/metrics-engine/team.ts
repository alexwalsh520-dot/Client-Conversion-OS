// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — the rep roster.
//
// Full-cycle reps: each one both sets and closes their own calls. This map
// is deliberately hardcoded config for now; it should later move into the
// registry (team_members, src/lib/registry.ts) once reps carry their GHL
// user ids there. Until then this file is the metrics engine's single
// source of truth for "who is a rep".
// ─────────────────────────────────────────────────────────────────────────

export interface Rep {
  /** Short internal key used across the metrics engine. */
  key: string;
  /** Display name. */
  name: string;
  /** GoHighLevel user id (assigned_user_id on appointments). */
  ghlUserId: string;
  /**
   * Lowercase fragments that identify this rep wherever their name shows up
   * (sales-tracker Closer column, manual entries). First name plus surname,
   * plus known sheet aliases.
   */
  matchTokens: readonly string[];
}

export const REPS: readonly Rep[] = [
  { key: "austin", name: "Austin Richard", ghlUserId: "sXMfoQQdUn31JmQCPDJx", matchTokens: ["austin", "richard"] },
  // The sheet historically wrote Jacob as "BROZ".
  { key: "jacob", name: "Jacob Broz", ghlUserId: "BF7iGUWE21SefwMNkzo5", matchTokens: ["jacob", "broz"] },
  { key: "erin", name: "Erin Ireland", ghlUserId: "ywzNqui5VWQ39eVC0yWh", matchTokens: ["erin", "ireland"] },
  { key: "andrew", name: "Andrew Wobbe", ghlUserId: "gnkk8iQ3JituAitjP60E", matchTokens: ["andrew", "wobbe"] },
  { key: "chris", name: "Chris Jolivette", ghlUserId: "7SFLShe0ZmZU23xTwufB", matchTokens: ["chris", "jolivette"] },
  { key: "will", name: "Will Rincan", ghlUserId: "Rvct5f3Mr1IY4yT575Lj", matchTokens: ["will", "rincan"] },
];

export const REPS_BY_KEY: Record<string, Rep> = Object.fromEntries(
  REPS.map((rep) => [rep.key, rep]),
);

const REPS_BY_GHL_ID: Record<string, Rep> = Object.fromEntries(
  REPS.map((rep) => [rep.ghlUserId, rep]),
);

/** Rep key from a GHL assigned_user_id, or null. */
export function repKeyFromGhlUserId(id: string | null | undefined): string | null {
  if (!id) return null;
  return REPS_BY_GHL_ID[id]?.key ?? null;
}

/** True if `value` is a known rep key. */
export function isRepKey(value: unknown): value is string {
  return typeof value === "string" && Boolean(REPS_BY_KEY[value]);
}

/**
 * Rep key from free text (the sheet's Closer column, a typed rep name).
 * Token containment with an ambiguity guard, same discipline as
 * creatorKeyFromText: exactly one rep must match or nobody is credited.
 */
export function repKeyFromText(...values: Array<string | null | undefined>): string | null {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  const trimmed = text.trim();
  if (!trimmed) return null;

  const exact = REPS.find((r) => r.key === trimmed);
  if (exact) return exact.key;

  // Match on whole words so "willow" never credits Will.
  const words = new Set(trimmed.split(/[^a-z]+/).filter(Boolean));
  const matches = new Set<string>();
  for (const rep of REPS) {
    if (rep.matchTokens.some((token) => words.has(token))) matches.add(rep.key);
  }
  if (matches.size === 1) return [...matches][0];
  return null;
}
