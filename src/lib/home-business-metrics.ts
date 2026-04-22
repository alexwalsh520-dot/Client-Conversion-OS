import { CLIENTS } from "@/lib/mock-data";
import { getServiceSupabase } from "@/lib/supabase";
import { runCohortEngine, type ClientCohortResult } from "@/lib/mozi-cohort-engine";
import { fetchAcquisitionCostsBreakdown, type AcquisitionCostsBreakdown } from "@/lib/mozi-acquisition-costs";
import { fetchFulfillmentPayroll, type FulfillmentPayrollBreakdown } from "@/lib/mozi-coach-payroll";
import { fetchSalesCommissions, type CommissionBreakdown } from "@/lib/mozi-sales-commissions";
import { fetchKeithAdSpendLast30d } from "@/lib/mozi-keith-ads";
import type { ClientKey } from "@/lib/mozi-costs-config";

type LiveClientKey = ClientKey;                    // "keith" | "tyson"
type UiClientKey = LiveClientKey;
type CardState = "live" | "needs_setup";

interface SettingsRow {
  key: string;
  value: unknown;
}

interface StripeChargeRow {
  customer_id: string | null;
  customer_email: string | null;
  influencer: string | null;
  amount: number | null;
  refund_amount: number | null;
  created_at: string | null;
}

interface SyncLogRow {
  source: string;
  status: string;
  records_synced: number;
  error_message: string | null;
  completed_at: string | null;
  started_at: string;
}

interface MetricValueSet {
  gp30: number | null;          // cents
  cac: number | null;           // cents
  ltgp: number | null;          // cents
  capacityPct: number | null;   // integer percent
}

export interface ClientBreakdown {
  newClientCount: number;
  cohortRevenueCents: number;
  directCostsPerNewClientCents: number;
  gp30Cents: number;
  cacAdSpendCents: number;
  cacMercurySoftwareCents: number;
  cacSalesCommissionsCents: number;
  cacTotalCents: number;
  monthlyGpPerActiveClientCents: number;
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
    avgProgramMonths: number;
    acquisitionBreakdown: AcquisitionCostsBreakdown;
    payrollBreakdown: FulfillmentPayrollBreakdown;
    commissions: CommissionBreakdown;
  };
}

// Evaluated at call time so env vars loaded late (e.g. dotenv in test scripts)
// still drive the readiness flags correctly.
function getClientConfig(): Array<{
  key: UiClientKey;
  label: string;
  revenueReady: boolean;
  adSpendReady: boolean;
}> {
  return [
    {
      key: "keith",
      label: CLIENTS.keith.name,
      revenueReady: Boolean(process.env.STRIPE_KEY_KEITH),
      adSpendReady: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_KEITH),
    },
    {
      key: "tyson",
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
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push("Supabase server access");
  }
  if (!process.env.STRIPE_KEY_KEITH) missing.push("Keith Stripe access");
  if (!process.env.STRIPE_KEY_TYSON_LLP && !process.env.STRIPE_KEY_TYSON_SUBS) {
    missing.push("Tyson Stripe access");
  }
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_KEITH) {
    missing.push("Keith Meta ad account access");
  }
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_TYSON) {
    missing.push("Tyson Meta ad account access");
  }
  if (!process.env.MERCURY_TOKEN_CORESHIFT || !process.env.MERCURY_TOKEN_FORGE) {
    missing.push("Mercury access (for acquisition SaaS + coach payroll)");
  }
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
      .select("customer_id, customer_email, influencer, amount, refund_amount, created_at")
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

function resultToBreakdown(r: ClientCohortResult, activeClients: number): ClientBreakdown {
  return {
    newClientCount: r.newClientCount,
    cohortRevenueCents: r.cohortRevenueCents,
    directCostsPerNewClientCents: r.directCostsPerNewClientCents,
    gp30Cents: r.gp30Cents,
    cacAdSpendCents: r.cacAdSpendCents,
    cacMercurySoftwareCents: r.cacMercurySoftwareCents,
    cacSalesCommissionsCents: r.cacSalesCommissionsCents,
    cacTotalCents: r.cacTotalCents,
    monthlyGpPerActiveClientCents: r.monthlyGpPerActiveClientCents,
    activeClients,
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

  // Parallel pulls
  const [
    allCharges,
    adSpendRes,
    clientsRes,
    settingsRes,
    syncLogRes,
    acquisitionBreakdown,
    payrollBreakdown,
    commissionsResult,
    keithAdSpendSheet,
  ] = await Promise.all([
    loadAllCharges(),
    sb.from("mozi_meta_ad_spend").select("influencer, spend, date").gte("date", thirtyDaysAgoYmd),
    sb.from("clients").select("offer, status, start_date, end_date"),
    sb.from("mozi_settings").select("key, value"),
    sb.from("mozi_sync_log").select("source, status, records_synced, error_message, completed_at, started_at").order("started_at", { ascending: false }).limit(20),
    fetchAcquisitionCostsBreakdown().catch((e) => {
      console.error("[mozi] acquisition breakdown failed:", e);
      return null;
    }),
    fetchFulfillmentPayroll().catch((e) => {
      console.error("[mozi] payroll breakdown failed:", e);
      return null;
    }),
    fetchSalesCommissions().catch((e) => {
      console.error("[mozi] sales commissions failed:", e);
      return null;
    }),
    fetchKeithAdSpendLast30d().catch((e) => {
      console.error("[mozi] Keith ad sheet failed:", e);
      return null;
    }),
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

  // Active clients + avg program months
  const activeByClient: Record<ClientKey, number> = { keith: 0, tyson: 0 };
  let totalActive = 0;
  const durations: number[] = [];
  for (const row of (clientsRes.data ?? []) as Array<{ offer: string | null; status: string | null; start_date: string | null; end_date: string | null }>) {
    const offer = (row.offer || "").toLowerCase();
    const influencer: ClientKey | null = offer.includes("keith") ? "keith" : offer.includes("tyson") ? "tyson" : null;
    if (!influencer) continue;
    if ((row.status || "").toLowerCase() === "active") {
      activeByClient[influencer]++;
      totalActive++;
    }
    if (row.start_date) {
      const start = new Date(row.start_date);
      const end = row.end_date ? new Date(row.end_date) : new Date();
      const months = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (months > 0.5 && months < 60) durations.push(months);
    }
  }
  const avgProgramMonths = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 3;

  // Ad spend per client. Tyson comes from Meta API (mozi_meta_ad_spend table).
  // Keith comes from the ad-tracker Google Sheet (Meta token for Keith's
  // ad account isn't provisioned yet, so we fall back to the sheet).
  const metaAdSpendByClient: Record<ClientKey, number> = { keith: 0, tyson: 0 };
  for (const r of (adSpendRes.data ?? []) as Array<{ influencer: string; spend: number | null }>) {
    if (r.influencer === "keith") metaAdSpendByClient.keith += r.spend ?? 0;
    if (r.influencer === "tyson") metaAdSpendByClient.tyson += r.spend ?? 0;
  }
  if (keithAdSpendSheet && keithAdSpendSheet.totalCents > 0) {
    // If Meta API already populated Keith, prefer the larger value (defensive).
    metaAdSpendByClient.keith = Math.max(metaAdSpendByClient.keith, keithAdSpendSheet.totalCents);
  }

  // Mercury acquisition per client
  const mercuryAcquisitionByClient: Record<ClientKey, number> = { keith: 0, tyson: 0 };
  if (acquisitionBreakdown) {
    mercuryAcquisitionByClient.keith =
      acquisitionBreakdown.acquisitionTotalPerClient.keith + acquisitionBreakdown.manychatPerClient.keith;
    mercuryAcquisitionByClient.tyson =
      acquisitionBreakdown.acquisitionTotalPerClient.tyson + acquisitionBreakdown.manychatPerClient.tyson;
  }

  // Commissions per client
  const salesCommissionsByClient: Record<ClientKey, number> = { keith: 0, tyson: 0 };
  if (commissionsResult) {
    salesCommissionsByClient.keith = commissionsResult.perClient.keith.totalCents;
    salesCommissionsByClient.tyson = commissionsResult.perClient.tyson.totalCents;
  }

  // Run engine
  const engineResult = runCohortEngine({
    allCharges: allCharges.map((c) => ({
      customer_id: c.customer_id,
      customer_email: c.customer_email,
      influencer: c.influencer,
      amount: c.amount ?? 0,
      refund_amount: c.refund_amount ?? 0,
      created_at: c.created_at ?? new Date().toISOString(),
    })),
    activeClientsByInfluencer: activeByClient,
    totalActiveClients: totalActive,
    fulfillmentPayrollMonthlyCents: payrollBreakdown?.totalCents ?? 0,
    fulfillmentSoftwareMonthlyCents: acquisitionBreakdown?.fulfillmentSoftwareCents ?? 0,
    paymentFeePct: costs.payment_fee_pct ?? 2.9,
    chargebackPct: costs.chargeback_rate_pct ?? 1,
    refundPct: costs.refund_rate_pct ?? 5,
    metaAdSpendByClient,
    mercuryAcquisitionByClient,
    salesCommissionsByClient,
    avgProgramMonths,
    totalMaxClientSeats: 0,    // wait on coach safe-max from PM
  });

  const clientConfig = getClientConfig();

  // Build cards
  function clientCard(key: ClientKey, cfg: ReturnType<typeof getClientConfig>[number]): HomeBusinessMetricsCard {
    const r = engineResult.perClient[key];
    const notes: string[] = [];
    if (!cfg.revenueReady) notes.push("Stripe not connected.");
    // Keith's ads come from the Google Sheet tracker when Meta isn't wired.
    const adSourceNote = !cfg.adSpendReady && r.cacAdSpendCents === 0 ? "Meta ad account not connected — CAC excludes ads." : null;
    if (adSourceNote) notes.push(adSourceNote);
    if (r.newClientCount === 0) notes.push("No new clients detected in the last 30 days.");
    notes.push("Capacity shown on Total card only.");
    return {
      key,
      label: cfg.label,
      state: r.newClientCount > 0 || r.cacTotalCents > 0 ? "live" : "needs_setup",
      metrics: {
        gp30: r.newClientCount > 0 ? r.gp30Cents : null,
        cac: r.newClientCount > 0 ? r.cacPerNewClientCents : null,
        ltgp: r.ltgpCents > 0 ? r.ltgpCents : null,
        capacityPct: null,
      },
      notes,
      breakdown: resultToBreakdown(r, activeByClient[key]),
    };
  }

  const keithCard = clientCard("keith", clientConfig[0]);
  const tysonCard = clientCard("tyson", clientConfig[1]);

  const totalNotes: string[] = [];
  if (engineResult.total.newClientCount === 0) totalNotes.push("No new clients detected in last 30 days.");
  if (engineResult.total.capacity === undefined) totalNotes.push("Coach safe-max still needed from PM — capacity unknown.");

  const totalCard: HomeBusinessMetricsCard = {
    key: "total",
    label: "Total",
    state: engineResult.total.newClientCount > 0 ? "live" : "needs_setup",
    metrics: {
      gp30: engineResult.total.newClientCount > 0 ? engineResult.total.gp30Cents : null,
      cac: engineResult.total.newClientCount > 0 ? engineResult.total.cacPerNewClientCents : null,
      ltgp: engineResult.total.ltgpCents > 0 ? engineResult.total.ltgpCents : null,
      capacityPct: engineResult.total.capacity?.pct ?? null,
    },
    notes: totalNotes,
    breakdown: resultToBreakdown(engineResult.total, totalActive),
  };

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
      acquisitionBreakdown && payrollBreakdown && commissionsResult
        ? {
            window: { start: engineResult.windowStart, end: engineResult.windowEnd },
            avgProgramMonths,
            acquisitionBreakdown,
            payrollBreakdown,
            commissions: commissionsResult,
          }
        : undefined,
  };
}
