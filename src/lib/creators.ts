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

export type CreatorKey = "tyson" | "keith" | "lucy";

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
}

export const CREATORS: readonly Creator[] = [
  {
    key: "tyson",
    name: "Tyson",
    timezone: "America/Los_Angeles",
    adAccountEnv: ["META_AD_ACCOUNT_TYSON", "META_ADS_ACCOUNT_TYSON"],
    tokenEnv: ["META_ACCESS_TOKEN_TYSON", "META_ADS_TOKEN", "META_ACCESS_TOKEN"],
    defaultAdAccountId: "act_176726311",
  },
  {
    key: "keith",
    name: "Keith",
    timezone: "America/New_York",
    adAccountEnv: ["META_AD_ACCOUNT_KEITH", "META_ADS_ACCOUNT_KEITH"],
    tokenEnv: ["META_ACCESS_TOKEN_KEITH", "META_ADS_TOKEN_KEITH", "META_ACCESS_TOKEN"],
    defaultAdAccountId: "act_861990450801193",
  },
  {
    key: "lucy",
    name: "Lucy",
    // Default to the reporting timezone until Lucy's ad account timezone is confirmed.
    timezone: "America/New_York",
    adAccountEnv: ["META_AD_ACCOUNT_LUCY_HUBBARD", "META_AD_ACCOUNT_LUCY", "META_ADS_ACCOUNT_LUCY"],
    tokenEnv: ["META_ACCESS_TOKEN_LUCY_HUBBARD", "META_ACCESS_TOKEN_LUCY", "META_ACCESS_TOKEN"],
    // No defaultAdAccountId yet — supplied via Vercel env var once Lucy is connected.
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
