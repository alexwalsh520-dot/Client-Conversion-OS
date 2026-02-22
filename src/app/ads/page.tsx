"use client";

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
  Megaphone,
  DollarSign,
  Eye,
  Target,
  TrendingUp,
  Brain,
} from "lucide-react";
import { adPerformance, adSpendTrend } from "@/lib/mock-data";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";

export default function AdsPage() {
  // Compute aggregate KPIs
  const totalSpend = adPerformance.keith.spend + adPerformance.tyson.spend;
  const totalImpressions =
    adPerformance.keith.impressions + adPerformance.tyson.impressions;
  const totalLeads = adPerformance.keith.leads + adPerformance.tyson.leads;
  const blendedCPL = totalSpend / totalLeads;
  const totalRevenue =
    adPerformance.keith.revenue + adPerformance.tyson.revenue;
  const blendedROI = Math.round((totalRevenue / totalSpend) * 100);

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Ad Performance</h1>
        <p className="page-subtitle">
          Spend analysis, ROI tracking, Keith vs Tyson breakdown
        </p>
      </div>

      {/* KPI Strip */}
      <div className="section">
        <div className="metric-grid metric-grid-4">
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total Spend</div>
            <div className="metric-card-value">{fmtDollars(totalSpend)}</div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total Impressions</div>
            <div className="metric-card-value">
              {fmtNumber(totalImpressions)}
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Blended CPL</div>
            <div className="metric-card-value">
              ${blendedCPL.toFixed(2)}
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Blended ROI</div>
            <div className="metric-card-value">{blendedROI}%</div>
            <div className="metric-card-trend metric-card-trend-up">
              Strong scaling signal
            </div>
          </div>
        </div>
      </div>

      {/* Keith vs Tyson */}
      <div className="section">
        <h2 className="section-title">
          <Target size={16} />
          Keith vs Tyson
        </h2>
        <div className="metric-grid metric-grid-2">
          {/* Keith */}
          <div className="glass-static" style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "var(--keith)",
                marginBottom: 16,
              }}
            >
              Keith
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
              }}
            >
              <div>
                <div className="metric-card-label">Spend</div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                  }}
                >
                  {fmtDollars(adPerformance.keith.spend)}
                </div>
              </div>
              <div>
                <div className="metric-card-label">Revenue</div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                  }}
                >
                  {fmtDollars(adPerformance.keith.revenue)}
                </div>
              </div>
              <div>
                <div className="metric-card-label">CPL</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}
                >
                  ${adPerformance.keith.cpl.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="metric-card-label">ROAS</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--success)",
                  }}
                >
                  {adPerformance.keith.roas.toFixed(1)}x
                </div>
              </div>
              <div>
                <div className="metric-card-label">Leads</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}
                >
                  {fmtNumber(adPerformance.keith.leads)}
                </div>
              </div>
              <div>
                <div className="metric-card-label">CTR</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}
                >
                  {fmtPercent(adPerformance.keith.ctr)}
                </div>
              </div>
            </div>
          </div>

          {/* Tyson */}
          <div className="glass-static" style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "var(--tyson)",
                marginBottom: 16,
              }}
            >
              Tyson
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
              }}
            >
              <div>
                <div className="metric-card-label">Spend</div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                  }}
                >
                  {fmtDollars(adPerformance.tyson.spend)}
                </div>
              </div>
              <div>
                <div className="metric-card-label">Revenue</div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                  }}
                >
                  {fmtDollars(adPerformance.tyson.revenue)}
                </div>
              </div>
              <div>
                <div className="metric-card-label">CPL</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}
                >
                  ${adPerformance.tyson.cpl.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="metric-card-label">ROAS</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--success)",
                  }}
                >
                  {adPerformance.tyson.roas.toFixed(1)}x
                </div>
              </div>
              <div>
                <div className="metric-card-label">Leads</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}
                >
                  {fmtNumber(adPerformance.tyson.leads)}
                </div>
              </div>
              <div>
                <div className="metric-card-label">CTR</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}
                >
                  {fmtPercent(adPerformance.tyson.ctr)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Spend Trend Chart */}
      <div className="section">
        <h2 className="section-title">
          <TrendingUp size={16} />
          Ad Spend Trend
        </h2>
        <div className="glass-static" style={{ padding: 20 }}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={adSpendTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(v: number) => `$${v}`} />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={((value: number, name: string) => [
                  fmtDollars(value),
                  name.charAt(0).toUpperCase() + name.slice(1),
                ]) as any}
                contentStyle={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                }}
              />
              <Area
                type="monotone"
                dataKey="keith"
                stackId="1"
                stroke="var(--keith)"
                fill="var(--keith-soft)"
                name="Keith"
              />
              <Area
                type="monotone"
                dataKey="tyson"
                stackId="1"
                stroke="var(--tyson)"
                fill="var(--tyson-soft)"
                name="Tyson"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AI Briefing */}
      <div className="section">
        <h2 className="section-title">
          <Brain size={16} />
          Ad Performance Insights
        </h2>
        <div className="glass-static">
          <div className="briefing-text">
            February ad performance is the strongest month to date. Combined
            spend of {fmtDollars(totalSpend)} is generating{" "}
            {fmtDollars(totalRevenue)} in revenue at a {blendedROI}% ROI.
            Both funnels are performing efficiently with CPL under $5.10.
            Keith&apos;s ROAS of {adPerformance.keith.roas.toFixed(1)}x
            slightly edges out Tyson&apos;s{" "}
            {adPerformance.tyson.roas.toFixed(1)}x, but both are well above
            the 3x profitability threshold. This is a strong signal to scale
            spend by 30-50% while maintaining creative quality.
          </div>
        </div>
      </div>
    </div>
  );
}
