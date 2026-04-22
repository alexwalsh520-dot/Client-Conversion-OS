"use client";

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from "react";
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
  Calendar,
  DollarSign,
  CreditCard,
  RefreshCw,
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

function formatDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface ClientRevenue {
  thisMonth: number;
  lastMonth: number;
  subscriptions?: number;
}

interface MonthlyChartEntry {
  month: string;
  [key: string]: string | number; // client keys + total
}

interface BusinessMetricValues {
  gp30: number | null;
  cac: number | null;
  ltgp: number | null;
  capacityPct: number | null;
}

interface BusinessMetricBreakdown {
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

interface BusinessMetricsCardData {
  key: "total" | keyof typeof CLIENTS;
  label: string;
  state: "live" | "needs_setup";
  metrics: BusinessMetricValues;
  notes: string[];
  breakdown?: BusinessMetricBreakdown;
}

interface BusinessMetricsResponse {
  cards: BusinessMetricsCardData[];
  syncedAt: string | null;
  missingSetup: string[];
}

function isClientBusinessCard(
  card: BusinessMetricsCardData,
): card is BusinessMetricsCardData & { key: keyof typeof CLIENTS } {
  return card.key !== "total";
}

export default function HomePage() {
  const { data: session } = useSession();
  const [briefingOpen, setBriefingOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [businessMetricsLoading, setBusinessMetricsLoading] = useState(true);
  const [businessMetrics, setBusinessMetrics] = useState<BusinessMetricsResponse | null>(null);
  const [clientRevenue, setClientRevenue] = useState<Record<string, ClientRevenue>>({});
  const [totalCashCollected, setTotalCashCollected] = useState(0);
  const [totalSubscriptions, setTotalSubscriptions] = useState(0);
  const [totalRetention, setTotalRetention] = useState(0);
  const [totalLastMonth, setTotalLastMonth] = useState(0);
  const [monthlyData, setMonthlyData] = useState<MonthlyChartEntry[]>([]);

  // Date range state
  const now = useMemo(() => new Date(), []);
  const mtdStart = useMemo(() => formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1)), [now]);
  const todayStr = useMemo(() => formatDateInput(now), [now]);

  const [dateFrom, setDateFrom] = useState(mtdStart);
  const [dateTo, setDateTo] = useState(todayStr);
  const [isMTD, setIsMTD] = useState(true);

  const userName = session?.user?.name?.split(" ")[0] || "there";
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

  const handleMTD = () => {
    setDateFrom(mtdStart);
    setDateTo(todayStr);
    setIsMTD(true);
  };

  const handleDateFromChange = (val: string) => {
    setDateFrom(val);
    setIsMTD(val === mtdStart && dateTo === todayStr);
  };

  const handleDateToChange = (val: string) => {
    setDateTo(val);
    setIsMTD(dateFrom === mtdStart && val === todayStr);
  };

  const fetchRevenue = useCallback(async () => {
    try {
      setLoading(true);

      // Last month range (for comparison)
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const lastMonthStart = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
      const lastMonthEndStr = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, "0")}-${String(lastMonthEnd.getDate()).padStart(2, "0")}`;

      // Fetch last 6 months for chart (from 5 months ago to today)
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const chartStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;

      // Determine which month index to use for retention (based on dateFrom)
      const fromDate = new Date(dateFrom + "T00:00:00");
      const retentionMonthIndex = fromDate.getMonth();

      const [thisMonthRes, lastMonthRes, chartRes, retentionRes] = await Promise.all([
        fetch(`/api/sales-hub/sheet-data?dateFrom=${dateFrom}&dateTo=${dateTo}`),
        fetch(`/api/sales-hub/sheet-data?dateFrom=${lastMonthStart}&dateTo=${lastMonthEndStr}`),
        fetch(`/api/sales-hub/sheet-data?dateFrom=${chartStart}&dateTo=${todayStr}`),
        fetch(`/api/coaching/financials?month=${retentionMonthIndex}`),
      ]);

      const thisMonthData = await thisMonthRes.json();
      const lastMonthData = await lastMonthRes.json();
      const chartData = await chartRes.json();
      const retentionData = await retentionRes.json();

      const thisMonthRows = thisMonthData.rows || [];
      const lastMonthRows = lastMonthData.rows || [];
      const chartRows = chartData.rows || [];
      const subscriptionsSold = thisMonthData.subscriptionsSold || 0;

      // Sum retention payments
      const retentions = retentionData.retentions || [];
      let retentionTotal = 0;
      for (const r of retentions) {
        retentionTotal += r.paymentTotal || 0;
      }

      // Calculate per-client cash collected for selected range
      const clientKeys = Object.keys(CLIENTS);
      const perClient: Record<string, ClientRevenue> = {};
      for (const key of clientKeys) {
        perClient[key] = { thisMonth: 0, lastMonth: 0, subscriptions: 0 };
      }

      let totalCash = 0;
      let totalLast = 0;

      for (const row of thisMonthRows) {
        const cash = row.cashCollected || 0;
        const clientKey = offerToClientKey(row.offer || "");
        totalCash += cash;
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
      setTotalCashCollected(totalCash);
      setTotalSubscriptions(subscriptionsSold);
      setTotalRetention(retentionTotal);
      setTotalLastMonth(totalLast);

      // Build monthly chart data
      const monthMap: Record<string, Record<string, number>> = {};
      for (const row of chartRows) {
        const cash = row.cashCollected || 0;
        if (cash === 0) continue;
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
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchRevenue();
  }, [fetchRevenue]);

  const fetchBusinessMetrics = useCallback(async () => {
    try {
      setBusinessMetricsLoading(true);
      const res = await fetch("/api/home/business-metrics");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load business metrics");
      }
      setBusinessMetrics(data);
    } catch (err) {
      console.error("Failed to fetch business metrics:", err);
      setBusinessMetrics(null);
    } finally {
      setBusinessMetricsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBusinessMetrics();
  }, [fetchBusinessMetrics]);

  const totalRevenue = totalCashCollected + totalSubscriptions + totalRetention;
  const growthPercent = totalLastMonth > 0
    ? (((totalCashCollected - totalLastMonth) / totalLastMonth) * 100).toFixed(1)
    : "0.0";
  const isGrowthPositive = totalCashCollected >= totalLastMonth;
  const totalBusinessMetrics = businessMetrics?.cards.find((card) => card.key === "total");
  const perClientBusinessMetrics: Array<
    BusinessMetricsCardData & { key: keyof typeof CLIENTS }
  > = businessMetrics?.cards.filter(isClientBusinessCard) ?? [];

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">
          {greeting}, <span className="gradient-text">{userName}</span>
        </h1>
        <p className="page-subtitle">{dateStr}</p>
      </div>

      {/* Date Range Selector */}
      <div className="section" style={{ marginBottom: 8 }}>
        <div
          className="glass-static"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            flexWrap: "wrap",
          }}
        >
          <Calendar size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />

          <button
            onClick={handleMTD}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: isMTD ? "1px solid var(--accent)" : "1px solid var(--border-primary)",
              background: isMTD ? "var(--accent)" : "var(--bg-glass)",
              color: isMTD ? "#fff" : "var(--text-primary)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            Month to Date
          </button>

          <div
            style={{
              width: 1,
              height: 20,
              background: "var(--border-primary)",
              flexShrink: 0,
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, color: "var(--text-muted)" }}>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleDateFromChange(e.target.value)}
              style={{
                padding: "5px 10px",
                borderRadius: 8,
                border: "1px solid var(--border-primary)",
                background: "var(--bg-card)",
                color: "var(--text-primary)",
                fontSize: 13,
                fontFamily: "inherit",
                outline: "none",
                colorScheme: "dark",
              }}
            />
            <label style={{ fontSize: 13, color: "var(--text-muted)" }}>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleDateToChange(e.target.value)}
              style={{
                padding: "5px 10px",
                borderRadius: 8,
                border: "1px solid var(--border-primary)",
                background: "var(--bg-card)",
                color: "var(--text-primary)",
                fontSize: 13,
                fontFamily: "inherit",
                outline: "none",
                colorScheme: "dark",
              }}
            />
          </div>
        </div>
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
            {/* Total Revenue Card */}
            <div className="glass-static metric-card" style={{ marginBottom: 12 }}>
              <div className="metric-card-label">Total Revenue</div>
              <div className="metric-card-value" style={{ fontSize: 32 }}>
                {fmtDollars(totalRevenue)}
              </div>
              <div className={`metric-card-trend ${isGrowthPositive ? "metric-card-trend-up" : "metric-card-trend-down"}`}>
                {isGrowthPositive ? "+" : ""}{growthPercent}% cash collected vs last month
              </div>
            </div>

            {/* Three Revenue Breakdown Cards */}
            <div className="metric-grid metric-grid-3" style={{ marginBottom: 12 }}>
              <div className="glass-static metric-card">
                <div className="metric-card-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <DollarSign size={14} style={{ color: "var(--success)" }} />
                  Cash Collected
                </div>
                <div className="metric-card-value">{fmtDollars(totalCashCollected)}</div>
              </div>
              <div className="glass-static metric-card">
                <div className="metric-card-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <CreditCard size={14} style={{ color: "var(--accent)" }} />
                  New Subscriptions
                </div>
                <div className="metric-card-value">{totalSubscriptions}</div>
              </div>
              <div className="glass-static metric-card">
                <div className="metric-card-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <RefreshCw size={14} style={{ color: "var(--warning)" }} />
                  Retention Revenue
                </div>
                <div className="metric-card-value">{fmtDollars(totalRetention)}</div>
              </div>
            </div>

            {/* Per-Client Cards */}
            <div className="metric-grid metric-grid-3">
              {Object.entries(CLIENTS).map(([key, client]) => {
                const rev = clientRevenue[key]?.thisMonth ?? 0;
                const subs = clientRevenue[key]?.subscriptions;
                return (
                  <div key={key} className="glass-static metric-card">
                    <div className="metric-card-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: client.color, display: "inline-block" }} />
                      {client.name}
                    </div>
                    <div className="metric-card-value">{fmtDollars(rev)}</div>
                    {subs !== undefined && subs > 0 && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                        {subs} subscription{subs !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="section">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <h2 className="section-title" style={{ marginBottom: 0 }}>
            <TrendingUp size={16} />
            Client Business Metrics
          </h2>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {businessMetrics?.syncedAt
              ? `Last sync ${new Date(businessMetrics.syncedAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : "Last 30 days"}
            {" · "}
            <Link href="/mozi-metrics/settings" style={{ color: "var(--accent)" }}>
              Setup
            </Link>
          </div>
        </div>

        {businessMetricsLoading ? (
          <div className="glass-static metric-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 size={24} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
            <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 14 }}>Loading business metrics...</span>
          </div>
        ) : (
          <>
            {totalBusinessMetrics && (
              <BusinessMetricsCard
                card={totalBusinessMetrics}
                accent="var(--accent)"
                style={{ marginBottom: 12 }}
              />
            )}

            <div className="metric-grid metric-grid-3">
              {perClientBusinessMetrics.map((card) => {
                const accent = CLIENTS[card.key].color;

                return (
                  <BusinessMetricsCard
                    key={card.key}
                    card={card}
                    accent={accent}
                  />
                );
              })}
            </div>

            {businessMetrics && businessMetrics.missingSetup.length > 0 && (
              <div
                className="glass-static"
                style={{
                  marginTop: 12,
                  padding: "14px 16px",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)" }}>
                  Still Needed
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                  {businessMetrics.missingSetup.join(" • ")}
                </div>
              </div>
            )}
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

function BusinessMetricsCard({
  card,
  accent,
  style,
}: {
  card: BusinessMetricsCardData;
  accent: string;
  style?: CSSProperties;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const noteLines = Array.from(new Set(card.notes)).filter(Boolean);

  return (
    <div className="glass-static" style={{ padding: 18, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: accent,
              display: "inline-block",
            }}
          />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
              {card.label}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Last 30 days
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              padding: "4px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: card.state === "live" ? "rgba(34,197,94,0.14)" : "rgba(245,158,11,0.14)",
              color: card.state === "live" ? "var(--success)" : "var(--warning)",
            }}
          >
            {card.state === "live" ? "Live" : "Needs setup"}
          </div>
          {card.breakdown && (
            <button
              onClick={() => setReportOpen((v) => !v)}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                background: "rgba(255,255,255,0.04)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-primary)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {reportOpen ? "Hide report" : "Generate report"}
            </button>
          )}
        </div>
      </div>

      <div className="metric-grid metric-grid-4" style={{ marginTop: 16 }}>
        <BusinessMetricStat label="30-Day GP" value={fmtCentsMetric(card.metrics.gp30)} hint="Per new client" />
        <BusinessMetricStat label="CAC" value={fmtCentsMetric(card.metrics.cac)} hint="Cost to acquire" />
        <BusinessMetricStat label="LTGP" value={fmtCentsMetric(card.metrics.ltgp)} hint="Per client" />
        <BusinessMetricStat label="Capacity" value={fmtCapacityMetric(card.metrics.capacityPct)} hint="Fulfillment room" />
      </div>

      {noteLines.length > 0 && (
        <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
          {noteLines.map((note) => (
            <div key={note} style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {note}
            </div>
          ))}
        </div>
      )}

      {reportOpen && card.breakdown && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
            display: "grid",
            gap: 6,
            fontSize: 13,
          }}
        >
          <BreakdownRow label="New clients (last 30d)" value={String(card.breakdown.newClientCount)} />
          <BreakdownRow label="Cohort first-30-day revenue" value={fmtCentsMetric(card.breakdown.cohortRevenueCents)} />
          <BreakdownRow label="Direct costs per new client" value={fmtCentsMetric(card.breakdown.directCostsPerNewClientCents)} />
          <BreakdownRow label="→ 30-Day GP per new client" value={fmtCentsMetric(card.breakdown.gp30Cents)} bold />
          <div style={{ height: 4 }} />
          <BreakdownRow label="CAC — Meta ad spend" value={fmtCentsMetric(card.breakdown.cacAdSpendCents)} />
          <BreakdownRow label="CAC — Mercury acquisition SaaS" value={fmtCentsMetric(card.breakdown.cacMercurySoftwareCents)} />
          <BreakdownRow label="CAC — Setter + closer commissions" value={fmtCentsMetric(card.breakdown.cacSalesCommissionsCents)} />
          <BreakdownRow label="CAC — Total (30d)" value={fmtCentsMetric(card.breakdown.cacTotalCents)} />
          <BreakdownRow
            label="→ CAC per new client"
            value={fmtCentsMetric(card.breakdown.newClientCount > 0 ? Math.round(card.breakdown.cacTotalCents / card.breakdown.newClientCount) : 0)}
            bold
          />
          <div style={{ height: 4 }} />
          <BreakdownRow label="Active clients" value={String(card.breakdown.activeClients)} />
          <BreakdownRow label="Monthly GP per active client" value={fmtCentsMetric(card.breakdown.monthlyGpPerActiveClientCents)} />
          <BreakdownRow label="→ LTGP" value={fmtCentsMetric(card.metrics.ltgp)} bold />
        </div>
      )}
    </div>
  );
}

function BreakdownRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: bold ? "var(--text-primary)" : "var(--text-muted)", fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ color: "var(--text-primary)", fontWeight: bold ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function BusinessMetricStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)" }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
        {value}
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)" }}>
        {hint}
      </div>
    </div>
  );
}

function fmtCentsMetric(value: number | null): string {
  if (value === null) return "—";
  return fmtDollars(Math.round(value / 100));
}

function fmtCapacityMetric(value: number | null): string {
  if (value === null) return "—";
  return `${value}%`;
}
