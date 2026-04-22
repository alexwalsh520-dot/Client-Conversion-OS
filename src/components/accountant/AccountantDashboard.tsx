"use client";

import { Fragment, useMemo, useState } from "react";
import {
  AccountantDashboardData,
  ClientPeriodPlan,
  FinanceLegendItem,
  FinanceRecommendation,
  formatCents,
  UpcomingPayoutRow,
} from "@/lib/accountant-types";
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  FileText,
  Landmark,
  PiggyBank,
  RefreshCw,
  Shield,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

type Props = AccountantDashboardData;

export default function AccountantDashboard({
  balances,
  currentMonth,
  trend,
  storedReports,
  finance,
}: Props) {
  const [kindFilter, setKindFilter] = useState<"all" | "income" | "expense">("all");
  const [syncing, setSyncing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const filteredTxs = useMemo(() => {
    return currentMonth.transactions.filter((tx) => {
      if (kindFilter !== "all" && tx.kind !== kindFilter) return false;
      return true;
    });
  }, [currentMonth.transactions, kindFilter]);

  const categoryTransactions = useMemo(() => {
    const grouped = new Map<string, typeof currentMonth.transactions>();
    for (const tx of currentMonth.transactions) {
      const bucket = grouped.get(tx.category) ?? [];
      bucket.push(tx);
      grouped.set(tx.category, bucket);
    }
    return grouped;
  }, [currentMonth.transactions]);

  const totalBalance = balances.reduce((acc, b) => acc + b.balance, 0);
  const maxTrendValue = Math.max(...trend.map((m) => Math.max(m.income, m.expenses)), 1);

  const handleSync = async () => {
    setActionError(null);
    setSyncing(true);
    try {
      const res = await fetch("/api/accountant/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      window.location.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Sync failed.");
      setSyncing(false);
    }
  };

  const handleBackfill = async () => {
    setActionError(null);
    setBackfilling(true);
    try {
      const res = await fetch("/api/accountant/backfill", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      window.location.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Backfill failed.");
      setBackfilling(false);
    }
  };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1440, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Accountant
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Live CoreShift LLC (Mercury) + finance planning layer
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-secondary"
            onClick={handleBackfill}
            disabled={backfilling || syncing}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <Calculator size={14} />
            {backfilling ? "Backfilling…" : "Backfill 12M"}
          </button>
          <button
            className="btn-secondary"
            onClick={handleSync}
            disabled={syncing || backfilling}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <RefreshCw size={14} className={syncing ? "spin" : ""} />
            {syncing ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      </div>

      {actionError && (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 10,
            border: "1px solid rgba(239,68,68,0.25)",
            background: "rgba(239,68,68,0.08)",
            color: "var(--danger, #ef4444)",
            fontSize: 13,
          }}
        >
          {actionError}
        </div>
      )}

      <Section title="Operating Snapshot">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <StatCard
            label="CoreShift Cash on Hand"
            value={formatCents(totalBalance)}
            icon={<Wallet size={16} />}
            sub={balances[0]?.snapshot_date ? `As of ${balances[0].snapshot_date}` : undefined}
          />
          <StatCard
            label="Safe Cash"
            value={formatCents(finance.safe_cash)}
            icon={<Shield size={16} />}
            sub="Cash after unpaid commissions + manual obligations"
            color={finance.safe_cash >= 0 ? "var(--text-primary)" : "var(--danger, #ef4444)"}
          />
          <StatCard
            label="Upcoming Commission Zone"
            value={formatCents(finance.payouts.commission_zone)}
            icon={<Users size={16} />}
            sub={`${finance.payouts.rows.length} unpaid payout rows`}
          />
          <StatCard
            label="Due Next 30 Days"
            value={formatCents(finance.payouts.due_next_30d)}
            icon={<Landmark size={16} />}
            sub="Closer + setter + manual items due soon"
          />
          <StatCard
            label="Next Invoice Plan"
            value={formatCents(finance.focus_period.totals.invoice_total)}
            icon={<FileText size={16} />}
            sub={`${finance.focus_period.period.label} · Bills ${finance.focus_period.period.billing_date}`}
          />
          <StatCard
            label="Coaching Cost / Active Client"
            value={formatCents(finance.coaching_budget.cost_per_active_client)}
            icon={<PiggyBank size={16} />}
            sub={coachingStatusCopy(finance.coaching_budget.status)}
            color={coachingStatusColor(finance.coaching_budget.status)}
          />
        </div>
      </Section>

      <Section title="Next Invoice Plan">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <MiniCard label="Billing Window" value={finance.focus_period.period.label} />
          <MiniCard label="Bills On" value={finance.focus_period.period.billing_date} />
          <MiniCard label="Cash Collected" value={formatCents(finance.focus_period.totals.cash_collected)} />
          <MiniCard label="Est. Net Cash" value={formatCents(finance.focus_period.totals.estimated_net_cash)} />
          <MiniCard label="Profit Share Line" value={formatCents(finance.focus_period.totals.profit_share_line)} />
          <MiniCard label="Est. Company Keep" value={formatCents(finance.focus_period.totals.estimated_company_keep)} />
        </div>

        <TableWrap>
          {finance.focus_period.clients.length === 0 ? (
            <EmptyState
              icon={<Calculator size={18} />}
              text="No client period rows yet for this billing window. Once sales land, or you add manual period rows in Supabase, the invoice planner will populate here."
            />
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-primary)" }}>
                  <Th>Client</Th>
                  <Th align="right">Cash</Th>
                  <Th align="right">Net Cash</Th>
                  <Th align="right">Ads</Th>
                  <Th align="right">Sales Line</Th>
                  <Th align="right">Coaching</Th>
                  <Th align="right">Fulfillment</Th>
                  <Th align="right">Software</Th>
                  <Th align="right">Profit Share</Th>
                  <Th align="right">Invoice</Th>
                  <Th align="right">Keep</Th>
                  <Th>Source</Th>
                </tr>
              </thead>
              <tbody>
                {finance.focus_period.clients.map((client) => (
                  <tr key={client.client_key} style={{ borderTop: "1px solid var(--border-primary)" }}>
                    <Td>
                      <div style={{ display: "grid", gap: 4 }}>
                        <span>{client.client_name}</span>
                        <InlineMeta>
                          {client.programs_sold} sales · {client.program_months_sold} program months
                        </InlineMeta>
                        {client.notes.length > 0 && (
                          <InlineMeta>{client.notes.join(" ")}</InlineMeta>
                        )}
                      </div>
                    </Td>
                    <Td align="right">{formatCents(client.cash_collected)}</Td>
                    <Td align="right">{formatCents(client.estimated_net_cash)}</Td>
                    <Td align="right">{formatCents(client.ad_spend)}</Td>
                    <Td align="right">{formatCents(client.sales_team_line)}</Td>
                    <Td align="right">{formatCents(client.coaching_line)}</Td>
                    <Td align="right">{formatCents(client.forecast_fulfillment)}</Td>
                    <Td align="right">{formatCents(client.software_line)}</Td>
                    <Td align="right">{formatCents(client.profit_share_line)}</Td>
                    <Td align="right" color="var(--text-primary)">
                      {formatCents(client.invoice_total)}
                    </Td>
                    <Td
                      align="right"
                      color={
                        client.estimated_company_keep >= 0
                          ? "var(--success, #10b981)"
                          : "var(--danger, #ef4444)"
                      }
                    >
                      {formatCents(client.estimated_company_keep)}
                    </Td>
                    <Td>
                      <SourceBadge source={client.invoice_source} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableWrap>
      </Section>

      <Section title="Upcoming Payouts">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <MiniCard label="Total Accrued" value={formatCents(finance.payouts.total_accrued)} />
          <MiniCard label="Commission Zone" value={formatCents(finance.payouts.commission_zone)} />
          <MiniCard label="Manual Obligations" value={formatCents(finance.payouts.manual_obligations)} />
          <MiniCard label="Due Next 14 Days" value={formatCents(finance.payouts.due_next_14d)} />
        </div>

        <TableWrap>
          {finance.payouts.rows.length === 0 ? (
            <EmptyState
              icon={<Users size={18} />}
              text="No unpaid payout rows are showing right now."
            />
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-primary)" }}>
                  <Th>Due</Th>
                  <Th>Type</Th>
                  <Th>Payee</Th>
                  <Th>Client</Th>
                  <Th align="right">Amount</Th>
                  <Th>Source</Th>
                </tr>
              </thead>
              <tbody>
                {finance.payouts.rows.map((row) => (
                  <PayoutRowView key={payoutKey(row)} row={row} />
                ))}
              </tbody>
            </table>
          )}
        </TableWrap>
      </Section>

      <Section title="Client Profitability">
        <TableWrap>
          {finance.client_profit.length === 0 ? (
            <EmptyState
              icon={<TrendingUp size={18} />}
              text="Profit rows will show here as soon as a billing period has sales or manual inputs."
            />
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-primary)" }}>
                  <Th>Client</Th>
                  <Th align="right">Invoice</Th>
                  <Th align="right">Ads</Th>
                  <Th align="right">Commissions</Th>
                  <Th align="right">Coaching Reserve</Th>
                  <Th align="right">Fulfillment</Th>
                  <Th align="right">Software</Th>
                  <Th align="right">Keep</Th>
                  <Th align="right">Margin</Th>
                  <Th>Source</Th>
                </tr>
              </thead>
              <tbody>
                {finance.client_profit.map((row) => (
                  <tr key={row.client_key} style={{ borderTop: "1px solid var(--border-primary)" }}>
                    <Td>{row.client_name}</Td>
                    <Td align="right">{formatCents(row.invoice_total)}</Td>
                    <Td align="right">{formatCents(row.ad_spend)}</Td>
                    <Td align="right">{formatCents(row.actual_sales_commissions)}</Td>
                    <Td align="right">{formatCents(row.coaching_reserve)}</Td>
                    <Td align="right">{formatCents(row.forecast_fulfillment)}</Td>
                    <Td align="right">{formatCents(row.software_cost_allocated)}</Td>
                    <Td
                      align="right"
                      color={
                        row.estimated_company_keep >= 0
                          ? "var(--success, #10b981)"
                          : "var(--danger, #ef4444)"
                      }
                    >
                      {formatCents(row.estimated_company_keep)}
                    </Td>
                    <Td align="right">{row.margin_pct === null ? "—" : `${row.margin_pct}%`}</Td>
                    <Td>
                      <SourceBadge source={row.invoice_source} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableWrap>
      </Section>

      <Section title="Coaching Budget">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <StatCard
            label="Active Clients"
            value={String(finance.coaching_budget.active_clients)}
            icon={<Users size={16} />}
            sub="Status = active in the coaching roster"
          />
          <StatCard
            label="Coach Payroll (30d)"
            value={formatCents(finance.coaching_budget.coach_payroll_last_30d)}
            icon={<Wallet size={16} />}
            sub="CoreShift Mercury payroll matches, excluding PM bonus"
          />
          <StatCard
            label="PM Base Pay"
            value={formatCents(finance.coaching_budget.product_manager_base_monthly)}
            icon={<Calculator size={16} />}
            sub="Fixed at $2,000 twice per month for now"
          />
          <StatCard
            label="Cost / Active Client"
            value={formatCents(finance.coaching_budget.cost_per_active_client)}
            icon={<PiggyBank size={16} />}
            sub={`Goal ${formatCents(finance.coaching_budget.hard_cap_cost_per_active_client)} · ceiling ${formatCents(finance.coaching_budget.target_cost_per_active_client)}`}
            color={coachingStatusColor(finance.coaching_budget.status)}
          />
        </div>

        <TableWrap>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <tbody>
              <BudgetRow
                label="Total cost last 30 days"
                value={formatCents(finance.coaching_budget.total_cost_last_30d)}
              />
              <BudgetRow
                label="Monthly coaching revenue capacity at $30"
                value={formatCents(finance.coaching_budget.coaching_revenue_capacity)}
              />
              <BudgetRow
                label="Budget room to $24 ceiling"
                value={formatCents(finance.coaching_budget.headroom_to_target)}
                color={
                  finance.coaching_budget.headroom_to_target >= 0
                    ? "var(--success, #10b981)"
                    : "var(--danger, #ef4444)"
                }
              />
              <BudgetRow
                label="Budget room to $21 goal"
                value={formatCents(finance.coaching_budget.headroom_to_hard_cap)}
                color={
                  finance.coaching_budget.headroom_to_hard_cap >= 0
                    ? "var(--success, #10b981)"
                    : "var(--danger, #ef4444)"
                }
              />
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section title="Recommended Moves">
        <div style={{ display: "grid", gap: 10 }}>
          {finance.recommendations.map((item) => (
            <RecommendationCard key={item.title} item={item} />
          ))}
        </div>
      </Section>

      <Section title={`Mercury Month - ${currentMonth.label}`}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <StatCard
            label="Income (MTD)"
            value={formatCents(currentMonth.summary.income)}
            icon={<TrendingUp size={16} />}
            sub={`${currentMonth.summary.by_category.filter((c) => c.income > 0).length} income categories`}
            color="var(--success, #10b981)"
          />
          <StatCard
            label="Expenses (MTD)"
            value={formatCents(currentMonth.summary.expenses)}
            icon={<TrendingDown size={16} />}
            sub={`${currentMonth.summary.tx_count} transactions`}
            color="var(--danger, #ef4444)"
          />
          <StatCard
            label="Net (MTD)"
            value={formatCents(currentMonth.summary.net)}
            icon={<TrendingUp size={16} />}
            sub={currentMonth.summary.net >= 0 ? "Profit" : "Loss"}
            color={
              currentMonth.summary.net >= 0
                ? "var(--success, #10b981)"
                : "var(--danger, #ef4444)"
            }
          />
        </div>

        <div
          style={{
            padding: 16,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-primary)",
            borderRadius: 10,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${trend.length}, 1fr)`,
              gap: 8,
              alignItems: "flex-end",
              height: 180,
              paddingBottom: 8,
            }}
          >
            {trend.map((m) => (
              <div
                key={m.month}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                  height: "100%",
                  justifyContent: "flex-end",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 2,
                    alignItems: "flex-end",
                    height: "100%",
                  }}
                >
                  <div
                    title={`Income: ${formatCents(m.income)}`}
                    style={{
                      width: 10,
                      height: `${(m.income / maxTrendValue) * 100}%`,
                      background: "var(--success, #10b981)",
                      borderRadius: "3px 3px 0 0",
                      minHeight: 2,
                    }}
                  />
                  <div
                    title={`Expenses: ${formatCents(m.expenses)}`}
                    style={{
                      width: 10,
                      height: `${(m.expenses / maxTrendValue) * 100}%`,
                      background: "var(--danger, #ef4444)",
                      borderRadius: "3px 3px 0 0",
                      minHeight: 2,
                    }}
                  />
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
                  {m.month.slice(5)}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              gap: 16,
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 8,
            }}
          >
            <LegendDot color="var(--success, #10b981)" label="Income" />
            <LegendDot color="var(--danger, #ef4444)" label="Expenses" />
          </div>
        </div>
      </Section>

      <Section title={`Spending by Category - ${currentMonth.label}`}>
        <TableWrap>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-primary)" }}>
                <Th>Category</Th>
                <Th align="right">Income</Th>
                <Th align="right">Expenses</Th>
                <Th align="right">Net</Th>
                <Th align="right">Count</Th>
              </tr>
            </thead>
            <tbody>
              {currentMonth.summary.by_category.map((c) => {
                const isOpen = expandedCategory === c.category;
                const txs = categoryTransactions.get(c.category) ?? [];

                return (
                  <Fragment key={c.category}>
                    <tr
                      style={{
                        borderTop: "1px solid var(--border-primary)",
                        cursor: "pointer",
                      }}
                      onClick={() =>
                        setExpandedCategory((current) =>
                          current === c.category ? null : c.category,
                        )
                      }
                    >
                      <Td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span>{c.category}</span>
                        </div>
                      </Td>
                      <Td align="right" color="var(--success, #10b981)">
                        {c.income > 0 ? formatCents(c.income) : "—"}
                      </Td>
                      <Td align="right" color="var(--danger, #ef4444)">
                        {c.expenses > 0 ? formatCents(c.expenses) : "—"}
                      </Td>
                      <Td align="right">{formatCents(c.income - c.expenses)}</Td>
                      <Td align="right">{c.count}</Td>
                    </tr>
                    {isOpen && (
                      <tr style={{ borderTop: "1px solid var(--border-primary)" }}>
                        <Td colSpan={5}>
                          <div style={{ display: "grid", gap: 8 }}>
                            {txs.length === 0 ? (
                              <InlineMeta>No charges found in this category.</InlineMeta>
                            ) : (
                              txs.map((tx) => (
                                <div
                                  key={tx.mercury_id}
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "110px minmax(0, 1fr) 120px",
                                    gap: 12,
                                    alignItems: "center",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    background: "var(--bg-primary)",
                                  }}
                                >
                                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                    {tx.posted_at ? tx.posted_at.slice(0, 10) : "—"}
                                  </span>
                                  <span style={{ color: "var(--text-secondary)" }}>
                                    {tx.counterparty ?? tx.description ?? "—"}
                                  </span>
                                  <span
                                    style={{
                                      textAlign: "right",
                                      color:
                                        tx.amount >= 0
                                          ? "var(--success, #10b981)"
                                          : "var(--danger, #ef4444)",
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                    {tx.amount >= 0 ? "+" : "−"}
                                    {formatCents(Math.abs(tx.amount))}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        </Td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {currentMonth.summary.by_category.length === 0 && (
                <tr>
                  <Td colSpan={5} align="center" color="var(--text-muted)">
                    No transactions yet this month.
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section title="Transactions">
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as "all" | "income" | "expense")}
            className="form-input"
            style={{ width: 160 }}
          >
            <option value="all">All kinds</option>
            <option value="income">Income only</option>
            <option value="expense">Expenses only</option>
          </select>
        </div>
        <TableWrap>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-primary)" }}>
                <Th>Date</Th>
                <Th>Counterparty</Th>
                <Th>Category</Th>
                <Th align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {filteredTxs.slice(0, 100).map((tx) => (
                <tr key={tx.mercury_id} style={{ borderTop: "1px solid var(--border-primary)" }}>
                  <Td>{tx.posted_at ? tx.posted_at.slice(0, 10) : "—"}</Td>
                  <Td>{tx.counterparty ?? tx.description ?? "—"}</Td>
                  <Td>{tx.category}</Td>
                  <Td
                    align="right"
                    color={
                      tx.amount >= 0
                        ? "var(--success, #10b981)"
                        : "var(--danger, #ef4444)"
                    }
                  >
                    {tx.amount >= 0 ? "+" : "−"}
                    {formatCents(Math.abs(tx.amount))}
                  </Td>
                </tr>
              ))}
              {filteredTxs.length === 0 && (
                <tr>
                  <Td colSpan={4} align="center" color="var(--text-muted)">
                    No transactions match filters.
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
          {filteredTxs.length > 100 && (
            <div
              style={{
                padding: 10,
                textAlign: "center",
                fontSize: 12,
                color: "var(--text-muted)",
                borderTop: "1px solid var(--border-primary)",
              }}
            >
              Showing first 100 of {filteredTxs.length} transactions
            </div>
          )}
        </TableWrap>
      </Section>

      <Section title="Monthly Reports">
        <TableWrap>
          {storedReports.length === 0 ? (
            <EmptyState
              icon={<FileText size={20} />}
              text="No reports yet. One will generate automatically on the 1st of next month."
            />
          ) : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg-primary)" }}>
                  <Th>Period</Th>
                  <Th>Account</Th>
                  <Th align="right">Opening</Th>
                  <Th align="right">Closing</Th>
                  <Th align="right">Income</Th>
                  <Th align="right">Expenses</Th>
                  <Th align="right">Net</Th>
                </tr>
              </thead>
              <tbody>
                {storedReports.map((r) => (
                  <tr key={`${r.account}-${r.period_start}`} style={{ borderTop: "1px solid var(--border-primary)" }}>
                    <Td>{r.period_start.slice(0, 7)}</Td>
                    <Td>{r.account}</Td>
                    <Td align="right">{formatCents(r.opening_balance)}</Td>
                    <Td align="right">{formatCents(r.closing_balance)}</Td>
                    <Td align="right" color="var(--success, #10b981)">
                      {formatCents(r.income)}
                    </Td>
                    <Td align="right" color="var(--danger, #ef4444)">
                      {formatCents(r.expenses)}
                    </Td>
                    <Td
                      align="right"
                      color={r.net >= 0 ? "var(--success, #10b981)" : "var(--danger, #ef4444)"}
                    >
                      {formatCents(r.net)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableWrap>
      </Section>

      <details
        style={{
          marginTop: 24,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-primary)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            listStyle: "none",
            padding: "16px 18px",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          Legend
        </summary>
        <div style={{ padding: "0 18px 18px" }}>
          <div style={{ display: "grid", gap: 10 }}>
            {finance.legend.map((item) => (
              <LegendItemView key={item.term} item={item} />
            ))}
          </div>
        </div>
      </details>

      <style jsx>{`
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

function payoutKey(row: UpcomingPayoutRow): string {
  return `${row.due_date}-${row.category}-${row.payee}-${row.client_name ?? "none"}`;
}

function coachingStatusColor(status: "on_target" | "above_target" | "above_hard_cap") {
  if (status === "on_target") return "var(--success, #10b981)";
  if (status === "above_target") return "var(--warning, #f59e0b)";
  return "var(--danger, #ef4444)";
}

function coachingStatusCopy(status: "on_target" | "above_target" | "above_hard_cap") {
  if (status === "on_target") return "Under the $21 goal";
  if (status === "above_target") return "Under $24, above $21";
  return "Above the $24 ceiling";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text-secondary)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: 10,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-primary)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div
      style={{
        padding: 20,
        textAlign: "center",
        fontSize: 13,
        color: "var(--text-muted)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      {icon}
      <div>{text}</div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  sub,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-primary)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {icon}
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: color ?? "var(--text-primary)",
          marginTop: 6,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        border: "1px solid var(--border-primary)",
        background: "var(--bg-surface)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

function PayoutRowView({ row }: { row: UpcomingPayoutRow }) {
  return (
    <tr style={{ borderTop: "1px solid var(--border-primary)" }}>
      <Td>{row.due_date}</Td>
      <Td>{row.category.replace("_", " ")}</Td>
      <Td>
        <div style={{ display: "grid", gap: 4 }}>
          <span>{row.payee}</span>
          {row.notes.length > 0 && <InlineMeta>{row.notes.join(" ")}</InlineMeta>}
        </div>
      </Td>
      <Td>{row.client_name ?? "—"}</Td>
      <Td align="right">{formatCents(row.amount)}</Td>
      <Td>
        <SourceBadge source={row.source} />
      </Td>
    </tr>
  );
}

function RecommendationCard({ item }: { item: FinanceRecommendation }) {
  const color =
    item.priority === "high"
      ? "var(--danger, #ef4444)"
      : item.priority === "medium"
        ? "var(--warning, #f59e0b)"
        : "var(--accent, #3b82f6)";

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        border: "1px solid var(--border-primary)",
        background: "var(--bg-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 999,
            background: color,
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
          {item.title}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{item.body}</div>
    </div>
  );
}

function LegendItemView({ item }: { item: FinanceLegendItem }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        border: "1px solid var(--border-primary)",
        background: "var(--bg-primary)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
        {item.term}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>
        {item.definition}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
        Calc: {item.formula}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: ClientPeriodPlan["invoice_source"] }) {
  const styles =
    source === "manual"
      ? {
          background: "rgba(59,130,246,0.12)",
          color: "var(--accent, #3b82f6)",
        }
      : source === "live"
        ? {
            background: "rgba(16,185,129,0.12)",
            color: "var(--success, #10b981)",
          }
        : {
            background: "rgba(245,158,11,0.12)",
            color: "var(--warning, #f59e0b)",
          };

  return (
    <span
      style={{
        display: "inline-flex",
        padding: "4px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        textTransform: "capitalize",
        ...styles,
      }}
    >
      {source}
    </span>
  );
}

function BudgetRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <tr style={{ borderTop: "1px solid var(--border-primary)" }}>
      <Td>{label}</Td>
      <Td align="right" color={color}>
        {value}
      </Td>
    </tr>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      <span>{label}</span>
    </div>
  );
}

function InlineMeta({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{children}</div>;
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "10px 12px",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--text-secondary)",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  color,
  colSpan,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  color?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "10px 12px",
        textAlign: align,
        color: color ?? "var(--text-secondary)",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}
