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

export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
