// Supplements vertical — server data layer.
//
// Builds the full dashboard payload. Source connectivity is detected from env +
// whether the backing Supabase tables have rows. Metric VALUES are computed from
// the `supplements_*` event tables once data lands; until then every value is null
// and the UI renders an honest "awaiting connection" state.
//
// Phase 2 (when Shopify/GHL syncs are live) fills in the aggregation queries marked
// `PHASE 2:` below — the shape returned here does not change, so the UI is a no-op.

import { getServiceSupabase } from "@/lib/supabase";
import type {
  FunnelRow,
  MetricSection,
  MoneyRow,
  PeriodInfo,
  PeriodKey,
  SourceStatus,
  SplitValue,
  SupplementsDashboardData,
} from "@/lib/supplements-types";

// ── Source connectivity ─────────────────────────────────────────────────────────

const hasShopifyCreds = () =>
  !!(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_TOKEN);

const hasGhlCcCreds = () =>
  !!(process.env.GHL_CC_CLIENTS_LOCATION_ID && process.env.GHL_CC_CLIENTS_TOKEN);

/** Count rows in a table; returns 0 if the table doesn't exist yet. */
async function tableCount(table: string): Promise<number> {
  try {
    const sb = getServiceSupabase();
    const { count, error } = await sb
      .from(table)
      .select("id", { count: "exact", head: true });
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function buildSources(): Promise<SourceStatus[]> {
  const [payments, appointments] = await Promise.all([
    tableCount("supplements_payments"),
    tableCount("supplements_appointments"),
  ]);

  const shopifyLive = hasShopifyCreds() && payments > 0;
  const ghlLive = hasGhlCcCreds() && appointments > 0;

  return [
    {
      key: "shopify",
      label: "Shopify",
      connected: shopifyLive,
      powers:
        "Revenue, cash collected (Day 0 + total), AOV, customer LTV, refunds, sales close",
      whatToDo: hasShopifyCreds()
        ? "Credentials present — run the first sync to pull orders."
        : "Create a Shopify custom app (Admin API) and add SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_TOKEN.",
    },
    {
      key: "ghl",
      label: "GHL — CC-Clients",
      connected: ghlLive,
      powers: "Calls booked, calls showed, show rate, booking rate, customer path tags",
      whatToDo: hasGhlCcCreds()
        ? "Credentials present — run the first calendar sync."
        : "Add the CC-Clients location ID + a Private Integration Token with calendar+contact scopes (GHL_CC_CLIENTS_LOCATION_ID / GHL_CC_CLIENTS_TOKEN).",
    },
    {
      key: "subscriptions",
      label: "Subscriptions",
      connected: false,
      powers: "MRR, ARR",
      whatToDo:
        "Confirm whether supplements sell on a subscription (Recharge / Shopify Subscriptions / Stripe). If not, MRR/ARR stay at $0 by design.",
    },
    {
      key: "cogs",
      label: "COGS / costs",
      connected: (await tableCount("supplements_cogs")) > 0,
      powers: "Profit, profit per call, 30-Day GP, LTGP (the 'add later' section)",
      whatToDo:
        "Maintain per-SKU unit cost (Shopify cost-per-item or the supplements_cogs table). Ad spend pulls from Meta (already wired in CCOS).",
    },
  ];
}

// ── Periods ─────────────────────────────────────────────────────────────────────

export function resolvePeriod(key: PeriodKey, now = new Date()): PeriodInfo {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let start: Date;
  let label: string;
  const end = now;
  switch (key) {
    case "last_30":
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      label = "Last 30 Days";
      break;
    case "this_year":
      start = new Date(Date.UTC(y, 0, 1));
      label = `${y} (Year to Date)`;
      break;
    case "all_time":
      start = new Date(Date.UTC(2020, 0, 1));
      label = "All Time";
      break;
    case "this_month":
    default:
      start = new Date(Date.UTC(y, m, 1));
      label = now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      break;
  }
  return { key, label, start: start.toISOString(), end: end.toISOString() };
}

// ── Metric skeleton ──────────────────────────────────────────────────────────────

const NULL_SPLIT: SplitValue = { supplements: null, coaching: null };
const NULL_SPLIT_NO_COACHING: SplitValue = { supplements: null, coaching: null };

function funnelRow(
  key: string,
  label: string,
  format: FunnelRow["format"],
  source: FunnelRow["source"],
  hint?: string,
): FunnelRow {
  return { key, label, format, source, hint, target: null, total: null, pathA: null, pathB: null };
}

function moneyRow(
  key: string,
  label: string,
  format: MoneyRow["format"],
  source: MoneyRow["source"],
  hint?: string,
): MoneyRow {
  return {
    key,
    label,
    format,
    source,
    hint,
    target: null,
    total: { ...NULL_SPLIT },
    pathA: { ...NULL_SPLIT },
    pathB: { ...NULL_SPLIT_NO_COACHING },
  };
}

/**
 * The complete KPI set from the spec, organized for the dashboard.
 * PHASE 2: each value below is filled by aggregating supplements_* tables over the
 * selected period, sliced by customer_path and product_type.
 */
function buildSections(): MetricSection[] {
  const funnel: MetricSection = {
    key: "funnel",
    title: "Funnel — Nutrition Consult",
    subtitle: "The consult funnel that drives supplement sales, by acquisition path.",
    kind: "funnel",
    rows: [
      funnelRow("calls_booked", "Calls Booked", "count", "ghl", "Nutrition consults booked"),
      funnelRow("booking_rate", "Booking Rate", "percent", "ghl", "Booked ÷ eligible (A: coaching closes · B: comp offers)"),
      funnelRow("calls_showed", "Calls Showed", "count", "ghl", "Consults attended"),
      funnelRow("show_rate", "Show Rate", "percent", "ghl", "Showed ÷ booked"),
      funnelRow("sales_close", "Sales Closed", "count", "shopify", "Supplement sales off a consult"),
      funnelRow("close_rate", "Close Rate", "percent", "shopify", "Closes ÷ showed"),
    ],
  };

  const revenue: MetricSection = {
    key: "revenue",
    title: "Revenue & Cash",
    subtitle: "Supplements and coaching kept separate. Path B has no coaching.",
    kind: "money",
    rows: [
      moneyRow("revenue", "Revenue (Cash Collected)", "money", "shopify"),
      moneyRow("cash_day0", "Cash Collected — Day 0", "money", "shopify", "First-day cash per customer"),
      moneyRow("cash_total", "Cash Collected — Total", "money", "shopify"),
      moneyRow("aov", "AOV", "money", "shopify", "Average order value"),
      moneyRow("mrr", "MRR", "money", "subscriptions", "Monthly recurring revenue"),
      moneyRow("arr", "ARR", "money", "subscriptions", "MRR × 12"),
      moneyRow("ltv", "Customer LTV", "money", "shopify", "Lifetime value per customer"),
    ],
  };

  const efficiency: MetricSection = {
    key: "efficiency",
    title: "Per-Call Economics",
    subtitle: "Cash and LTV normalized by funnel volume — the Hormozi efficiency view.",
    kind: "money",
    rows: [
      moneyRow("cash_per_booked", "Cash / Call Booked", "moneyPerCall", "shopify", "Total cash ÷ calls booked"),
      moneyRow("cash_per_taken", "Cash / Call Taken", "moneyPerCall", "shopify", "Total cash ÷ calls showed"),
      moneyRow("ltv_per_booked", "LTV / Call Booked", "moneyPerCall", "shopify", "Total LTV ÷ calls booked"),
      moneyRow("ltv_per_taken", "LTV / Call Taken", "moneyPerCall", "shopify", "Total LTV ÷ calls showed"),
    ],
  };

  return [funnel, revenue, efficiency];
}

/** The "add later" metrics — need cost data, so they're rendered locked until COGS lands. */
function buildFuture(): MetricSection[] {
  return [
    {
      key: "profit",
      title: "Profit & Gross Profit",
      subtitle: "Unlocks once per-SKU COGS + ad spend are connected.",
      kind: "money",
      rows: [
        moneyRow("profit", "Profit", "money", "cogs"),
        moneyRow("profit_per_booked", "Profit / Call Booked", "moneyPerCall", "cogs"),
        moneyRow("profit_per_taken", "Profit / Call Taken", "moneyPerCall", "cogs"),
        moneyRow("gp_30d", "30-Day Gross Profit", "money", "cogs", "GP collected in first 30 days"),
        moneyRow("ltgp", "Lifetime Gross Profit (LTGP)", "money", "cogs"),
      ],
    },
  ];
}

// ── Public entry ─────────────────────────────────────────────────────────────────

export async function buildSupplementsDashboard(
  periodKey: PeriodKey = "this_month",
): Promise<SupplementsDashboardData> {
  const sources = await buildSources();
  const period = resolvePeriod(periodKey);

  // PHASE 2: when sources are live, fetch events for `period` and fill metric values.
  // The skeleton is returned as-is for now (all nulls) so the UI is fully wired.
  const sections = buildSections();
  const future = buildFuture();

  return {
    generatedAt: new Date().toISOString(),
    period,
    sources,
    sections,
    future,
    anyConnected: sources.some((s) => s.connected),
  };
}
