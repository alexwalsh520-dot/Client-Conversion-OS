import "server-only";

import type {
  BillingPeriod,
  ClientPeriodPlan,
  ClientProfitRow,
  CoachingBudgetSnapshot,
  CurrentPeriodFinance,
  FinanceLegendItem,
  FinanceOverview,
  FinanceRecommendation,
  UpcomingPayoutRow,
  UpcomingPayoutsSummary,
} from "@/lib/accountant-types";
import { SOURCE_ACCOUNT } from "@/lib/accountant-data";
import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
import {
  CLOSER_COMMISSION_PCT,
  FULFILLMENT_PAYROLL_MATCHES,
  SETTER_COMMISSION_RULES,
} from "@/lib/mozi-costs-config";
import { fetchKeithAdSpendRange } from "@/lib/mozi-keith-ads";
import { getServiceSupabase } from "@/lib/supabase";

interface FinanceClientConfig {
  key: string;
  name: string;
  offerMatches: string[];
  paymentInfluencer: string | null;
}

interface AccountantSettings {
  sales_team_invoice_pct: number;
  coaching_line_per_program_month_cents: number;
  coaching_target_per_active_client_cents: number;
  coaching_hard_cap_per_active_client_cents: number;
  product_manager_base_monthly_cents: number;
  software_monthly_cents: number;
}

interface MoziCostSettings {
  payment_fee_pct: number;
}

interface ManualClientPeriodRow {
  client_key: string;
  client_name: string;
  period_start: string;
  period_end: string;
  status: string | null;
  cash_collected_cents: number | null;
  net_cash_cents: number | null;
  ad_spend_cents: number | null;
  sales_team_line_cents: number | null;
  program_months_sold: number | null;
  coaching_line_cents: number | null;
  coaching_reserve_cents: number | null;
  forecast_fulfillment_cents: number | null;
  software_fee_cents: number | null;
  profit_share_cents: number | null;
  invoice_total_cents: number | null;
  notes: string | null;
}

interface ManualObligationRow {
  label: string;
  obligation_type: string;
  payee_name: string | null;
  client_name: string | null;
  due_date: string;
  amount_cents: number;
  status: string | null;
  notes: string | null;
}

interface PeriodPaymentTotals {
  gross: number;
  refunds: number;
  estimatedNet: number;
}

const CLIENTS: FinanceClientConfig[] = [
  {
    key: "keith",
    name: "Keith Holland",
    offerMatches: ["keith"],
    paymentInfluencer: "keith",
  },
  {
    key: "tyson",
    name: "Tyson Sonnek",
    offerMatches: ["tyson", "sonnek"],
    paymentInfluencer: "tyson",
  },
];

const DEFAULT_SETTINGS: AccountantSettings = {
  sales_team_invoice_pct: 15,
  coaching_line_per_program_month_cents: 3000,
  coaching_target_per_active_client_cents: 2400,
  coaching_hard_cap_per_active_client_cents: 2100,
  product_manager_base_monthly_cents: 400000,
  software_monthly_cents: 150000,
};

const DEFAULT_MOZI_COSTS: MoziCostSettings = {
  payment_fee_pct: 2.9,
};

const PM_MATCHES = ["muhammad ahmad saeed"];

function startOfUtcDay(ymd: string): string {
  return `${ymd}T00:00:00.000Z`;
}

function endOfUtcDay(ymd: string): string {
  return `${ymd}T23:59:59.999Z`;
}

function ymdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateFromYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function addUtcDays(ymd: string, days: number): string {
  const date = dateFromYmd(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return ymdUtc(date);
}

function firstOfNextMonth(date: Date): string {
  return ymdUtc(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)));
}

function fifteenthOfNextMonth(date: Date): string {
  return ymdUtc(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 15)));
}

function setterDueDate(saleYmd: string): string {
  return firstOfNextMonth(dateFromYmd(saleYmd));
}

function closerDueDate(saleYmd: string): string {
  const date = dateFromYmd(saleYmd);
  return date.getUTCDate() <= 14 ? firstOfNextMonth(date) : fifteenthOfNextMonth(date);
}

function formatRangeLabel(start: string, end: string): string {
  const startDate = dateFromYmd(start);
  const endDate = dateFromYmd(end);
  const sameMonth = startDate.getUTCMonth() === endDate.getUTCMonth();
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();

  const startLabel = startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endLabel = endDate.toLocaleDateString("en-US", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  });
  const yearLabel = endDate.toLocaleDateString("en-US", {
    year: "numeric",
    timeZone: "UTC",
  });

  return `${startLabel} - ${endLabel}, ${yearLabel}`;
}

function getCurrentBillingPeriod(now: Date = new Date()): BillingPeriod {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  if (day <= 14) {
    const start = ymdUtc(new Date(Date.UTC(year, month, 1)));
    const end = ymdUtc(new Date(Date.UTC(year, month, 14)));
    const billingDate = ymdUtc(new Date(Date.UTC(year, month, 15)));
    return {
      start,
      end,
      billing_date: billingDate,
      kind: "first_half",
      label: formatRangeLabel(start, end),
    };
  }

  const start = ymdUtc(new Date(Date.UTC(year, month, 15)));
  const end = ymdUtc(new Date(Date.UTC(year, month, monthEnd)));
  const billingDate = ymdUtc(new Date(Date.UTC(year, month + 1, 1)));
  return {
    start,
    end,
    billing_date: billingDate,
    kind: "second_half",
    label: formatRangeLabel(start, end),
  };
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function offerToClientKey(offer: string | null | undefined): string | null {
  const haystack = (offer ?? "").toLowerCase();
  for (const client of CLIENTS) {
    if (client.offerMatches.some((part) => haystack.includes(part))) return client.key;
  }
  return null;
}

function clientNameForKey(clientKey: string, fallback?: string | null): string {
  const client = CLIENTS.find((item) => item.key === clientKey);
  return client?.name ?? fallback ?? clientKey;
}

function setterRateFor(name: string | null | undefined): number {
  const lower = (name ?? "").toLowerCase();
  for (const rule of SETTER_COMMISSION_RULES) {
    if (lower.includes(rule.match)) return rule.ratePct;
  }
  return 0;
}

function parseProgramMonths(programLength: string | null | undefined): number {
  const match = (programLength ?? "").match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function roundPct(value: number, pct: number): number {
  return Math.round((value * pct) / 100);
}

function sumBy<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((sum, item) => sum + selector(item), 0);
}

function pushMoneyNote(notes: string[], condition: boolean, message: string) {
  if (condition && !notes.includes(message)) notes.push(message);
}

async function loadAccountantSettings(): Promise<AccountantSettings> {
  const sb = getServiceSupabase();
  const settings = { ...DEFAULT_SETTINGS };

  try {
    const { data, error } = await sb.from("accountant_settings").select("key, value");
    if (error) throw error;

    for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
      const value = row.value;
      if (row.key === "sales_team_invoice_pct") {
        settings.sales_team_invoice_pct = toNumber(value, settings.sales_team_invoice_pct);
      }
      if (row.key === "coaching_line_per_program_month_cents") {
        settings.coaching_line_per_program_month_cents = toNumber(
          value,
          settings.coaching_line_per_program_month_cents,
        );
      }
      if (row.key === "coaching_target_per_active_client_cents") {
        settings.coaching_target_per_active_client_cents = toNumber(
          value,
          settings.coaching_target_per_active_client_cents,
        );
      }
      if (row.key === "coaching_hard_cap_per_active_client_cents") {
        settings.coaching_hard_cap_per_active_client_cents = toNumber(
          value,
          settings.coaching_hard_cap_per_active_client_cents,
        );
      }
      if (row.key === "product_manager_base_monthly_cents") {
        settings.product_manager_base_monthly_cents = toNumber(
          value,
          settings.product_manager_base_monthly_cents,
        );
      }
      if (row.key === "software_monthly_cents") {
        settings.software_monthly_cents = toNumber(value, settings.software_monthly_cents);
      }
    }
  } catch {
    return settings;
  }

  return settings;
}

async function loadMoziCostSettings(): Promise<MoziCostSettings> {
  const sb = getServiceSupabase();
  try {
    const { data, error } = await sb
      .from("mozi_settings")
      .select("key, value")
      .eq("key", "costs")
      .maybeSingle();
    if (error) throw error;
    const value = (data?.value ?? {}) as Record<string, unknown>;
    return {
      payment_fee_pct: toNumber(value.payment_fee_pct, DEFAULT_MOZI_COSTS.payment_fee_pct),
    };
  } catch {
    return { ...DEFAULT_MOZI_COSTS };
  }
}

async function loadActiveClients(): Promise<Record<string, number>> {
  const sb = getServiceSupabase();
  const counts: Record<string, number> = {};

  try {
    const { data, error } = await sb.from("clients").select("offer, status");
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ offer: string | null; status: string | null }>) {
      if ((row.status ?? "").toLowerCase() !== "active") continue;
      const clientKey = offerToClientKey(row.offer);
      if (!clientKey) continue;
      counts[clientKey] = (counts[clientKey] ?? 0) + 1;
    }
  } catch {
    return counts;
  }

  return counts;
}

async function loadManualClientPeriods(period: BillingPeriod): Promise<Map<string, ManualClientPeriodRow>> {
  const sb = getServiceSupabase();
  try {
    const { data, error } = await sb
      .from("accountant_client_periods")
      .select("*")
      .eq("period_start", period.start)
      .eq("period_end", period.end);
    if (error) throw error;

    return new Map(
      ((data ?? []) as ManualClientPeriodRow[]).map((row) => [
        row.client_key,
        row,
      ]),
    );
  } catch {
    return new Map();
  }
}

async function loadManualObligations(): Promise<ManualObligationRow[]> {
  const sb = getServiceSupabase();
  try {
    const { data, error } = await sb
      .from("accountant_manual_obligations")
      .select("label, obligation_type, payee_name, client_name, due_date, amount_cents, status, notes")
      .neq("status", "paid")
      .order("due_date", { ascending: true });
    if (error) throw error;
    return (data ?? []) as ManualObligationRow[];
  } catch {
    return [];
  }
}

async function loadEarliestMercuryTransactionDate(): Promise<string | null> {
  const sb = getServiceSupabase();
  try {
    const { data, error } = await sb
      .from("mozi_mercury_transactions")
      .select("posted_at")
      .eq("account", SOURCE_ACCOUNT)
      .order("posted_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.posted_at ? String(data.posted_at).slice(0, 10) : null;
  } catch {
    return null;
  }
}

async function loadPeriodPaymentsByClient(
  start: string,
  end: string,
  paymentFeePct: number,
): Promise<Record<string, PeriodPaymentTotals>> {
  const sb = getServiceSupabase();
  const totals: Record<string, PeriodPaymentTotals> = {};

  const addMoney = (clientKey: string, gross: number, refunds = 0) => {
    const bucket = totals[clientKey] ?? { gross: 0, refunds: 0, estimatedNet: 0 };
    bucket.gross += gross;
    bucket.refunds += refunds;
    const netBeforeFees = bucket.gross - bucket.refunds;
    bucket.estimatedNet = Math.max(0, netBeforeFees - roundPct(netBeforeFees, paymentFeePct));
    totals[clientKey] = bucket;
  };

  try {
    const [{ data: stripeRows }, { data: whopRows }] = await Promise.all([
      sb
        .from("mozi_stripe_charges")
        .select("influencer, amount, refund_amount, created_at, status")
        .eq("status", "succeeded")
        .gte("created_at", startOfUtcDay(start))
        .lte("created_at", endOfUtcDay(end)),
      sb
        .from("mozi_whop_payments")
        .select("influencer, amount, created_at")
        .gte("created_at", startOfUtcDay(start))
        .lte("created_at", endOfUtcDay(end)),
    ]);

    for (const row of (stripeRows ?? []) as Array<{
      influencer: string | null;
      amount: number | null;
      refund_amount: number | null;
    }>) {
      const clientKey = CLIENTS.find((item) => item.paymentInfluencer === row.influencer)?.key;
      if (!clientKey) continue;
      addMoney(clientKey, toNumber(row.amount), toNumber(row.refund_amount));
    }

    for (const row of (whopRows ?? []) as Array<{
      influencer: string | null;
      amount: number | null;
    }>) {
      const clientKey = CLIENTS.find((item) => item.paymentInfluencer === row.influencer)?.key;
      if (!clientKey) continue;
      addMoney(clientKey, toNumber(row.amount));
    }
  } catch {
    return totals;
  }

  return totals;
}

async function loadAdSpendByClient(start: string, end: string): Promise<Record<string, number>> {
  const sb = getServiceSupabase();
  const totals: Record<string, number> = {};

  try {
    const { data, error } = await sb
      .from("mozi_meta_ad_spend")
      .select("influencer, spend, date")
      .gte("date", start)
      .lte("date", end);
    if (error) throw error;

    for (const row of (data ?? []) as Array<{ influencer: string | null; spend: number | null }>) {
      const clientKey = row.influencer === "tyson" ? "tyson" : row.influencer === "keith" ? "keith" : null;
      if (!clientKey) continue;
      totals[clientKey] = (totals[clientKey] ?? 0) + toNumber(row.spend);
    }
  } catch {
    // Ignore.
  }

  try {
    const keithSpend = await fetchKeithAdSpendRange(start, end);
    totals.keith = Math.max(totals.keith ?? 0, keithSpend.totalCents);
  } catch {
    // Ignore.
  }

  return totals;
}

async function loadCoachPayrollLast30d(todayYmd: string): Promise<number> {
  const sb = getServiceSupabase();
  const sinceYmd = addUtcDays(todayYmd, -30);
  let total = 0;

  try {
    const { data, error } = await sb
      .from("mozi_mercury_transactions")
      .select("amount, counterparty, description, posted_at")
      .eq("account", SOURCE_ACCOUNT)
      .lt("amount", 0)
      .gte("posted_at", startOfUtcDay(sinceYmd))
      .lte("posted_at", endOfUtcDay(todayYmd));
    if (error) throw error;

    for (const row of (data ?? []) as Array<{
      amount: number | null;
      counterparty: string | null;
      description: string | null;
    }>) {
      const haystack = `${row.counterparty ?? ""} ${row.description ?? ""}`.toLowerCase();
      if (!FULFILLMENT_PAYROLL_MATCHES.some((match) => haystack.includes(match.toLowerCase()))) {
        continue;
      }
      if (PM_MATCHES.some((match) => haystack.includes(match))) continue;
      total += Math.abs(toNumber(row.amount));
    }
  } catch {
    return 0;
  }

  return total;
}

function buildPayoutRows(
  salesRows: SheetRow[],
  todayYmd: string,
  manualObligations: ManualObligationRow[],
): UpcomingPayoutsSummary {
  const grouped = new Map<string, UpcomingPayoutRow>();

  const addRow = (row: UpcomingPayoutRow) => {
    const key = [row.due_date, row.category, row.payee, row.client_name ?? ""].join("|");
    const existing = grouped.get(key);
    if (existing) {
      existing.amount += row.amount;
      for (const note of row.notes) {
        if (!existing.notes.includes(note)) existing.notes.push(note);
      }
      return;
    }
    grouped.set(key, { ...row, notes: [...row.notes] });
  };

  for (const row of salesRows) {
    const cashCollected = Math.round(row.cashCollected * 100);
    if (cashCollected <= 0) continue;

    const clientKey = offerToClientKey(row.offer);
    const clientName = clientKey ? clientNameForKey(clientKey) : row.offer || null;
    const setterPct = setterRateFor(row.setter);
    const setterAmount = roundPct(cashCollected, setterPct);
    const closerAmount = row.closer ? roundPct(cashCollected, CLOSER_COMMISSION_PCT) : 0;

    const setterPayDate = setterDueDate(row.date);
    if (setterAmount > 0 && setterPayDate > todayYmd) {
      addRow({
        due_date: setterPayDate,
        category: "setter",
        payee: row.setter || "Unassigned setter",
        client_name: clientName,
        amount: setterAmount,
        source: "live",
        notes: ["3% for most setters, 5% for Amara."],
      });
    }

    const closerPayDate = closerDueDate(row.date);
    if (closerAmount > 0 && closerPayDate > todayYmd) {
      addRow({
        due_date: closerPayDate,
        category: "closer",
        payee: row.closer || "Unassigned closer",
        client_name: clientName,
        amount: closerAmount,
        source: "live",
        notes: ["10% of cash collected, paid one period later."],
      });
    }
  }

  for (const row of manualObligations) {
    if ((row.status ?? "owed").toLowerCase() === "paid") continue;
    addRow({
      due_date: row.due_date,
      category: "manual",
      payee: row.payee_name || row.label,
      client_name: row.client_name,
      amount: row.amount_cents,
      source: "manual",
      notes: [row.notes ?? row.obligation_type.replace(/_/g, " ")],
    });
  }

  const rows = Array.from(grouped.values()).sort((a, b) => {
    const dueCompare = a.due_date.localeCompare(b.due_date);
    if (dueCompare !== 0) return dueCompare;
    return b.amount - a.amount;
  });

  const in14Days = addUtcDays(todayYmd, 14);
  const in30Days = addUtcDays(todayYmd, 30);
  const totalAccrued = sumBy(rows, (row) => row.amount);
  const commissionZone = sumBy(
    rows,
    (row) => (row.category === "closer" || row.category === "setter" ? row.amount : 0),
  );
  const dueNext14d = sumBy(
    rows,
    (row) => (row.due_date >= todayYmd && row.due_date <= in14Days ? row.amount : 0),
  );
  const dueNext30d = sumBy(
    rows,
    (row) => (row.due_date >= todayYmd && row.due_date <= in30Days ? row.amount : 0),
  );
  const manualObligationTotal = sumBy(
    rows,
    (row) => (row.category === "manual" ? row.amount : 0),
  );

  return {
    commission_zone: commissionZone,
    total_accrued: totalAccrued,
    due_next_14d: dueNext14d,
    due_next_30d: dueNext30d,
    manual_obligations: manualObligationTotal,
    rows,
  };
}

function buildClientPlan(
  clientKey: string,
  clientName: string,
  rows: SheetRow[],
  manual: ManualClientPeriodRow | undefined,
  payments: PeriodPaymentTotals | undefined,
  adSpend: number,
  settings: AccountantSettings,
  coachingBudget: CoachingBudgetSnapshot,
  visibleClientCount: number,
  paymentFeePct: number,
): ClientPeriodPlan {
  const cashCollectedAuto = sumBy(rows, (row) => Math.round(row.cashCollected * 100));
  const salesTeamAuto = roundPct(cashCollectedAuto, settings.sales_team_invoice_pct);
  const actualCommissions = sumBy(rows, (row) => {
    const cashCollected = Math.round(row.cashCollected * 100);
    const setterAmount = roundPct(cashCollected, setterRateFor(row.setter));
    const closerAmount = row.closer ? roundPct(cashCollected, CLOSER_COMMISSION_PCT) : 0;
    return setterAmount + closerAmount;
  });
  const programsSold = rows.filter((row) => row.cashCollected > 0).length;
  const programMonthsAuto = sumBy(rows, (row) => parseProgramMonths(row.programLength));
  const coachingLineAuto =
    programMonthsAuto * settings.coaching_line_per_program_month_cents;
  const coachingReserveAuto = programMonthsAuto * coachingBudget.cost_per_active_client;
  const softwareShareAuto =
    visibleClientCount > 0 ? Math.round(settings.software_monthly_cents / visibleClientCount) : 0;
  const estimatedNetAuto =
    payments?.estimatedNet ??
    Math.max(0, cashCollectedAuto - roundPct(cashCollectedAuto, paymentFeePct));

  const cashCollected = manual?.cash_collected_cents ?? cashCollectedAuto;
  const salesTeamLine = manual?.sales_team_line_cents ?? salesTeamAuto;
  const programMonthsSold = manual?.program_months_sold ?? programMonthsAuto;
  const coachingLine = manual?.coaching_line_cents ?? coachingLineAuto;
  const coachingReserve = manual?.coaching_reserve_cents ?? coachingReserveAuto;
  const estimatedNetCash = manual?.net_cash_cents ?? estimatedNetAuto;
  const adSpendTotal = manual?.ad_spend_cents ?? adSpend;
  const forecastFulfillment = manual?.forecast_fulfillment_cents ?? 0;
  const softwareLine = manual?.software_fee_cents ?? softwareShareAuto;

  const subtotal =
    adSpendTotal +
    salesTeamLine +
    coachingLine +
    forecastFulfillment +
    softwareLine;
  const profitShareAuto = Math.max(0, Math.round((estimatedNetCash - subtotal) / 2));
  const profitShareLine = manual?.profit_share_cents ?? profitShareAuto;
  const invoiceTotal = manual?.invoice_total_cents ?? subtotal + profitShareLine;
  const estimatedCompanyKeep =
    invoiceTotal -
    adSpendTotal -
    actualCommissions -
    coachingReserve -
    forecastFulfillment -
    softwareShareAuto;

  const notes: string[] = [];
  pushMoneyNote(notes, !payments && !manual?.net_cash_cents, "Net cash is estimated from processor fee %.");
  pushMoneyNote(
    notes,
    !manual?.forecast_fulfillment_cents,
    "Add fulfillment forecast in Supabase to tighten this invoice.",
  );
  pushMoneyNote(
    notes,
    !manual?.software_fee_cents,
    "Software line is split evenly across visible clients right now.",
  );
  if (manual?.notes) notes.push(manual.notes);

  return {
    client_key: clientKey,
    client_name: manual?.client_name || clientName,
    cash_collected: cashCollected,
    estimated_net_cash: estimatedNetCash,
    ad_spend: adSpendTotal,
    sales_team_line: salesTeamLine,
    actual_sales_commissions: actualCommissions,
    programs_sold: programsSold,
    program_months_sold: programMonthsSold,
    coaching_line: coachingLine,
    coaching_reserve: coachingReserve,
    forecast_fulfillment: forecastFulfillment,
    software_line: softwareLine,
    software_cost_allocated: softwareShareAuto,
    profit_share_line: profitShareLine,
    invoice_total: invoiceTotal,
    estimated_company_keep: estimatedCompanyKeep,
    invoice_source: manual ? "manual" : "estimate",
    notes,
  };
}

function buildClientProfitRows(clients: ClientPeriodPlan[]): ClientProfitRow[] {
  return clients
    .map((client) => ({
      client_key: client.client_key,
      client_name: client.client_name,
      invoice_total: client.invoice_total,
      estimated_net_cash: client.estimated_net_cash,
      ad_spend: client.ad_spend,
      actual_sales_commissions: client.actual_sales_commissions,
      coaching_reserve: client.coaching_reserve,
      forecast_fulfillment: client.forecast_fulfillment,
      software_cost_allocated: client.software_cost_allocated,
      estimated_company_keep: client.estimated_company_keep,
      margin_pct:
        client.invoice_total > 0
          ? Number(((client.estimated_company_keep / client.invoice_total) * 100).toFixed(1))
          : null,
      invoice_source: client.invoice_source,
    }))
    .sort((a, b) => b.estimated_company_keep - a.estimated_company_keep);
}

function buildCoachingBudget(
  activeClientCounts: Record<string, number>,
  coachPayrollLast30d: number,
  settings: AccountantSettings,
): CoachingBudgetSnapshot {
  const activeClients = Object.values(activeClientCounts).reduce((sum, value) => sum + value, 0);
  const totalCost = coachPayrollLast30d + settings.product_manager_base_monthly_cents;
  const costPerActiveClient =
    activeClients > 0 ? Math.round(totalCost / activeClients) : 0;
  const targetBudgetTotal =
    activeClients * settings.coaching_target_per_active_client_cents;
  const hardCapBudgetTotal =
    activeClients * settings.coaching_hard_cap_per_active_client_cents;

  return {
    active_clients: activeClients,
    coaching_line_per_program_month: settings.coaching_line_per_program_month_cents,
    target_cost_per_active_client: settings.coaching_target_per_active_client_cents,
    hard_cap_cost_per_active_client: settings.coaching_hard_cap_per_active_client_cents,
    product_manager_base_monthly: settings.product_manager_base_monthly_cents,
    coach_payroll_last_30d: coachPayrollLast30d,
    total_cost_last_30d: totalCost,
    cost_per_active_client: costPerActiveClient,
    target_budget_total: targetBudgetTotal,
    hard_cap_budget_total: hardCapBudgetTotal,
    coaching_revenue_capacity:
      activeClients * settings.coaching_line_per_program_month_cents,
    headroom_to_target: targetBudgetTotal - totalCost,
    headroom_to_hard_cap: hardCapBudgetTotal - totalCost,
    status:
      costPerActiveClient <= settings.coaching_hard_cap_per_active_client_cents
        ? "on_target"
        : costPerActiveClient <= settings.coaching_target_per_active_client_cents
          ? "above_target"
          : "above_hard_cap",
  };
}

function buildRecommendations(params: {
  coachingBudget: CoachingBudgetSnapshot;
  focusPeriod: CurrentPeriodFinance;
  payouts: UpcomingPayoutsSummary;
  safeCash: number;
  earliestMercuryTxDate: string | null;
  todayYmd: string;
}): FinanceRecommendation[] {
  const recommendations: FinanceRecommendation[] = [];
  const { coachingBudget, focusPeriod, payouts, safeCash, earliestMercuryTxDate, todayYmd } = params;

  if (safeCash < 0) {
    recommendations.push({
      title: "Safe cash is negative",
      body: "Unpaid obligations are bigger than cash on hand. Tighten payout timing, invoice faster, or trim non-core spend before taking draws.",
      priority: "high",
    });
  } else if (safeCash < payouts.due_next_30d) {
    recommendations.push({
      title: "Safe cash is thin",
      body: "You can cover the next 30 days, but there is not much buffer. Watch commissions and any manual obligations closely.",
      priority: "medium",
    });
  }

  if (coachingBudget.status === "above_hard_cap") {
    recommendations.push({
      title: "Coaching cost is above the hard cap",
      body: "Current coaching cost per active client is above $24. Cut coach load waste, tighten scheduling, or raise what you bill before adding headcount.",
      priority: "high",
    });
  } else if (coachingBudget.status === "above_target") {
    recommendations.push({
      title: "Coaching cost is over the $21 goal",
      body: "You are still below the $24 ceiling, but not below the $21 stretch goal. Track coach hours and PM time weekly until this drops.",
      priority: "medium",
    });
  }

  if (focusPeriod.clients.some((client) => client.notes.some((note) => note.includes("fulfillment forecast")))) {
    recommendations.push({
      title: "Fill in fulfillment forecasts",
      body: "The invoice planner can automate ads, sales fees, and coaching. Fulfillment forecasts still need manual inputs if you want exact client profit.",
      priority: "medium",
    });
  }

  if (earliestMercuryTxDate && earliestMercuryTxDate > addUtcDays(todayYmd, -330)) {
    recommendations.push({
      title: "Run the 12-month Mercury backfill",
      body: "The trend chart is still missing older transactions. Use the new backfill button once so historical months stop showing fake zeros.",
      priority: "medium",
    });
  }

  recommendations.push({
    title: "Pay owners a base first, distributions second",
    body: "If you want profit to mean business profit, put you and your partner on a fixed monthly payroll or fixed draw. Then keep extra payouts separate as distributions after safe cash stays healthy.",
    priority: "low",
  });

  return recommendations;
}

function buildLegend(): FinanceLegendItem[] {
  return [
    {
      term: "Safe Cash",
      definition: "Cash you can touch without pretending unpaid obligations do not exist.",
      formula: "CoreShift cash on hand - upcoming commission zone - unpaid manual obligations",
    },
    {
      term: "Upcoming Commission Zone",
      definition: "Sales-team money already earned but not paid yet.",
      formula: "All closer + setter commissions whose payout date is still in the future, plus manual commission rows still marked unpaid",
    },
    {
      term: "Estimated Net Cash",
      definition: "The best guess for what actually landed after refunds and processor fees.",
      formula: "(Stripe + Whop cash collected - actual refunds) - estimated processor fee %",
    },
    {
      term: "Sales Team Line",
      definition: "What you bill the client for sales on that period.",
      formula: "15% x cash collected for the period",
    },
    {
      term: "Actual Sales Commissions",
      definition: "What you expect to pay the team from that same sales period.",
      formula: "Closer 10% + setter 3% or 5% per sale row, grouped by payout date",
    },
    {
      term: "Coaching Line",
      definition: "The coaching revenue line you bill from programs sold.",
      formula: "Program months sold x $30",
    },
    {
      term: "Coaching Reserve",
      definition: "A cost reserve for the coaching months you sold.",
      formula: "Program months sold x current coaching cost per active client",
    },
    {
      term: "Profit Share Line",
      definition: "The last invoice line after the other lines are accounted for.",
      formula: "Max(0, (estimated net cash - subtotal of billed lines) / 2)",
    },
    {
      term: "Estimated Company Keep",
      definition: "The money left after you cover the direct costs tied to that client period.",
      formula: "Invoice total - ad spend - actual commissions - coaching reserve - fulfillment forecast - software cost share",
    },
    {
      term: "Coaching Cost / Active Client",
      definition: "What coaching operations are really costing per live client right now.",
      formula: "(Coach payroll last 30d + fixed PM base pay) / active clients",
    },
  ];
}

export async function getFinanceOverview(
  cashOnHandCents: number,
  now: Date = new Date(),
): Promise<FinanceOverview> {
  const todayYmd = ymdUtc(now);
  const focusPeriod = getCurrentBillingPeriod(now);
  const focusEnd = todayYmd < focusPeriod.end ? todayYmd : focusPeriod.end;
  const salesWindowStart = ymdUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)));

  const [settings, moziCosts] = await Promise.all([
    loadAccountantSettings(),
    loadMoziCostSettings(),
  ]);

  const [
    activeClientCounts,
    salesRows,
    manualClientPeriods,
    manualObligations,
    paymentsByClient,
    adSpendByClient,
    coachPayrollLast30d,
    earliestMercuryTxDate,
  ] = await Promise.all([
    loadActiveClients(),
    fetchSheetData(salesWindowStart, todayYmd).catch(() => [] as SheetRow[]),
    loadManualClientPeriods(focusPeriod),
    loadManualObligations(),
    loadPeriodPaymentsByClient(focusPeriod.start, focusEnd, moziCosts.payment_fee_pct).catch(
      () => ({} as Record<string, PeriodPaymentTotals>),
    ),
    loadAdSpendByClient(focusPeriod.start, focusEnd).catch(() => ({} as Record<string, number>)),
    loadCoachPayrollLast30d(todayYmd),
    loadEarliestMercuryTransactionDate(),
  ]);

  const coachingBudget = buildCoachingBudget(activeClientCounts, coachPayrollLast30d, settings);
  const payoutSummary = buildPayoutRows(salesRows, todayYmd, manualObligations);

  const focusRows = salesRows.filter((row) => row.date >= focusPeriod.start && row.date <= focusEnd);
  const rowsByClient = new Map<string, SheetRow[]>();
  for (const row of focusRows) {
    const clientKey = offerToClientKey(row.offer);
    if (!clientKey) continue;
    const bucket = rowsByClient.get(clientKey) ?? [];
    bucket.push(row);
    rowsByClient.set(clientKey, bucket);
  }

  const visibleClientKeys = new Set<string>([
    ...rowsByClient.keys(),
    ...manualClientPeriods.keys(),
  ]);

  const visibleClientCount = visibleClientKeys.size;
  const clientPlans: ClientPeriodPlan[] = Array.from(visibleClientKeys)
    .map((clientKey) =>
      buildClientPlan(
        clientKey,
        clientNameForKey(clientKey, manualClientPeriods.get(clientKey)?.client_name),
        rowsByClient.get(clientKey) ?? [],
        manualClientPeriods.get(clientKey),
        paymentsByClient[clientKey],
        adSpendByClient[clientKey] ?? 0,
        settings,
        coachingBudget,
        visibleClientCount,
        moziCosts.payment_fee_pct,
      ),
    )
    .sort((a, b) => b.invoice_total - a.invoice_total);

  const safeCash =
    cashOnHandCents - payoutSummary.commission_zone - payoutSummary.manual_obligations;

  const currentPeriodFinance: CurrentPeriodFinance = {
    period: focusPeriod,
    totals: {
      cash_collected: sumBy(clientPlans, (client) => client.cash_collected),
      estimated_net_cash: sumBy(clientPlans, (client) => client.estimated_net_cash),
      ad_spend: sumBy(clientPlans, (client) => client.ad_spend),
      sales_team_line: sumBy(clientPlans, (client) => client.sales_team_line),
      actual_sales_commissions: sumBy(clientPlans, (client) => client.actual_sales_commissions),
      program_months_sold: sumBy(clientPlans, (client) => client.program_months_sold),
      coaching_line: sumBy(clientPlans, (client) => client.coaching_line),
      coaching_reserve: sumBy(clientPlans, (client) => client.coaching_reserve),
      forecast_fulfillment: sumBy(clientPlans, (client) => client.forecast_fulfillment),
      software_line: sumBy(clientPlans, (client) => client.software_line),
      software_cost_allocated: sumBy(clientPlans, (client) => client.software_cost_allocated),
      profit_share_line: sumBy(clientPlans, (client) => client.profit_share_line),
      invoice_total: sumBy(clientPlans, (client) => client.invoice_total),
      estimated_company_keep: sumBy(clientPlans, (client) => client.estimated_company_keep),
    },
    clients: clientPlans,
  };

  const recommendations = buildRecommendations({
    coachingBudget,
    focusPeriod: currentPeriodFinance,
    payouts: payoutSummary,
    safeCash,
    earliestMercuryTxDate,
    todayYmd,
  });

  return {
    safe_cash: safeCash,
    focus_period: currentPeriodFinance,
    payouts: payoutSummary,
    client_profit: buildClientProfitRows(clientPlans),
    coaching_budget: coachingBudget,
    recommendations,
    legend: buildLegend(),
  };
}
