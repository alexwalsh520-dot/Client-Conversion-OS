"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  TrendingUp,
  Loader2,
  Calendar,
  DollarSign,
  CreditCard,
  RefreshCw,
} from "lucide-react";
import { CLIENTS } from "@/lib/mock-data";
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

export default function HomePage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [clientRevenue, setClientRevenue] = useState<Record<string, ClientRevenue>>({});
  const [totalCashCollected, setTotalCashCollected] = useState(0);
  const [totalSubscriptions, setTotalSubscriptions] = useState(0);
  const [totalRetention, setTotalRetention] = useState(0);
  const [totalLastMonth, setTotalLastMonth] = useState(0);

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

      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const lastMonthStart = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
      const lastMonthEndStr = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, "0")}-${String(lastMonthEnd.getDate()).padStart(2, "0")}`;

      const fromDate = new Date(dateFrom + "T00:00:00");
      const retentionMonthIndex = fromDate.getMonth();

      const [thisMonthRes, lastMonthRes, retentionRes] = await Promise.all([
        fetch(`/api/sales-hub/sheet-data?dateFrom=${dateFrom}&dateTo=${dateTo}`),
        fetch(`/api/sales-hub/sheet-data?dateFrom=${lastMonthStart}&dateTo=${lastMonthEndStr}`),
        fetch(`/api/coaching/financials?month=${retentionMonthIndex}`),
      ]);

      const thisMonthData = await thisMonthRes.json();
      const lastMonthData = await lastMonthRes.json();
      const retentionData = await retentionRes.json();

      const thisMonthRows = thisMonthData.rows || [];
      const lastMonthRows = lastMonthData.rows || [];
      const subscriptionsSold = thisMonthData.subscriptionsSold || 0;

      const retentions = retentionData.retentions || [];
      let retentionTotal = 0;
      for (const r of retentions) {
        retentionTotal += r.paymentTotal || 0;
      }

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

  const totalRevenue = totalCashCollected + totalSubscriptions + totalRetention;
  const growthPercent = totalLastMonth > 0
    ? (((totalCashCollected - totalLastMonth) / totalLastMonth) * 100).toFixed(1)
    : "0.0";
  const isGrowthPositive = totalCashCollected >= totalLastMonth;

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

      {/* Revenue Overview */}
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
    </div>
  );
}
