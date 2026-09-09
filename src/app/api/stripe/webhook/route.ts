import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Stripe webhook — $50 downsell attribution (built 2026-09-09).
//
// The DM Stripe link carries ?client_reference_id={{keyword}}--{{subscriber_id}}
// (optionally client--keyword--subscriber). Stripe calls this endpoint on
// checkout.session.completed / charge.refunded. Signature-verified with
// STRIPE_WEBHOOK_SECRET, idempotent on checkout_session_id, and every paid
// session with a keyword also writes a canonical ads_keyword_events row
// (source 'stripe', event_type 'stripe_sale') so existing attribution joins
// see it natively. Money surfaces read stripe_payments NET of refunds.
// ---------------------------------------------------------------------------

function parseReference(ref: string | null | undefined): { clientKey: string; keyword: string | null; subscriberId: string | null } {
  const fallback = { clientKey: "tyson", keyword: null, subscriberId: null };
  if (!ref) return fallback;
  const parts = ref.trim().toLowerCase().split("--").filter(Boolean);
  if (parts.length === 3) return { clientKey: parts[0], keyword: parts[1], subscriberId: parts[2] };
  if (parts.length === 2) {
    if (/^\d+$/.test(parts[1])) return { clientKey: "tyson", keyword: parts[0], subscriberId: parts[1] };
    return { clientKey: parts[0], keyword: parts[1], subscriberId: null };
  }
  if (parts.length === 1) return { clientKey: "tyson", keyword: parts[0], subscriberId: null };
  return fallback;
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is not configured" }, { status: 503 });
  }
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing stripe-signature header" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = await Stripe.webhooks.constructEventAsync(payload, signature, secret);
  } catch (err) {
    return NextResponse.json({ error: `signature verification failed: ${(err as Error).message}` }, { status: 400 });
  }

  const sb = getServiceSupabase();

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.payment_status !== "paid") return NextResponse.json({ received: true, skipped: "not paid" });
      const { clientKey, keyword, subscriberId } = parseReference(s.client_reference_id);
      const paidAt = new Date((s.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();
      const row = {
        checkout_session_id: s.id,
        payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null,
        stripe_event_id: event.id,
        client_key: clientKey,
        keyword,
        subscriber_id: subscriberId,
        client_reference_id: s.client_reference_id ?? null,
        email: s.customer_details?.email ?? null,
        contact_name: s.customer_details?.name ?? null,
        amount_cents: s.amount_total ?? 0,
        currency: s.currency ?? "usd",
        paid_at: paidAt,
        raw: { livemode: event.livemode, payment_link: s.payment_link ?? null },
      };
      const { error: insErr } = await sb.from("stripe_payments").upsert(row, { onConflict: "checkout_session_id", ignoreDuplicates: true });
      if (insErr) throw insErr;

      if (keyword) {
        const { data: existing, error: exErr } = await sb
          .from("ads_keyword_events")
          .select("id")
          .eq("source", "stripe")
          .eq("source_event_id", s.id)
          .limit(1);
        if (exErr) throw exErr;
        if (!existing?.length) {
          const { error: evErr } = await sb.from("ads_keyword_events").insert({
            source: "stripe",
            source_event_id: s.id,
            event_type: "stripe_sale",
            client_key: clientKey,
            keyword_raw: keyword,
            keyword_normalized: keyword,
            subscriber_id: subscriberId,
            contact_name: s.customer_details?.name ?? null,
            value_cents: s.amount_total ?? 0,
            event_at: paidAt,
            raw_payload: { checkout_session_id: s.id, email: s.customer_details?.email ?? null },
          });
          if (evErr) throw evErr;
        }
      }
      return NextResponse.json({ received: true, keyword, subscriber_id: subscriberId });
    }

    if (event.type === "charge.refunded") {
      const ch = event.data.object as Stripe.Charge;
      const intent = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
      if (intent) {
        const { error: upErr } = await sb
          .from("stripe_payments")
          .update({
            refunded_cents: ch.amount_refunded ?? 0,
            status: ch.refunded ? "refunded" : "partially_refunded",
            updated_at: new Date().toISOString(),
          })
          .eq("payment_intent", intent);
        if (upErr) throw upErr;
      }
      return NextResponse.json({ received: true, refunded: intent ?? null });
    }

    return NextResponse.json({ received: true, ignored: event.type });
  } catch (err) {
    // 500 makes Stripe retry — nothing is silently lost.
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
