// Pure-type module so client components can import types without pulling in
// server-only deps like supabase service role client.

export type AccountKey = "coreshift" | "forge" | "combined";

export interface Balance {
  account: string;
  balance: number;
  snapshot_date: string;
}

export interface Transaction {
  mercury_id: string;
  account: string | null;
  amount: number;
  counterparty: string | null;
  description: string | null;
  posted_at: string | null;
  category: string;
  kind: "income" | "expense" | "transfer";
}

export interface CategorySummary {
  category: string;
  income: number;
  expenses: number;
  count: number;
}

export interface PeriodSummary {
  income: number;
  expenses: number;
  net: number;
  tx_count: number;
  by_category: CategorySummary[];
  top_counterparties: Array<{ counterparty: string; amount: number; count: number }>;
}

export interface MonthlyReport {
  account: string;
  period_start: string;
  period_end: string;
  opening_balance: number;
  closing_balance: number;
  income: number;
  expenses: number;
  net: number;
  tx_count: number;
  by_category: Record<string, { income: number; expenses: number; count: number }> | null;
  top_counterparties: Array<{ counterparty: string; amount: number; count: number }> | null;
  generated_at: string;
}

export type FinanceValueSource = "live" | "estimate" | "manual";

export interface BillingPeriod {
  start: string;
  end: string;
  label: string;
  billing_date: string;
  kind: "first_half" | "second_half";
}

export interface ClientPeriodPlan {
  client_key: string;
  client_name: string;
  cash_collected: number;
  estimated_net_cash: number;
  ad_spend: number;
  sales_team_line: number;
  actual_sales_commissions: number;
  programs_sold: number;
  program_months_sold: number;
  coaching_line: number;
  coaching_reserve: number;
  forecast_fulfillment: number;
  software_line: number;
  software_cost_allocated: number;
  profit_share_line: number;
  invoice_total: number;
  estimated_company_keep: number;
  invoice_source: FinanceValueSource;
  notes: string[];
}

export interface CurrentPeriodFinance {
  period: BillingPeriod;
  totals: {
    cash_collected: number;
    estimated_net_cash: number;
    ad_spend: number;
    sales_team_line: number;
    actual_sales_commissions: number;
    program_months_sold: number;
    coaching_line: number;
    coaching_reserve: number;
    forecast_fulfillment: number;
    software_line: number;
    software_cost_allocated: number;
    profit_share_line: number;
    invoice_total: number;
    estimated_company_keep: number;
  };
  clients: ClientPeriodPlan[];
}

export interface UpcomingPayoutRow {
  due_date: string;
  category: "closer" | "setter" | "manual";
  payee: string;
  client_name: string | null;
  amount: number;
  source: FinanceValueSource;
  notes: string[];
}

export interface UpcomingPayoutsSummary {
  commission_zone: number;
  total_accrued: number;
  due_next_14d: number;
  due_next_30d: number;
  manual_obligations: number;
  rows: UpcomingPayoutRow[];
}

export interface ClientProfitRow {
  client_key: string;
  client_name: string;
  invoice_total: number;
  estimated_net_cash: number;
  ad_spend: number;
  actual_sales_commissions: number;
  coaching_reserve: number;
  forecast_fulfillment: number;
  software_cost_allocated: number;
  estimated_company_keep: number;
  margin_pct: number | null;
  invoice_source: FinanceValueSource;
}

export interface CoachingBudgetSnapshot {
  active_clients: number;
  coaching_line_per_program_month: number;
  target_cost_per_active_client: number;
  hard_cap_cost_per_active_client: number;
  product_manager_base_monthly: number;
  coach_payroll_last_30d: number;
  total_cost_last_30d: number;
  cost_per_active_client: number;
  target_budget_total: number;
  hard_cap_budget_total: number;
  coaching_revenue_capacity: number;
  headroom_to_target: number;
  headroom_to_hard_cap: number;
  status: "on_target" | "above_target" | "above_hard_cap";
}

export interface FinanceRecommendation {
  title: string;
  body: string;
  priority: "high" | "medium" | "low";
}

export interface FinanceLegendItem {
  term: string;
  definition: string;
  formula: string;
}

export interface FinanceOverview {
  safe_cash: number;
  focus_period: CurrentPeriodFinance;
  payouts: UpcomingPayoutsSummary;
  client_profit: ClientProfitRow[];
  coaching_budget: CoachingBudgetSnapshot;
  recommendations: FinanceRecommendation[];
  legend: FinanceLegendItem[];
}

export interface AccountantDashboardData {
  balances: Balance[];
  currentMonth: {
    start: string;
    end: string;
    label: string;
    transactions: Transaction[];
    summary: PeriodSummary;
  };
  trend: Array<{ month: string; income: number; expenses: number; net: number }>;
  storedReports: MonthlyReport[];
  finance: FinanceOverview;
}

export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
