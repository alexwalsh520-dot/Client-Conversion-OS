// Stripe helper for DM Reviews
// Per-client key switching for Tyson and Keith

import Stripe from "stripe";

type Client = "tyson" | "keith";

const stripeClients: Partial<Record<Client, Stripe>> = {};

function getStripeClient(client: Client): Stripe {
  if (stripeClients[client]) return stripeClients[client]!;

  const key =
    client === "tyson"
      ? process.env.STRIPE_SECRET_KEY_TYSON
      : process.env.STRIPE_SECRET_KEY_KEITH;

  if (!key) throw new Error(`STRIPE_SECRET_KEY_${client.toUpperCase()} not configured`);

  const stripe = new Stripe(key);
  stripeClients[client] = stripe;
  return stripe;
}

function getProductId(client: Client): string {
  const id =
    client === "tyson"
      ? process.env.STRIPE_PRODUCT_ID_TYSON
      : process.env.STRIPE_PRODUCT_ID_KEITH;

  if (!id) throw new Error(`STRIPE_PRODUCT_ID_${client.toUpperCase()} not configured`);
  return id;
}

// Count successful payments for the client's product within date range
export async function countSubscriptionSales(
  client: Client,
  dateFrom: string,
  dateTo: string
): Promise<number> {
  const stripe = getStripeClient(client);
  const productId = getProductId(client);

  const fromTs = Math.floor(new Date(dateFrom).getTime() / 1000);
  const toTs = Math.floor(new Date(dateTo + "T23:59:59Z").getTime() / 1000);

  let count = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Stripe.PaymentIntentListParams = {
      created: { gte: fromTs, lte: toTs },
      limit: 100,
    };
    if (startingAfter) params.starting_after = startingAfter;

    const paymentIntents = await stripe.paymentIntents.list(params);

    for (const pi of paymentIntents.data) {
      if (pi.status !== "succeeded") continue;

      // Check if this payment is for our product
      // Payment intents may have metadata linking to product, or we check via invoice/line items
      if (pi.metadata?.product_id === productId) {
        count++;
        continue;
      }

      // Also check via the invoice if available
      if (pi.invoice) {
        try {
          const invoice = await stripe.invoices.retrieve(pi.invoice as string, {
            expand: ["lines.data"],
          });
          const hasProduct = invoice.lines?.data?.some(
            (line) =>
              line.price?.product === productId ||
              line.plan?.product === productId
          );
          if (hasProduct) count++;
        } catch {
          // Skip if invoice retrieval fails
        }
      }
    }

    hasMore = paymentIntents.has_more;
    if (paymentIntents.data.length > 0) {
      startingAfter = paymentIntents.data[paymentIntents.data.length - 1].id;
    } else {
      hasMore = false;
    }
  }

  return count;
}
