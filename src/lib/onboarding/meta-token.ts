// Server-only: turn whatever Meta token a partner pastes during onboarding into
// a long-lived one automatically, so they never have to convert it themselves
// and we get a durable token on file.
//
// The exchange (grant_type=fb_exchange_token) accepts a short-lived OR an
// already-long-lived user token and returns a ~60-day token. If anything goes
// wrong (bad secret, a system-user token that can't be exchanged, network) we
// fall back to the token they gave us so onboarding still succeeds and the team
// can finish it by hand.

const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v24.0";

export interface MetaTokenExchange {
  /** Did we successfully obtain a (new) long-lived token? */
  ok: boolean;
  /** The token to store — the long-lived one on success, else the original. */
  token: string;
  /** Whether the stored token is long-lived (never-expiring or > 2 days out). */
  longLived: boolean;
  /** ISO expiry, or null when it never expires / is unknown. */
  expiresAt: string | null;
  /** Human-readable failure reason, or null on success. */
  error: string | null;
}

export async function exchangeMetaLongLived(
  appId: string | undefined,
  appSecret: string | undefined,
  token: string | undefined
): Promise<MetaTokenExchange> {
  const raw = (token ?? "").trim();
  const id = (appId ?? "").trim();
  const secret = (appSecret ?? "").trim();

  const fallback = (error: string): MetaTokenExchange => ({
    ok: false,
    token: raw,
    longLived: false,
    expiresAt: null,
    error,
  });

  if (!id || !secret || !raw) {
    return fallback("Need App ID, App Secret, and a token to extend it.");
  }

  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", id);
    url.searchParams.set("client_secret", secret);
    url.searchParams.set("fb_exchange_token", raw);

    const res = await fetch(url.toString(), { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as
      | { access_token?: string; error?: { message?: string } }
      | null;

    if (!res.ok || !data?.access_token) {
      return fallback(data?.error?.message || `Meta rejected the exchange (${res.status}).`);
    }

    const longToken = String(data.access_token);
    const info = await inspectToken(id, secret, longToken);
    return { ok: true, token: longToken, longLived: info.longLived, expiresAt: info.expiresAt, error: null };
  } catch (err) {
    return fallback(err instanceof Error ? err.message : "Could not reach Meta to extend the token.");
  }
}

/** Ask Meta when the token expires so we can record it (best effort). */
async function inspectToken(
  appId: string,
  appSecret: string,
  token: string
): Promise<{ longLived: boolean; expiresAt: string | null }> {
  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token`);
    url.searchParams.set("input_token", token);
    url.searchParams.set("access_token", `${appId}|${appSecret}`);
    const res = await fetch(url.toString(), { cache: "no-store" });
    const j = (await res.json().catch(() => null)) as { data?: { expires_at?: number } } | null;
    const exp = j?.data?.expires_at;
    // No expiry field, or 0 => never expires.
    if (typeof exp !== "number" || exp === 0) return { longLived: true, expiresAt: null };
    const ms = exp * 1000;
    return { longLived: ms - Date.now() > 2 * 24 * 60 * 60 * 1000, expiresAt: new Date(ms).toISOString() };
  } catch {
    // Exchange already succeeded; assume the ~60-day long-lived default.
    return { longLived: true, expiresAt: null };
  }
}
