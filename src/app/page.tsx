"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  Phone,
  Dumbbell,
  Users,
  Megaphone,
  ChevronDown,
  ChevronUp,
  Brain,
  Loader2,
} from "lucide-react";
import { CLIENTS } from "@/lib/mock-data";
import { generateBriefing } from "@/lib/intelligence-engine";
import { fmtDollars } from "@/lib/formatters";

// Map offer column values to CLIENTS keys
function offerToClientKey(offer: string): string | null {
  const lower = offer.toLowerCase();
  if (lower.includes("keith")) return "keith";
  if (lower.includes("tyson")) return "tyson";
  if (lower.includes("zoe") || lower.includes("emily")) return "zoeEmily";
  return null;
}

interface ClientRevenue {
  thisMonth: number;
  lastMonth: number;
}

interface MonthlyChartEntry {
  month: string;
  [key: string]: string | number; // client keys + total
}

export default function HomePage() {
  const { data: session } = useSession();
  const [briefingOpen, setBriefingOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [clientRevenue, setClientRevenue] = useState<Record<string, ClientRevenue>>({});
  const [totalThisMonth, setTotalThisMonth] = useState(0);
  const [totalLastMonth, setTotalLastMonth] = useState(0);
  const [monthlyData, setMonthlyData] = useState<MonthlyChartEntry[]>([]);

  const userName = session?.user?.name?.split(" ")[0] || "there";
  const now = new Date();
  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 17
        ? "Good afternoon"
        : "Good evening";
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const briefing = generateBriefing();

  const fetchRevenue = useCallback(async () => {
    try {
      setLoading(true);

      // This month range
      const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      // Last month range
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const lastMonthStart = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
      const lastMonthEndStr = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, "0")}-${String(lastMonthEnd.getDate()).padStart(2, "0")}`;

      // Fetch last 6 months for chart (from 5 months ago to today)
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const chartStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;

      const [thisMonthRes, lastMonthRes, chartRes] = await Promise.all([
        fetch(`/api/sales-hub/sheet-data?dateFrom=${thisMonthStart}&dateTo=${today}`),
        fetch(`/api/sales-hub/sheet-data?dateFrom=${lastMonthStart}&dateTo=${lastMonthEndStr}`),
        fetch(`/api/sales-hub/sheet-data?dateFrom=${chartStart}&dateTo=${today}`),
      ]);

      const thisMonthData = await thisMonthRes.json();
      const lastMonthData = await lastMonthRes.json();
      const chartData = await chartRes.json();

      const thisMonthRows = thisMonthData.rows || [];
      const lastMonthRows = lastMonthData.rows || [];
      const chartRows = chartData.rows || [];

      // Calculate per-client cash collected for this month
      const clientKeys = Object.keys(CLIENTS);
      const perClient: Record<string, ClientRevenue> = {};
      for (const key of clientKeys) {
        perClient[key] = { thisMonth: 0, lastMonth: 0 };
      }

      let totalThis = 0;
      let totalLast = 0;

      for (const row of thisMonthRows) {
        const cash = row.cashCollected || 0;
        const clientKey = offerToClientKey(row.offer || "");
        totalThis += cash;
        if (clientKey && perClient[clientKey]) {
          perClient[clientKey].thisMonth += cash;
        }
      }

      for (const row of lastMonthRows) {
        const cash = row.cashCollected || 0;
        const clientKey = offerToClientKey(row.offer || "");
        totalLast += cash;
        if (clientKey && perClient[clientKey]) {
          perClient[clientKey].lastMonth += cash;
        }
      }

      setClientRevenue(perClient);
      setTotalThisMonth(totalThis);
      setTotalLastMonth(totalLast);

      // Build monthly chart data
      const monthMap: Record<string, Record<string, number>> = {};
      for (const row of chartRows) {
        const cash = row.cashCollected || 0;
        if (cash === 0) continue;
        // Extract YYYY-MM from date
        const monthKey = (row.date || "").substring(0, 7);
        if (!monthKey) continue;
        if (!monthMap[monthKey]) {
          monthMap[monthKey] = {};
          for (const k of clientKeys) monthMap[monthKey][k] = 0;
          monthMap[monthKey].total = 0;
        }
        const clientKey = offerToClientKey(row.offer || "");
        monthMap[monthKey].total = (monthMap[monthKey].total || 0) + cash;
        if (clientKey) {
          monthMap[monthKey][clientKey] = (monthMap[monthKey][clientKey] || 0) + cash;
        }
      }

      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const chartEntries: MonthlyChartEntry[] = Object.keys(monthMap)
        .sort()
        .map((key) => {
          const [, m] = key.split("-");
          const monthIdx = parseInt(m, 10) - 1;
          return {
            month: monthNames[monthIdx] || key,
            ...monthMap[key],
          };
        });

      setMonthlyData(chartEntries);
    } catch (err) {
      console.error("Failed to fetch revenue data:", err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchRevenue();
  }, [fetchRevenue]);

  const growthPercent = totalLastMonth > 0
    ? (((totalThisMonth - totalLastMonth) / totalLastMonth) * 100).toFixed(1)
    : "0.0";
  const isGrowthPositive = totalThisMonth >= totalLastMonth;

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">
          {greeting}, <span className="gradient-text">{userName}</span>
        </h1>
        <p className="page-subtitle">{dateStr}</p>
      </div>

      {/* Revenue Strip */}
      <div className="section">
        <h2 className="section-title">
          <TrendingUp size={16} />
          Revenue Overview
        </h2>

        {loading ? (
          <div className="glass-static metric-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 size={24} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
            <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 14 }}>Loading from sales tracker...</span>
          </div>
        ) : (
          <>
            <div className="glass-static metric-card" style={{ marginBottom: 12 }}>
              <div className="metric-card-label">Total Client Revenue (Cash Collected)</div>
              <div className="metric-card-value" style={{ fontSize: 32 }}>
                {fmtDollars(totalThisMonth)}
              </div>
              <div className={`metric-card-trend ${isGrowthPositive ? "metric-card-trend-up" : "metric-card-trend-down"}`}>
                {isGrowthPositive ? "+" : ""}{growthPercent}% vs last month
              </div>
            </div>
            <div className="metric-grid metric-grid-3">
              {Object.entries(CLIENTS).map(([key, client]) => {
                const rev = clientRevenue[key]?.thisMonth ?? 0;
                return (
                  <div key={key} className="glass-static metric-card">
                    <div className="metric-card-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: client.color, display: "inline-block" }} />
                      {client.name}
                    </div>
                    <div className="metric-card-value">{fmtDollars(rev)}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Revenue Chart */}
      {!loading && monthlyData.length > 0 && (
        <div className="section">
          <div className="glass-static" style={{ padding: 20 }}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={((value: number) => [fmtDollars(value), ""]) as any}
                  contentStyle={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                  }}
                />
                {Object.entries(CLIENTS).map(([key, client]) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stackId="1"
                    stroke={client.color}
                    fill={client.color + "30"}
                    name={client.name}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="section">
        <h2 className="section-title">Quick Actions</h2>
        <div className="metric-grid metric-grid-4">
          <Link href="/sales" className="glass action-card">
            <div
              className="action-card-icon"
              style={{ background: "var(--accent-soft)" }}
            >
              <Phone size={18} style={{ color: "var(--accent)" }} />
            </div>
            <div className="action-card-title">Sales Pipeline</div>
            <div className="action-card-desc">
              Track calls, closers, and setter performance
            </div>
          </Link>
          <Link href="/coaching" className="glass action-card">
            <div
              className="action-card-icon"
              style={{ background: "var(--success-soft)" }}
            >
              <Dumbbell size={18} style={{ color: "var(--success)" }} />
            </div>
            <div className="action-card-title">Coaching Hub</div>
            <div className="action-card-desc">
              Coach performance, client feedback, NPS
            </div>
          </Link>
          <Link href="/onboarding" className="glass action-card">
            <div
              className="action-card-icon"
              style={{ background: "var(--warning-soft)" }}
            >
              <Users size={18} style={{ color: "var(--warning)" }} />
            </div>
            <div className="action-card-title">Onboarding</div>
            <div className="action-card-desc">
              Pipeline tracker, ghosted clients, at-risk alerts
            </div>
          </Link>
          <Link href="/ads" className="glass action-card">
            <div
              className="action-card-icon"
              style={{ background: "var(--tyson-soft)" }}
            >
              <Megaphone size={18} style={{ color: "var(--tyson)" }} />
            </div>
            <div className="action-card-title">Ad Performance</div>
            <div className="action-card-desc">
              Spend, ROI, CPL, Keith vs Tyson breakdown
            </div>
          </Link>
        </div>
      </div>

      {/* AI Briefing */}
      <div className="section">
        <button
          className="section-title"
          onClick={() => setBriefingOpen(!briefingOpen)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            width: "100%",
            fontFamily: "inherit",
          }}
        >
          <Brain size={16} />
          AI Briefing
          {briefingOpen ? (
            <ChevronUp size={14} />
          ) : (
            <ChevronDown size={14} />
          )}
        </button>
        {briefingOpen && (
          <div className="glass-static">
            <div className="briefing-text">{briefing}</div>
          </div>
        )}
      </div>
    </div>
  );
}
