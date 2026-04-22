// Home page business metrics — the 4 Mozi numbers per client + total.
//
// Cohort source: Google Sheets sales tracker. Each row with cash_collected > 0
// is one new client. This matches the user's mental model of "real coaching
// program sale" and avoids Stripe artifacts (installment rebills, self-serve
// Forge subscribers, payment-link duplicates) that were inflating AOV.
//
// LTGP source: Stripe history. Observed realized lifetime revenue per customer
// minus coaching cost over tenure + fee drag.
//
// CAC source: Meta + Keith Ad Sheet for ad spend; Mercury for acquisition SaaS.

import { CLIENTS } from "@/lib/mock-data";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchAcquisitionCostsBreakdown, type AcquisitionCostsBreakdown } from "@/lib/mozi-acquisition-costs";
import { fetchFulfillmentPayroll, type FulfillmentPayrollBreakdown } from "@/lib/mozi-coach-payroll";
import { fetchSalesCohort, type SalesCohort, fetchSalesCommissions, type CommissionBreakdown } from "@/lib/mozi-sales-commissions";
import { fetchKeithAdSpendLast30d } from "@/lib/mozi-keith-ads";
import type { ClientKey } from "@/lib/mozi-costs-config";

type UiClientKey = ClientKey;
type CardState = "live" | "needs_setup";

interface SettingsRow { key: string; value: unknown; }
interface SyncLogRow {
  source: string;
  status: string;
  records_synced: number;
  error_message: string | null;
  completed_at: string | null;
  started_at: string;
}
interface StripeChargeRow {
  customer_id: string | null;
  customer_email: string | null;
  influencer: string | null;
  amount: number | null;
  refund_amount: number | null;
  status: string | null;            // "succeeded" | "failed" | "pending" | ...
  created_at: string | null;
}

interface MetricValueSet {
  gp30: number | null;          // cents
  cac: number | null;           // cents
  ltgp: number | null;          // cents
  capacityPct: number | null;   // integer percent
}

export interface AcquisitionSoftwareLine {
  label: string;                                  // "SendBlue", "Skool", ...
  perClientCents: number;                         // this client's share in last 30d
  totalCents: number;                             // total 30d spend before split
  splitNote: string;                              // "50/50 split", "100% Keith", etc.
}

export interface ClientBreakdown {
  newClientCount: number;
  aovCents: number;                               // avg cash collected per sale
  cohortRevenueCents: number;                     // sum of cash_collected in window

  // GP30 math
  coachingCostPerNewClientCents: number;          // ~$38
  feeDragPerNewClientCents: number;               // 3.9% × AOV
  setterCommissionsPerNewClientCents: number;     // real per-row average
  closerCommissionsPerNewClientCents: number;     // real per-row average
  directCostsPerNewClientCents: number;
  gp30Cents: number;

  // Drill-down for GP30 coaching cost
  fulfillmentPayrollMonthlyCents: number;         // total Mercury coach+PM+nutrition last 30d
  fulfillmentSoftwareMonthlyCents: number;        // Everfit last 30d
  totalActiveEndClients: number;                  // denominator used to get per-client

  // CAC math
  cacAdSpendCents: number;
  cacMercurySoftwareCents: number;
  cacTotalCents: number;
  cacAdSpendSource: "Meta API" | "Keith Ad Tracker Sheet" | "none";
  cacAcquisitionLines: AcquisitionSoftwareLine[]; // itemized per-client software
  cacManychatPerClientCents: number;

  // LTGP math
  monthlyGpPerActiveClientCents: number;
  ltvPerCustomerCents: number;                    // mean realized lifetime revenue
  ltvMedianCents: number;                         // median lifetime revenue
  ltvCustomerCount: number;                       // how many customers went into mean
  avgTenureMonths: number;                        // avg observed tenure in months

  // Capacity context
  activeClients: number;
}

export interface HomeBusinessMetricsCard {
  key: "total" | UiClientKey;
  label: string;
  state: CardState;
  metrics: MetricValueSet;
  notes: string[];
  breakdown?: ClientBreakdown;
}

export interface HomeBusinessMetricsResponse {
  cards: HomeBusinessMetricsCard[];
  syncedAt: string | null;
  missingSetup: string[];
  sourceStatus: SyncLogRow[];
  report?: {
    window: { start: string; end: string };
    salesCohort: SalesCohort;
    acquisitionBreakdown: AcquisitionCostsBreakdown;
    payrollBreakdown: FulfillmentPayrollBreakdown;
    commissions: CommissionBreakdown;
  };
}

function getClientConfig() {
  return [
    {
      key: "keith" as ClientKey,
      label: CLIENTS.keith.name,
      revenueReady: Boolean(process.env.STRIPE_KEY_KEITH),
      adSpendReady: Boolean(process.env.GOOGLE_SHEETS_API_KEY),
    },
    {
      key: "tyson" as ClientKey,
      label: CLIENTS.tyson.name,
      revenueReady: Boolean(process.env.STRIPE_KEY_TYSON_LLP || process.env.STRIPE_KEY_TYSON_SUBS),
      adSpendReady: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_TYSON),
    },
  ];
}

function emptyMetrics(): MetricValueSet {
  return { gp30: null, cac: null, ltgp: null, capacityPct: null };
}

function buildMissingSetup(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("Supabase server access");
  if (!process.env.GOOGLE_SHEETS_API_KEY || !process.env.GOOGLE_SHEETS_SPREADSHEET_ID) missing.push("Sales tracker Google Sheets access");
  if (!process.env.MERCURY_TOKEN_CORESHIFT || !process.env.MERCURY_TOKEN_FORGE) missing.push("Mercury access (acquisition SaaS + coach payroll)");
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_TYSON) missing.push("Tyson Meta ad account access");
  return missing;
}

function latestSyncStatus(rows: SyncLogRow[]): SyncLogRow[] {
  const seen = new Set<string>();
  const latest: SyncLogRow[] = [];
  for (const row of rows) {
    if (!seen.has(row.source)) {
      seen.add(row.source);
      latest.push(row);
    }
  }
  return latest;
}

async function loadAllCharges(): Promise<StripeChargeRow[]> {
  const sb = getServiceSupabase();
  const charges: StripeChargeRow[] = [];
  let pageStart = 0;
  while (true) {
    const { data, error } = await sb
      .from("mozi_stripe_charges")
      .select("customer_id, customer_email, influencer, amount, refund_amount, status, created_at")
      .eq("status", "succeeded")                // ignore failed / pending — only real collected revenue
      .order("created_at", { ascending: true })
      .range(pageStart, pageStart + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    charges.push(...(data as StripeChargeRow[]));
    if (data.length < 1000) break;
    pageStart += 1000;
  }
  return charges;
}

// Stripe-side: observed mean lifetime revenue per customer, minus direct costs.
// Used for LTGP only. The cohort/AOV math uses the sales tracker.
function computeLtgp(
  charges: StripeChargeRow[],
  clientKey: ClientKey | "total",
  perEndClientCoachingMonthly: number,
  paymentFeePct: number,
  chargebackPct: number,
): {
  ltgpCents: number;
  ltvCents: number;
  ltvMedianCents: number;
  ltvCount: number;
  avgTenureMonths: number;
  monthlyGpPerActiveCents: number;
} {
  const nowMs = Date.now();
  const byCust = new Map<string, { firstAt: number; totalCents: number }>();
  for (const c of charges) {
    const infl = (c.influencer || "").toLowerCase();
    if (clientKey !== "total" && infl !== clientKey) continue;
    const key = c.customer_id || (c.customer_email ? c.customer_email.toLowerCase() : null);
    if (!key) continue;
    const gross = (c.amount ?? 0) - (c.refund_amount ?? 0);
    if (gross <= 0) continue;
    const createdMs = c.created_at ? new Date(c.created_at).getTime() : nowMs;
    const existing = byCust.get(key);
    if (existing) {
      existing.totalCents += gross;
      if (createdMs < existing.firstAt) existing.firstAt = createdMs;
    } else {
      byCust.set(key, { firstAt: createdMs, totalCents: gross });
    }
  }

  const perCustomerTotals: number[] = [];
  let revenueSum = 0;
  let tenureMonthsSum = 0;
  for (const cust of byCust.values()) {
    if (cust.totalCents < 20000) continue;            // $200 floor (ignore micro-buys)
    perCustomerTotals.push(cust.totalCents);
    revenueSum += cust.totalCents;
    tenureMonthsSum += Math.max(0.5, (nowMs - cust.firstAt) / (1000 * 60 * 60 * 24 * 30));
  }
  const count = perCustomerTotals.length;
  const ltv = count > 0 ? Math.round(revenueSum / count) : 0;
  const tenureMonths = count > 0 ? tenureMonthsSum / count : 0;
  perCustomerTotals.sort((a, b) => a - b);
  const median = count > 0
    ? (count % 2 === 1
        ? perCustomerTotals[(count - 1) / 2]
        : Math.round((perCustomerTotals[count / 2 - 1] + perCustomerTotals[count / 2]) / 2))
    : 0;
  const feeDrag = Math.round(ltv * ((paymentFeePct + chargebackPct) / 100));
  const coachingOverTenure = Math.round(perEndClientCoachingMonthly * tenureMonths);
  const ltgp = Math.max(0, ltv - feeDrag - coachingOverTenure);
  const monthlyGpPerActive = tenureMonths > 0
    ? Math.round((ltv - feeDrag) / tenureMonths) - perEndClientCoachingMonthly
    : 0;
  return {
    ltgpCents: ltgp,
    ltvCents: ltv,
    ltvMedianCents: median,
    ltvCount: count,
    avgTenureMonths: tenureMonths,
    monthlyGpPerActiveCents: monthlyGpPerActive,
  };
}

export async function getHomeBusinessMetrics(): Promise<HomeBusinessMetricsResponse> {
  const missingSetup = buildMissingSetup();

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      cards: [
        { key: "total", label: "Total", state: "needs_setup", metrics: emptyMetrics(), notes: ["Supabase is not connected yet."] },
        ...getClientConfig().map((c) => ({ key: c.key, label: c.label, state: "needs_setup" as const, metrics: emptyMetrics(), notes: ["This client is not connected yet."] })),
      ],
      syncedAt: null,
      missingSetup,
      sourceStatus: [],
    };
  }

  const sb = getServiceSupabase();
  const thirtyDaysAgoYmd = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const nowYmd = new Date().toISOString().slice(0, 10);

  const [
    allCharges,
    adSpendRes,
    clientsRes,
    settingsRes,
    syncLogRes,
    acquisitionBreakdown,
    payrollBreakdown,
    salesCohort,
    commissionsResult,
    keithAdSpendSheet,
  ] = await Promise.all([
    loadAllCharges(),
    sb.from("mozi_meta_ad_spend").select("influencer, spend, date").gte("date", thirtyDaysAgoYmd),
    sb.from("clients").select("offer, status, start_date, end_date"),
    sb.from("mozi_settings").select("key, value"),
    sb.from("mozi_sync_log").select("source, status, records_synced, error_message, completed_at, started_at").order("started_at", { ascending: false }).limit(20),
    fetchAcquisitionCostsBreakdown().catch((e) => { console.error("[mozi] acquisition failed:", e); return null; }),
    fetchFulfillmentPayroll().catch((e) => { console.error("[mozi] payroll failed:", e); return null; }),
    fetchSalesCohort({ dateFrom: thirtyDaysAgoYmd, dateTo: nowYmd }).catch((e) => { console.error("[mozi] sales cohort failed:", e); return null; }),
    fetchSalesCommissions({ dateFrom: thirtyDaysAgoYmd, dateTo: nowYmd }).catch((e) => { console.error("[mozi] commissions failed:", e); return null; }),
    fetchKeithAdSpendLast30d().catch((e) => { console.error("[mozi] Keith ad sheet failed:", e); return null; }),
  ]);

  if (adSpendRes.error) throw adSpendRes.error;
  if (clientsRes.error) throw clientsRes.error;
  if (settingsRes.error) throw settingsRes.error;
  if (syncLogRes.error) throw syncLogRes.error;

  const syncStatuses = latestSyncStatus((syncLogRes.data ?? []) as SyncLogRow[]);
  const settingsMap = Object.fromEntries(
    ((settingsRes.data ?? []) as SettingsRow[]).map((r) => [r.key, r.value]),
  ) as Record<string, unknown>;
  const costs = (settingsMap.costs ?? {}) as Record<string, number>;
  const paymentFeePct = costs.payment_fee_pct ?? 2.9;
  const chargebackPct = costs.chargeback_rate_pct ?? 1;

  // Active clients per influencer
  const activeByClient: Record<ClientKey, number> = { keith: 0, tyson: 0 };
  let totalActive = 0;
  for (const row of (clientsRes.data ?? []) as Array<{ offer: string | null; status: string | null }>) {
    const offer = (row.offer || "").toLowerCase();
    const influencer: ClientKey | null = offer.includes("keith") ? "keith" : offer.includes("tyson") ? "tyson" : null;
    if (!influencer) continue;
    if ((row.status || "").toLowerCase() === "active") {
      activeByClient[influencer]++;
      totalActive++;
    }
  }

  // Ad spend per client
  const adSpendByClient: Record<ClientKey, number> = { keith: 0, tyson: 0 };
  for (const r of (adSpendRes.data ?? []) as Array<{ influencer: string; spend: number | null }>) {
    if (r.influencer === "keith") adSpendByClient.keith += r.spend ?? 0;
    if (r.influencer === "tyson") adSpendByClient.tyson += r.spend ?? 0;
  }
  if (keithAdSpendSheet && keithAdSpendSheet.totalCents > 0) {
    adSpendByClient.keith = Math.max(adSpendByClient.keith, keithAdSpendSheet.totalCents);
  }

  // Mercury acquisition per client (SaaS + ManyChat)
  const mercuryAcquisitionByClient: Record<ClientKey, number> = { keith: 0, tyson: 0 };
  if (acquisitionBreakdown) {
    mercuryAcquisitionByClient.keith = acquisitionBreakdown.acquisitionTotalPerClient.keith + acquisitionBreakdown.manychatPerClient.keith;
    mercuryAcquisitionByClient.tyson = acquisitionBreakdown.acquisitionTotalPerClient.tyson + acquisitionBreakdown.manychatPerClient.tyson;
  }

  // Per-end-client coaching+software cost per month (month 1 share for GP30).
  const perEndClientCoachingMonthly =
    totalActive > 0
      ? Math.round(
          ((payrollBreakdown?.totalCents ?? 0) + (acquisitionBreakdown?.fulfillmentSoftwareCents ?? 0)) /
            totalActive,
        )
      : 0;

  function buildCard(clientKey: ClientKey | "total", opts?: { label?: string; ready?: { revenue: boolean; adSpend: boolean } }): HomeBusinessMetricsCard {
    const cohort = salesCohort
      ? clientKey === "total"
        ? {
            count: salesCohort.total.count,
            cashCollectedCents: salesCohort.total.cashCollectedCents,
            setterCommissionsCents: salesCohort.perClient.keith.setterCommissionsCents + salesCohort.perClient.tyson.setterCommissionsCents,
            closerCommissionsCents: salesCohort.perClient.keith.closerCommissionsCents + salesCohort.perClient.tyson.closerCommissionsCents,
          }
        : {
            count: salesCohort.perClient[clientKey].count,
            cashCollectedCents: salesCohort.perClient[clientKey].cashCollectedCents,
            setterCommissionsCents: salesCohort.perClient[clientKey].setterCommissionsCents,
            closerCommissionsCents: salesCohort.perClient[clientKey].closerCommissionsCents,
          }
      : { count: 0, cashCollectedCents: 0, setterCommissionsCents: 0, closerCommissionsCents: 0 };

    const aov = cohort.count > 0 ? Math.round(cohort.cashCollectedCents / cohort.count) : 0;

    // Direct costs per new client
    const feeDragPct = (paymentFeePct + chargebackPct) / 100;
    const feeDragPerClient = Math.round(aov * feeDragPct);
    const setterComm = cohort.count > 0 ? Math.round(cohort.setterCommissionsCents / cohort.count) : 0;
    const closerComm = cohort.count > 0 ? Math.round(cohort.closerCommissionsCents / cohort.count) : 0;
    const directCosts = perEndClientCoachingMonthly + feeDragPerClient + setterComm + closerComm;
    const gp30 = aov - directCosts;

    // CAC
    const adSpend = clientKey === "total" ? adSpendByClient.keith + adSpendByClient.tyson : adSpendByClient[clientKey];
    const mercuryAcq = clientKey === "total" ? mercuryAcquisitionByClient.keith + mercuryAcquisitionByClient.tyson : mercuryAcquisitionByClient[clientKey];
    const cacTotal = adSpend + mercuryAcq;
    const cacPerClient = cohort.count > 0 ? Math.round(cacTotal / cohort.count) : 0;

    // LTGP from Stripe observation
    const ltgpOut = computeLtgp(
      allCharges,
      clientKey,
      perEndClientCoachingMonthly,
      paymentFeePct,
      chargebackPct,
    );
    const { ltgpCents, ltvCents, ltvMedianCents, ltvCount, avgTenureMonths, monthlyGpPerActiveCents } = ltgpOut;

    const activeClients = clientKey === "total" ? totalActive : activeByClient[clientKey];

    // Itemized CAC acquisition-software lines for this client
    const cacAcquisitionLines: AcquisitionSoftwareLine[] = [];
    if (acquisitionBreakdown) {
      for (const line of acquisitionBreakdown.acquisitionByLabel) {
        const perClient = clientKey === "total"
          ? line.totalCents
          : (line.perClientCents[clientKey] ?? 0);
        if (perClient <= 0) continue;
        const splitNote = (line.perClientCents.keith > 0 && line.perClientCents.tyson > 0)
          ? "50/50 split"
          : line.perClientCents.keith > 0 ? "100% Keith" : "100% Tyson";
        cacAcquisitionLines.push({
          label: line.label,
          perClientCents: perClient,
          totalCents: line.totalCents,
          splitNote,
        });
      }
    }
    const manychatPerClient = acquisitionBreakdown
      ? (clientKey === "total"
          ? acquisitionBreakdown.manychatPerClient.keith + acquisitionBreakdown.manychatPerClient.tyson
          : acquisitionBreakdown.manychatPerClient[clientKey])
      : 0;
    if (manychatPerClient > 0) {
      cacAcquisitionLines.push({
        label: "ManyChat",
        perClientCents: manychatPerClient,
        totalCents: manychatPerClient,
        splitNote: clientKey === "total" ? "Keith + Tyson" : `100% ${clientKey === "keith" ? "Keith" : "Tyson"}`,
      });
    }

    const cacAdSpendSource: "Meta API" | "Keith Ad Tracker Sheet" | "none" =
      clientKey === "keith" && keithAdSpendSheet && keithAdSpendSheet.totalCents > 0
        ? "Keith Ad Tracker Sheet"
        : adSpend > 0 ? "Meta API" : "none";

    const label = opts?.label ?? (clientKey === "total" ? "Total" : CLIENTS[clientKey].name);
    const notes: string[] = [];
    if (opts?.ready && !opts.ready.revenue) notes.push("Stripe not connected.");
    if (opts?.ready && !opts.ready.adSpend) notes.push("Ad source not connected — CAC excludes ads.");
    if (cohort.count === 0) notes.push("No sales in the last 30 days on the sales tracker.");
    if (clientKey !== "total") notes.push("Capacity shown on Total card only.");
    if (clientKey === "total") notes.push("Coach safe-max still needed from PM — capacity unknown.");

    const state: CardState = cohort.count > 0 ? "live" : "needs_setup";

    return {
      key: clientKey,
      label,
      state,
      metrics: {
        gp30: cohort.count > 0 ? gp30 : null,
        cac: cohort.count > 0 ? cacPerClient : null,
        ltgp: ltgpCents > 0 ? ltgpCents : null,
        capacityPct: null, // pending coach safe-max
      },
      notes,
      breakdown: {
        newClientCount: cohort.count,
        aovCents: aov,
        cohortRevenueCents: cohort.cashCollectedCents,

        coachingCostPerNewClientCents: perEndClientCoachingMonthly,
        feeDragPerNewClientCents: feeDragPerClient,
        setterCommissionsPerNewClientCents: setterComm,
        closerCommissionsPerNewClientCents: closerComm,
        directCostsPerNewClientCents: directCosts,
        gp30Cents: gp30,

        fulfillmentPayrollMonthlyCents: payrollBreakdown?.totalCents ?? 0,
        fulfillmentSoftwareMonthlyCents: acquisitionBreakdown?.fulfillmentSoftwareCents ?? 0,
        totalActiveEndClients: totalActive,

        cacAdSpendCents: adSpend,
        cacMercurySoftwareCents: mercuryAcq,
        cacTotalCents: cacTotal,
        cacAdSpendSource,
        cacAcquisitionLines,
        cacManychatPerClientCents: manychatPerClient,

        monthlyGpPerActiveClientCents: monthlyGpPerActiveCents,
        ltvPerCustomerCents: ltvCents,
        ltvMedianCents,
        ltvCustomerCount: ltvCount,
        avgTenureMonths,

        activeClients,
      },
    };
  }

  const clientConfig = getClientConfig();
  const keithCard = buildCard("keith", { ready: { revenue: clientConfig[0].revenueReady, adSpend: clientConfig[0].adSpendReady } });
  const tysonCard = buildCard("tyson", { ready: { revenue: clientConfig[1].revenueReady, adSpend: clientConfig[1].adSpendReady } });
  const totalCard = buildCard("total");

  const syncedAt =
    syncStatuses
      .map((row) => row.completed_at ?? row.started_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

  return {
    cards: [totalCard, keithCard, tysonCard],
    syncedAt,
    missingSetup,
    sourceStatus: syncStatuses,
    report:
      acquisitionBreakdown && payrollBreakdown && salesCohort && commissionsResult
        ? {
            window: { start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), end: new Date().toISOString() },
            salesCohort,
            acquisitionBreakdown,
            payrollBreakdown,
            commissions: commissionsResult,
          }
        : undefined,
  };
}
