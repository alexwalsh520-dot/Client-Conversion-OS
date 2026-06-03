// ─────────────────────────────────────────────────────────────────────────
// CREATORS — single source of truth for the people we run Meta ads for.
//
// To onboard a NEW creator:
//   1. Add ONE entry to the CREATORS list below (key, name, timezone, env names).
//   2. Add their secrets in Vercel env vars (NEVER in code or the database):
//        META_AD_ACCOUNT_<NAME>   = their Meta ad account id (e.g. act_123456)
//        META_ACCESS_TOKEN_<NAME> = their Meta access token
//   3. That's it — every part of the dashboard reads from this list.
//
// Until a creator's env vars are set, the ads pages skip them gracefully
// (they show "not configured" instead of erroring).
// ─────────────────────────────────────────────────────────────────────────

export type CreatorKey = "tyson" | "keith" | "lucy" | "antwan";

export interface Creator {
  /** Short internal key used across the ads pipeline. */
  key: CreatorKey;
  /** Display name shown in the UI. */
  name: string;
  /** The ad account's reporting timezone (controls day-boundary bucketing). */
  timezone: string;
  /** Env var names that may hold the Meta ad account id, in priority order. */
  adAccountEnv: readonly string[];
  /** Env var names that may hold the Meta access token, in priority order. */
  tokenEnv: readonly string[];
  /** Optional hardcoded ad account id used as a fallback if no env var is set. */
  defaultAdAccountId?: string;
  /**
   * Lowercase fragments that reliably identify this creator wherever their
   * name shows up — GHL lead tags ("tyson sonnek lead"), calendar names,
   * ManyChat client fields, sale offer text, etc. Used by `creatorKeyFromText`
   * to attribute a booking/sale to the right creator. Keep these specific
   * enough that they can't collide with another creator.
   */
  matchTokens: readonly string[];
}

export const CREATORS: readonly Creator[] = [
  {
    key: "tyson",
    name: "Tyson",
    timezone: "America/Los_Angeles",
    adAccountEnv: ["META_AD_ACCOUNT_TYSON", "META_ADS_ACCOUNT_TYSON"],
    tokenEnv: ["META_ACCESS_TOKEN_TYSON", "META_ADS_TOKEN", "META_ACCESS_TOKEN"],
    defaultAdAccountId: "act_176726311",
    matchTokens: ["tyson", "sonnek", "(ts)"],
  },
  {
    key: "keith",
    name: "Keith",
    timezone: "America/New_York",
    adAccountEnv: ["META_AD_ACCOUNT_KEITH", "META_ADS_ACCOUNT_KEITH"],
    tokenEnv: ["META_ACCESS_TOKEN_KEITH", "META_ADS_TOKEN_KEITH", "META_ACCESS_TOKEN"],
    defaultAdAccountId: "act_861990450801193",
    matchTokens: ["keith", "holland", "(kh)"],
  },
  {
    key: "lucy",
    name: "Lucy",
    // Default to the reporting timezone until Lucy's ad account timezone is confirmed.
    timezone: "America/New_York",
    adAccountEnv: ["META_AD_ACCOUNT_LUCY_HUBBARD", "META_AD_ACCOUNT_LUCY", "META_ADS_ACCOUNT_LUCY"],
    tokenEnv: ["META_ACCESS_TOKEN_LUCY_HUBBARD", "META_ACCESS_TOKEN_LUCY", "META_ACCESS_TOKEN"],
    // No defaultAdAccountId yet — supplied via Vercel env var once Lucy is connected.
    matchTokens: ["lucy", "hubbard"],
  },
  {
    key: "antwan",
    name: "Antwan",
    // Default until Antwan's ad-account timezone is confirmed.
    timezone: "America/New_York",
    adAccountEnv: ["META_AD_ACCOUNT_ANTWAN_RARCUS", "META_AD_ACCOUNT_ANTWAN"],
    tokenEnv: ["META_ACCESS_TOKEN_ANTWAN_RARCUS", "META_ACCESS_TOKEN_ANTWAN", "META_ACCESS_TOKEN"],
    defaultAdAccountId: "act_275999723846625", // Against All Odds Fitness (never-expire System User token)
    matchTokens: ["antwan", "rarcus", "against all odds"],
  },
];

export const CREATORS_BY_KEY: Record<CreatorKey, Creator> = Object.fromEntries(
  CREATORS.map((creator) => [creator.key, creator]),
) as Record<CreatorKey, Creator>;

/** Returns the value of the first env var in `names` that is set, else null. */
export function firstEnv(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

/** Ensures a Meta ad account id has the required `act_` prefix. */
export function normalizeAdAccountId(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

/** True if `value` is a known creator key. */
export function isCreatorKey(value: unknown): value is CreatorKey {
  return typeof value === "string" && CREATORS.some((c) => c.key === value);
}

/**
 * Figure out which creator a piece of text belongs to, by looking for any of
 * their `matchTokens` anywhere in the combined text. This is the single source
 * of truth for creator detection across the whole attribution pipeline
 * (GHL booking tags, calendar names, ManyChat client fields, sale offer text).
 *
 * Safety rules, in priority order:
 *   1. An exact match on a creator key (e.g. the stored string is just "tyson")
 *      always wins — this keeps already-clean data stable.
 *   2. Otherwise we collect every creator whose tokens appear in the text.
 *   3. If exactly one creator matches, return it.
 *   4. If two or more *different* creators match, the text is ambiguous, so we
 *      return null and let a human decide rather than guess wrong.
 */
export function creatorKeyFromText(
  ...values: Array<string | null | undefined>
): CreatorKey | null {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (!text.trim()) return null;

  // Rule 1: the text is already exactly a creator key.
  const trimmed = text.trim();
  const exact = CREATORS.find((c) => c.key === trimmed);
  if (exact) return exact.key;

  // Rules 2-4: token containment with an ambiguity guard.
  const matches = new Set<CreatorKey>();
  for (const creator of CREATORS) {
    if (creator.matchTokens.some((token) => text.includes(token))) {
      matches.add(creator.key);
    }
  }
  if (matches.size === 1) return [...matches][0];
  return null;
}
