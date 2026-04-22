import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import type {
  AccountKey,
  Balance,
  Transaction,
  CategorySummary,
  MonthlyReport,
  PeriodSummary,
} from "@/lib/accountant-types";

export type {
  AccountKey,
  Balance,
  Transaction,
  CategorySummary,
  MonthlyReport,
  PeriodSummary,
};
export { formatCents } from "@/lib/accountant-types";

// All monetary values are integer cents in the DB.
// Mercury amounts: positive = money in (credits), negative = money out (debits).

interface CategoryRule {
  keyword: string;
  category: string;
  kind: "income" | "expense" | "transfer";
}

// Hard-coded fallback rules so the tab works even before the
// accountant_categories table exists. DB rows override/extend these.
const FALLBACK_RULES: CategoryRule[] = [
  { keyword: "stripe",         category: "Revenue",       kind: "income"  },
  { keyword: "whop",           category: "Revenue",       kind: "income"  },
  { keyword: "paypal",         category: "Revenue",       kind: "income"  },
  { keyword: "meta platforms", category: "Ads - Meta",    kind: "expense" },
  { keyword: "facebook",       category: "Ads - Meta",    kind: "expense" },
  { keyword: "google ads",     category: "Ads - Google",  kind: "expense" },
  { keyword: "tiktok",         category: "Ads - TikTok",  kind: "expense" },
  { keyword: "openai",         category: "Software / AI", kind: "expense" },
  { keyword: "anthropic",      category: "Software / AI", kind: "expense" },
  { keyword: "vercel",         category: "Software / AI", kind: "expense" },
  { keyword: "supabase",       category: "Software / AI", kind: "expense" },
  { keyword: "gohighlevel",    category: "Software / AI", kind: "expense" },
  { keyword: "manychat",       category: "Software / AI", kind: "expense" },
  { keyword: "slack",          category: "Software / AI", kind: "expense" },
  { keyword: "notion",         category: "Software / AI", kind: "expense" },
  { keyword: "gusto",          category: "Payroll",       kind: "expense" },
  { keyword: "rippling",       category: "Payroll",       kind: "expense" },
  { keyword: "deel",           category: "Payroll",       kind: "expense" },
  { keyword: "mercury",        category: "Bank / Fees",   kind: "expense" },
  { keyword: "wire fee",       category: "Bank / Fees",   kind: "expense" },
  { keyword: "transfer",       category: "Transfer",      kind: "transfer" },
  { keyword: "owner draw",     category: "Owner Draw",    kind: "expense" },
  { keyword: "matthew conder", category: "Owner Draw",    kind: "expense" },
];

let _rulesCache: CategoryRule[] | null = null;

async function loadCategoryRules(): Promise<CategoryRule[]> {
  if (_rulesCache) return _rulesCache;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("accountant_categories")
      .select("keyword, category, kind");
    if (error) throw error;
    const dbRules = (data ?? []) as CategoryRule[];
    _rulesCache = dbRules.length > 0 ? dbRules : FALLBACK_RULES;
  } catch {
    _rulesCache = FALLBACK_RULES;
  }
  return _rulesCache;
}

export function categorizeTransaction(
  tx: { amount: number; counterparty: string | null; description: string | null },
  rules: CategoryRule[]
): { category: string; kind: "income" | "expense" | "transfer" } {
  const haystack = `${tx.counterparty ?? ""} ${tx.description ?? ""}`.toLowerCase();

  for (const r of rules) {
    if (haystack.includes(r.keyword.toLowerCase())) {
      return { category: r.category, kind: r.kind };
    }
  }

  // Fallback by sign.
  if (tx.amount > 0) return { category: "Uncategorized Income", kind: "income" };
  return { category: "Uncategorized Expense", kind: "expense" };
}

export async function getCurrentBalances(): Promise<Balance[]> {
  const sb = getServiceSupabase();
  // Latest snapshot per account.
  const { data } = await sb
    .from("mozi_mercury_balances")
    .select("account, balance, snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(30);

  const latest = new Map<string, Balance>();
  for (const row of (data ?? []) as Balance[]) {
    if (!latest.has(row.account)) latest.set(row.account, row);
  }
  return Array.from(latest.values());
}

export async function getTransactions(params: {
  account?: AccountKey;
  start: string; // ISO
  end: string;   // ISO
  limit?: number;
}): Promise<Transaction[]> {
  const sb = getServiceSupabase();
  let q = sb
    .from("mozi_mercury_transactions")
    .select("mercury_id, account, amount, counterparty, description, posted_at")
    .gte("posted_at", params.start)
    .lte("posted_at", params.end)
    .order("posted_at", { ascending: false });

  if (params.account && params.account !== "combined") {
    q = q.eq("account", params.account);
  }
  if (params.limit) q = q.limit(params.limit);

  const { data } = await q;
  const rules = await loadCategoryRules();

  return (data ?? []).map((row) => {
    const tx = row as Omit<Transaction, "category" | "kind">;
    const { category, kind } = categorizeTransaction(tx, rules);
    return { ...tx, category, kind };
  });
}

export function summarize(txs: Transaction[]): PeriodSummary {
  let income = 0;
  let expenses = 0;
  const cats = new Map<string, CategorySummary>();
  const cps = new Map<string, { counterparty: string; amount: number; count: number }>();

  for (const tx of txs) {
    if (tx.kind === "transfer") continue; // don't count transfers as revenue/spend

    if (tx.amount > 0) income += tx.amount;
    else expenses += Math.abs(tx.amount);

    const c = cats.get(tx.category) ?? { category: tx.category, income: 0, expenses: 0, count: 0 };
    if (tx.amount > 0) c.income += tx.amount;
    else c.expenses += Math.abs(tx.amount);
    c.count += 1;
    cats.set(tx.category, c);

    const cpKey = tx.counterparty ?? "(unknown)";
    const cp = cps.get(cpKey) ?? { counterparty: cpKey, amount: 0, count: 0 };
    cp.amount += Math.abs(tx.amount);
    cp.count += 1;
    cps.set(cpKey, cp);
  }

  const by_category = Array.from(cats.values()).sort(
    (a, b) => b.expenses + b.income - (a.expenses + a.income)
  );
  const top_counterparties = Array.from(cps.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  return {
    income,
    expenses,
    net: income - expenses,
    tx_count: txs.length,
    by_category,
    top_counterparties,
  };
}

export function monthBounds(date: Date): { start: string; end: string; startDate: string; endDate: string } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0));
  end.setUTCMilliseconds(-1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export async function getMonthlyTrend(months: number): Promise<
  Array<{ month: string; income: number; expenses: number; net: number }>
> {
  const now = new Date();
  const out: Array<{ month: string; income: number; expenses: number; net: number }> = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const { start, end, startDate } = monthBounds(d);
    const txs = await getTransactions({ start, end });
    const s = summarize(txs);
    out.push({
      month: startDate.slice(0, 7), // YYYY-MM
      income: s.income,
      expenses: s.expenses,
      net: s.net,
    });
  }
  return out;
}

export async function getStoredMonthlyReports(limit = 12): Promise<MonthlyReport[]> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("accountant_monthly_reports")
      .select("*")
      .order("period_start", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as MonthlyReport[];
  } catch {
    // Table doesn't exist yet (migration not run) — return empty.
    return [];
  }
}

