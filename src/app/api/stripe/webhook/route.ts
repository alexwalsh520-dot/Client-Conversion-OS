import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getServiceSupabase } from "@/lib/supabase";
import { DOWNSELL_PAYMENT_LINK_ID, DOWNSELL_PRICE_ID, parseClientReference } from "@/lib/stripe-downsell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Stripe webhook — $50 downsell attribution.
// Built 2026-09-09, extended 2026-09-12 for renewals, refunds and churn.
//
// Events handled (register exactly these on the "The Forge - Subscriptions"
// account):
//   checkout.session.completed   first payment  -> stripe_payments(kind=first_payment)
//                                                 + stripe_subscriptions (identity anchor)
//                                                 + ads_keyword_events(stripe_sale)
//   invoice.paid                 renewal        -> stripe_payments(kind=renewal)
//                                                 + ads_keyword_events(stripe_renewal)
//   charge.refunded              refund         -> refunded_cents on the matching row
//   customer.subscription.deleted churn         -> stripe_subscriptions.status=canceled
//
// Identity: the DM link carries ?client_reference_id={{keyword}}--{{subscriber_id}}.
// Signature-verified with STRIPE_WEBHOOK_SECRET (503 until configured).
// Idempotent: unique on checkout_session_id and on invoice_id, and every
// ads_keyword_events write checks (source, source_event_id) first. A 500
// makes Stripe retry, so nothing is silently lost.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getServiceSupabase>;

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

function isoFromUnix(sec: number | null | undefined): string {
  return new Date((sec || Math.floor(Date.now() / 1000)) * 1000).toISOString();
}

async function writeKeywordEvent(
  sb: Db,
  params: {
    sourceEventId: string;
    eventType: "stripe_sale" | "stripe_renewal";
    clientKey: string;
    keyword: string;
    subscriberId: string | null;
    contactName: string | null;
    valueCents: number;
    eventAt: string;
    raw: Record<string, unknown>;
  },
) {
  const { data: existing, error: exErr } = await sb
    .from("ads_keyword_events")
    .select("id")
    .eq("source", "stripe")
    .eq("source_event_id", params.sourceEventId)
    .limit(1);
  if (exErr) throw exErr;
  if (existing?.length) return;
  const { error } = await sb.from("ads_keyword_events").insert({
    source: "stripe",
    source_event_id: params.sourceEventId,
    event_type: params.eventType,
    client_key: params.clientKey,
    keyword_raw: params.keyword,
    keyword_normalized: params.keyword,
    subscriber_id: params.subscriberId,
    contact_name: params.contactName,
    value_cents: params.valueCents,
    event_at: params.eventAt,
    raw_payload: params.raw,
  });
  if (error) throw error;
}

async function handleCheckoutCompleted(sb: Db, event: Stripe.Event) {
  const s = event.data.object as Stripe.Checkout.Session;
  if (s.payment_status !== "paid") return { received: true, skipped: "not paid" };
  // Only the $50 downsell link belongs in this lane. Other links on the same
  // account (coaching, one-offs) are not $50 subscriptions.
  if (idOf(s.payment_link as string | Stripe.PaymentLink | null) !== DOWNSELL_PAYMENT_LINK_ID) {
    return { received: true, skipped: "not the downsell payment link" };
  }

  const ref = parseClientReference(s.client_reference_id);
  const paidAt = isoFromUnix(s.created);
  const email = s.customer_details?.email ?? null;
  const name = s.customer_details?.name ?? null;
  const phone = s.customer_details?.phone ?? null;
  const subscriptionId = idOf(s.subscription as string | Stripe.Subscription | null);
  const customerId = idOf(s.customer as string | Stripe.Customer | null);
  const invoiceId = idOf(s.invoice as string | Stripe.Invoice | null);

  if (subscriptionId) {
    const { error: subErr } = await sb.from("stripe_subscriptions").upsert(
      {
        subscription_id: subscriptionId,
        customer_id: customerId,
        checkout_session_id: s.id,
        client_key: ref.clientKey,
        keyword: ref.keyword,
        subscriber_id: ref.subscriberId,
        client_reference_id: s.client_reference_id ?? null,
        email,
        phone,
        contact_name: name,
        status: "active",
        started_at: paidAt,
        raw: { livemode: event.livemode, payment_link: s.payment_link ?? null, mode: s.mode },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "subscription_id", ignoreDuplicates: true },
    );
    if (subErr) throw subErr;
  }

  const row = {
    checkout_session_id: s.id,
    invoice_id: invoiceId,
    subscription_id: subscriptionId,
    customer_id: customerId,
    payment_intent: idOf(s.payment_intent as string | Stripe.PaymentIntent | null),
    stripe_event_id: event.id,
    kind: "first_payment",
    billing_reason: "subscription_create",
    client_key: ref.clientKey,
    keyword: ref.keyword,
    subscriber_id: ref.subscriberId,
    client_reference_id: s.client_reference_id ?? null,
    email,
    phone,
    contact_name: name,
    amount_cents: s.amount_total ?? 0,
    currency: s.currency ?? "usd",
    paid_at: paidAt,
    payment_link: idOf(s.payment_link as string | Stripe.PaymentLink | null),
    raw: { livemode: event.livemode, payment_link: s.payment_link ?? null, mode: s.mode },
  };
  const { error: insErr } = await sb
    .from("stripe_payments")
    .upsert(row, { onConflict: "checkout_session_id", ignoreDuplicates: true });
  if (insErr) throw insErr;

  if (ref.keyword) {
    await writeKeywordEvent(sb, {
      sourceEventId: s.id,
      eventType: "stripe_sale",
      clientKey: ref.clientKey,
      keyword: ref.keyword,
      subscriberId: ref.subscriberId,
      contactName: name,
      valueCents: s.amount_total ?? 0,
      eventAt: paidAt,
      raw: { checkout_session_id: s.id, subscription_id: subscriptionId, email },
    });
  }
  return { received: true, kind: "first_payment", keyword: ref.keyword, subscriber_id: ref.subscriberId };
}

async function handleInvoicePaid(sb: Db, event: Stripe.Event) {
  const inv = event.data.object as Stripe.Invoice;
  // The first invoice of a subscription is owned by checkout.session.completed
  // (that event carries client_reference_id; the invoice does not).
  if (inv.billing_reason !== "subscription_cycle") {
    return { received: true, skipped: `invoice ${inv.billing_reason ?? "unknown"}` };
  }
  if (inv.status !== "paid" || !inv.amount_paid) return { received: true, skipped: "invoice not paid" };
  const onDownsellPrice = (inv.lines?.data ?? []).some(
    (l) => (typeof l.price === "string" ? l.price : l.price?.id) === DOWNSELL_PRICE_ID,
  );
  if (!onDownsellPrice) return { received: true, skipped: "invoice not on the downsell price" };
  const subscriptionId = idOf(inv.subscription as string | Stripe.Subscription | null);
  const customerId = idOf(inv.customer as string | Stripe.Customer | null);

  let anchor: {
    client_key: string;
    keyword: string | null;
    subscriber_id: string | null;
    email: string | null;
    phone: string | null;
    contact_name: string | null;
  } | null = null;
  if (subscriptionId) {
    const { data, error } = await sb
      .from("stripe_subscriptions")
      .select("client_key, keyword, subscriber_id, email, phone, contact_name")
      .eq("subscription_id", subscriptionId)
      .maybeSingle();
    if (error) throw error;
    anchor = data;
  }
  const paidAt = isoFromUnix(inv.status_transitions?.paid_at ?? inv.created);
  const email = anchor?.email ?? inv.customer_email ?? null;
  const name = anchor?.contact_name ?? inv.customer_name ?? null;
  const phone = anchor?.phone ?? inv.customer_phone ?? null;

  const row = {
    checkout_session_id: null,
    invoice_id: inv.id,
    subscription_id: subscriptionId,
    customer_id: customerId,
    payment_intent: idOf(inv.payment_intent as string | Stripe.PaymentIntent | null),
    stripe_event_id: event.id,
    kind: "renewal",
    billing_reason: inv.billing_reason,
    client_key: anchor?.client_key ?? "tyson",
    keyword: anchor?.keyword ?? null,
    subscriber_id: anchor?.subscriber_id ?? null,
    client_reference_id: null,
    email,
    phone,
    contact_name: name,
    amount_cents: inv.amount_paid,
    currency: inv.currency ?? "usd",
    paid_at: paidAt,
    raw: { livemode: event.livemode, anchor_found: Boolean(anchor) },
  };
  const { error: insErr } = await sb
    .from("stripe_payments")
    .upsert(row, { onConflict: "invoice_id", ignoreDuplicates: true });
  if (insErr) throw insErr;

  if (anchor?.keyword) {
    await writeKeywordEvent(sb, {
      sourceEventId: inv.id,
      eventType: "stripe_renewal",
      clientKey: anchor.client_key,
      keyword: anchor.keyword,
      subscriberId: anchor.subscriber_id,
      contactName: name,
      valueCents: inv.amount_paid,
      eventAt: paidAt,
      raw: { invoice_id: inv.id, subscription_id: subscriptionId, email },
    });
  }
  return { received: true, kind: "renewal", keyword: anchor?.keyword ?? null, anchored: Boolean(anchor) };
}

async function handleChargeRefunded(sb: Db, event: Stripe.Event) {
  const ch = event.data.object as Stripe.Charge;
  const intent = idOf(ch.payment_intent as string | Stripe.PaymentIntent | null);
  const invoice = idOf(ch.invoice as string | Stripe.Invoice | null);
  const patch = {
    refunded_cents: ch.amount_refunded ?? 0,
    status: ch.refunded ? "refunded" : "partially_refunded",
    updated_at: new Date().toISOString(),
  };
  let matched = 0;
  if (intent) {
    const { data, error } = await sb.from("stripe_payments").update(patch).eq("payment_intent", intent).select("id");
    if (error) throw error;
    matched = data?.length ?? 0;
  }
  if (!matched && invoice) {
    const { data, error } = await sb.from("stripe_payments").update(patch).eq("invoice_id", invoice).select("id");
    if (error) throw error;
    matched = data?.length ?? 0;
  }
  return { received: true, refunded: intent ?? invoice ?? null, matched };
}

async function handleSubscriptionDeleted(sb: Db, event: Stripe.Event) {
  const sub = event.data.object as Stripe.Subscription;
  const { error } = await sb
    .from("stripe_subscriptions")
    .update({
      status: "canceled",
      canceled_at: isoFromUnix(sub.canceled_at ?? sub.ended_at ?? null),
      cancel_reason: sub.cancellation_details?.reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("subscription_id", sub.id);
  if (error) throw error;
  return { received: true, canceled: sub.id };
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
    switch (event.type) {
      case "checkout.session.completed":
        return NextResponse.json(await handleCheckoutCompleted(sb, event));
      case "invoice.paid":
        return NextResponse.json(await handleInvoicePaid(sb, event));
      case "charge.refunded":
        return NextResponse.json(await handleChargeRefunded(sb, event));
      case "customer.subscription.deleted":
        return NextResponse.json(await handleSubscriptionDeleted(sb, event));
      default:
        return NextResponse.json({ received: true, ignored: event.type });
    }
  } catch (err) {
    // 500 makes Stripe retry — nothing is silently lost.
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
