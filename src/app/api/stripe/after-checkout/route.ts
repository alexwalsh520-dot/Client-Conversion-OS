import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getServiceSupabase } from "@/lib/supabase";
import { buildOnboardingRedirect, parseClientReference, ONBOARDING_WIDGET_URL } from "@/lib/stripe-downsell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// After-checkout bridge (2026-09-12): the $50 Payment Link's after-payment
// redirect points here with ?session_id={CHECKOUT_SESSION_ID}. We look the
// session up (our own stripe_payments row first, Stripe second) and forward
// the buyer to the onboarding booking widget with the ad keyword + ManyChat
// subscriber id in utm_content / utm_term, so the onboarding booking is
// attributed by the existing GHL appointment webhook with zero new booking
// code. The buyer is NEVER blocked: any failure falls back to the bare widget.
// ---------------------------------------------------------------------------

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_KEY_TYSON_SUBS || process.env.STRIPE_SECRET_KEY_TYSON_SUBS;
  return key ? new Stripe(key) : null;
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id") ?? "";
  const headers = { "Cache-Control": "no-store" };
  if (!/^cs_[A-Za-z0-9_]{8,}$/.test(sessionId)) {
    return NextResponse.redirect(ONBOARDING_WIDGET_URL, { status: 302, headers });
  }

  let target = ONBOARDING_WIDGET_URL;
  try {
    const sb = getServiceSupabase();
    const { data: row } = await sb
      .from("stripe_payments")
      .select("id, keyword, subscriber_id, client_reference_id, email, phone, contact_name")
      .eq("checkout_session_id", sessionId)
      .maybeSingle();

    let keywordRaw: string | null = null;
    let subscriberId: string | null = null;
    let email: string | null = null;
    let phone: string | null = null;
    let name: string | null = null;

    if (row) {
      const ref = parseClientReference(row.client_reference_id);
      keywordRaw = ref.keywordRaw ?? row.keyword;
      subscriberId = ref.subscriberId ?? row.subscriber_id;
      email = row.email;
      phone = row.phone;
      name = row.contact_name;
    } else {
      // Webhook may not have landed yet (redirect and webhook race). Ask Stripe.
      const stripe = stripeClient();
      if (stripe) {
        const s = await stripe.checkout.sessions.retrieve(sessionId);
        const ref = parseClientReference(s.client_reference_id);
        keywordRaw = ref.keywordRaw;
        subscriberId = ref.subscriberId;
        email = s.customer_details?.email ?? null;
        phone = s.customer_details?.phone ?? null;
        name = s.customer_details?.name ?? null;
      }
    }

    target = buildOnboardingRedirect({ keywordRaw, subscriberId, email, phone, name });

    if (row?.id) {
      await sb
        .from("stripe_payments")
        .update({ redirected_at: new Date().toISOString() })
        .eq("id", row.id)
        .is("redirected_at", null);
    }
  } catch {
    target = ONBOARDING_WIDGET_URL;
  }

  return NextResponse.redirect(target, { status: 302, headers });
}
