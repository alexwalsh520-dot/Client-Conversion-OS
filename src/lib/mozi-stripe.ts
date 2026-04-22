import Stripe from "stripe";

const API_VERSION = "2025-02-24.acacia" as const;

type StripeInfluencer = "keith" | "tyson";
type StripeAccountName = "keith" | "tyson_llp" | "tyson_subs";

interface StripeClientConfig {
  secretKey?: string;
  influencer: StripeInfluencer;
  account: StripeAccountName;
}

function getStripeClients() {
  const configs: StripeClientConfig[] = [
    {
      secretKey: process.env.STRIPE_KEY_KEITH,
      influencer: "keith",
      account: "keith",
    },
    {
      secretKey: process.env.STRIPE_KEY_TYSON_LLP,
      influencer: "tyson",
      account: "tyson_llp",
    },
    {
      secretKey: process.env.STRIPE_KEY_TYSON_SUBS,
      influencer: "tyson",
      account: "tyson_subs",
    },
  ];

  return configs
    .filter((config): config is StripeClientConfig & { secretKey: string } => Boolean(config.secretKey))
    .map((config) => ({
      client: new Stripe(config.secretKey, {
        apiVersion: API_VERSION,
      }),
      influencer: config.influencer,
      account: config.account,
    }));
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
