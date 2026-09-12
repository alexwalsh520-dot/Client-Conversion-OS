// Shared pieces of the $50 downsell attribution chain (2026-09-12).
//
// The DM link is a Stripe Payment Link. ManyChat renders it as
//   https://buy.stripe.com/<link>?client_reference_id={{keyword}}--{{user_id}}
// so the ad keyword and the ManyChat subscriber id ride on the checkout
// session. Stripe hands them back on every webhook, and after payment the
// buyer is redirected through /api/stripe/after-checkout, which forwards the
// same two ids onto the onboarding booking widget as utm_content / utm_term
// (the exact two fields the GHL appointment webhook already reads).

/** The $50 downsell price and its payment link on "The Forge - Subscriptions".
 *  The webhook only records money on THIS price: the same Stripe account sells
 *  other things, and a $597 invoice must never land in the $50 lane. */
export const DOWNSELL_PRICE_ID = process.env.STRIPE_DOWNSELL_PRICE_ID || "price_1RgMovJe2jHwj40lqNP1jeJ9";
export const DOWNSELL_PAYMENT_LINK_ID = process.env.STRIPE_DOWNSELL_PAYMENT_LINK_ID || "plink_1RgMuVJe2jHwj40lejxT5GDV";

/** The GHL widget the $50 buyer books their onboarding call on. */
export const ONBOARDING_WIDGET_URL =
  process.env.STRIPE_AFTER_CHECKOUT_TARGET ||
  "https://api.leadconnectorhq.com/widget/bookings/onboarding-call-with-the-forge";

export type ParsedReference = {
  clientKey: string;
  /** Keyword exactly as the link carried it (case kept; ads-v2 normalizes downstream). */
  keywordRaw: string | null;
  /** Lower-cased keyword for storage and joins. */
  keyword: string | null;
  subscriberId: string | null;
};

/**
 * client_reference_id forms accepted (Stripe allows [A-Za-z0-9_-], max 200):
 *   keyword--subscriber_id          (the ManyChat flow form)
 *   client--keyword--subscriber_id  (future second creator)
 *   keyword                         (hand-pasted per-keyword link)
 * An empty keyword ("--123456", organic walk-in with no keyword field) keeps
 * the subscriber id and leaves keyword null.
 */
export function parseClientReference(ref: string | null | undefined): ParsedReference {
  const empty: ParsedReference = { clientKey: "tyson", keywordRaw: null, keyword: null, subscriberId: null };
  if (!ref) return empty;
  const parts = ref.trim().split("--").map((p) => p.trim());
  const isSub = (p: string) => /^\d{5,}$/.test(p);
  let clientKey = "tyson";
  let keywordRaw: string | null = null;
  let subscriberId: string | null = null;

  if (parts.length >= 3) {
    clientKey = parts[0].toLowerCase() || "tyson";
    keywordRaw = parts[1] || null;
    subscriberId = isSub(parts[2]) ? parts[2] : null;
  } else if (parts.length === 2) {
    if (isSub(parts[1])) {
      keywordRaw = parts[0] || null;
      subscriberId = parts[1];
    } else {
      clientKey = parts[0].toLowerCase() || "tyson";
      keywordRaw = parts[1] || null;
    }
  } else if (parts.length === 1) {
    if (isSub(parts[0])) subscriberId = parts[0];
    else keywordRaw = parts[0] || null;
  }
  if (keywordRaw && !/^[A-Za-z0-9_-]{1,64}$/.test(keywordRaw)) keywordRaw = null;
  if (!/^[a-z0-9_]{1,32}$/.test(clientKey)) clientKey = "tyson";
  return { clientKey, keywordRaw, keyword: keywordRaw ? keywordRaw.toLowerCase() : null, subscriberId };
}

/** Build the onboarding widget URL with identity + prefill riding along. */
export function buildOnboardingRedirect(params: {
  keywordRaw?: string | null;
  subscriberId?: string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
}): string {
  const url = new URL(ONBOARDING_WIDGET_URL);
  // utm_content / utm_term are what the GHL appointment webhook mines.
  url.searchParams.set("utm_content", params.keywordRaw ?? "");
  url.searchParams.set("utm_term", params.subscriberId ?? "");
  url.searchParams.set("utm_source", "stripe");
  url.searchParams.set("utm_medium", "downsell");
  // Prefill (harmless if the widget ignores it; keeps the booking's email
  // identical to the Stripe email, our second hard key).
  if (params.email) url.searchParams.set("email", params.email);
  if (params.phone) url.searchParams.set("phone", params.phone);
  if (params.name) {
    const trimmed = params.name.trim();
    const space = trimmed.indexOf(" ");
    url.searchParams.set("first_name", space > 0 ? trimmed.slice(0, space) : trimmed);
    if (space > 0) url.searchParams.set("last_name", trimmed.slice(space + 1));
  }
  return url.toString();
}
