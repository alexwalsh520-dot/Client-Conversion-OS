import Stripe from "stripe";

const API_VERSION = "2025-02-24.acacia" as const;

function getStripeClients() {
  const keithClient = new Stripe(process.env.STRIPE_KEY_KEITH!, {
    apiVersion: API_VERSION,
  });
  const tysonLlpClient = new Stripe(process.env.STRIPE_KEY_TYSON_LLP!, {
    apiVersion: API_VERSION,
  });
  const tysonSubsClient = new Stripe(process.env.STRIPE_KEY_TYSON_SUBS!, {
    apiVersion: API_VERSION,
  });

  return [
    { client: keithClient, influencer: "keith" as const, account: "keith" as const },
    { client: tysonLlpClient, influencer: "tyson" as const, account: "tyson_llp" as const },
    { client: tysonSubsClient, influencer: "tyson" as const, account: "tyson_subs" as const },
  ];
}

export { getStripeClients as stripeClients };

export function getClients() {
  return getStripeClients();
}

export async function fetchCharges(client: Stripe, since: Date): Promise<Stripe.Charge[]> {
  const charges: Stripe.Charge[] = [];
  const params: Stripe.ChargeListParams = {
    created: { gte: Math.floor(since.getTime() / 1000) },
    limit: 100,
  };

  for await (const charge of client.charges.list(params)) {
    charges.push(charge);
  }

  return charges;
}

export async function fetchRefunds(client: Stripe, since: Date): Promise<Stripe.Refund[]> {
  const refunds: Stripe.Refund[] = [];
  const params: Stripe.RefundListParams = {
    created: { gte: Math.floor(since.getTime() / 1000) },
    limit: 100,
  };

  for await (const refund of client.refunds.list(params)) {
    refunds.push(refund);
  }

  return refunds;
}

export async function fetchDisputes(client: Stripe, since: Date): Promise<Stripe.Dispute[]> {
  const disputes: Stripe.Dispute[] = [];
  const params: Stripe.DisputeListParams = {
    created: { gte: Math.floor(since.getTime() / 1000) },
    limit: 100,
  };

  for await (const dispute of client.disputes.list(params)) {
    disputes.push(dispute);
  }

  return disputes;
}
