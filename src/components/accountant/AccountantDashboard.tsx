"use client";

import { useMemo, useState } from "react";
import {
  Balance,
  Transaction,
  PeriodSummary,
  MonthlyReport,
  formatCents,
} from "@/lib/accountant-types";
import { TrendingUp, TrendingDown, Wallet, FileText, RefreshCw } from "lucide-react";

interface Props {
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
}

export default function AccountantDashboard({
  balances,
  currentMonth,
  trend,
  storedReports,
}: Props) {
  const [kindFilter, setKindFilter] = useState<"all" | "income" | "expense">("all");
  const [syncing, setSyncing] = useState(false);

  const filteredTxs = useMemo(() => {
    return currentMonth.transactions.filter((tx) => {
      if (kindFilter !== "all" && tx.kind !== kindFilter) return false;
      return true;
    });
  }, [currentMonth.transactions, kindFilter]);

  const totalBalance = balances.reduce((acc, b) => acc + b.balance, 0);
  const maxTrendValue = Math.max(
    ...trend.map((m) => Math.max(m.income, m.expenses)),
    1
  );

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/accountant/sync", { method: "POST" });
      window.location.reload();
    } catch {
      setSyncing(false);
    }
  };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
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
            Live CoreShift LLC (Mercury) · Current period: {currentMonth.label}
          </p>
        </div>
        <button
          className="btn-secondary"
          onClick={handleSync}
          disabled={syncing}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <RefreshCw size={14} className={syncing ? "spin" : ""} />
          {syncing ? "Syncing…" : "Sync Now"}
        </button>
      </div>

      {/* Top-line cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="CoreShift Cash on Hand"
          value={formatCents(totalBalance)}
          icon={<Wallet size={16} />}
          sub={balances[0]?.snapshot_date ? `As of ${balances[0].snapshot_date}` : undefined}
        />
        <StatCard
          label="Income (MTD)"
          value={formatCents(currentMonth.summary.income)}
          icon={<TrendingUp size={16} />}
          sub={`${
            currentMonth.summary.by_category.filter((c) => c.income > 0).length
          } income categories`}
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

      {/* 12-month trend */}
      <Section title="12-Month Trend">
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
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    marginTop: 6,
                  }}
                >
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

      {/* Categories */}
      <Section title={`Spending by Category — ${currentMonth.label}`}>
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-primary)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
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
              {currentMonth.summary.by_category.map((c) => (
                <tr
                  key={c.category}
                  style={{ borderTop: "1px solid var(--border-primary)" }}
                >
                  <Td>{c.category}</Td>
                  <Td align="right" color="var(--success, #10b981)">
                    {c.income > 0 ? formatCents(c.income) : "—"}
                  </Td>
                  <Td align="right" color="var(--danger, #ef4444)">
                    {c.expenses > 0 ? formatCents(c.expenses) : "—"}
                  </Td>
                  <Td align="right">{formatCents(c.income - c.expenses)}</Td>
                  <Td align="right">{c.count}</Td>
                </tr>
              ))}
              {currentMonth.summary.by_category.length === 0 && (
                <tr>
                  <Td colSpan={5} align="center" color="var(--text-muted)">
                    No transactions yet this month.
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Transactions */}
      <Section title="Transactions">
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <select
            value={kindFilter}
            onChange={(e) =>
              setKindFilter(e.target.value as "all" | "income" | "expense")
            }
            className="form-input"
            style={{ width: 160 }}
          >
            <option value="all">All kinds</option>
            <option value="income">Income only</option>
            <option value="expense">Expenses only</option>
          </select>
        </div>
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-primary)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
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
                <tr
                  key={tx.mercury_id}
                  style={{ borderTop: "1px solid var(--border-primary)" }}
                >
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
        </div>
      </Section>

      {/* Stored monthly reports */}
      <Section title="Monthly Reports">
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-primary)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {storedReports.length === 0 ? (
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
              <FileText size={20} />
              <div>No reports yet. One will generate automatically on the 1st of next month.</div>
            </div>
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
                  <tr
                    key={`${r.account}-${r.period_start}`}
                    style={{ borderTop: "1px solid var(--border-primary)" }}
                  >
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
                      color={
                        r.net >= 0
                          ? "var(--success, #10b981)"
                          : "var(--danger, #ef4444)"
                      }
                    >
                      {formatCents(r.net)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>

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
        padding: "10px 12px",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        textAlign: align,
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
        fontSize: 13,
        color: color ?? "var(--text-primary)",
        textAlign: align,
      }}
    >
      {children}
    </td>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: color,
        }}
      />
      {label}
    </div>
  );
}
