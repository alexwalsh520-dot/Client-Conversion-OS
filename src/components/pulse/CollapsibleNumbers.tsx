"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import MetricBadge from "@/components/shared/MetricBadge";
import {
  revenueData,
  monthlyRevenue,
  adPerformance,
  coachPerformance,
  coachingData,
} from "@/lib/mock-data";

export default function CollapsibleNumbers() {
  const [isOpen, setIsOpen] = useState(false);

  const totalClients =
    coachingData.keith.activeClients + coachingData.tyson.activeClients;
  const avgRating = (
    coachPerformance.reduce((s, c) => s + c.avgRating, 0) /
    coachPerformance.length
  ).toFixed(1);
  const totalSpend = adPerformance.keith.spend + adPerformance.tyson.spend;
  const totalAdRev = adPerformance.keith.revenue + adPerformance.tyson.revenue;
  const roi = Math.round((totalAdRev / totalSpend) * 100);

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          padding: 12,
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "1px",
          color: "var(--text-muted)",
          background: "none",
          border: "none",
          cursor: "pointer",
          transition: "color 0.15s ease",
        }}
      >
        {isOpen ? "Hide numbers" : "View full numbers"}
        <ChevronDown
          size={14}
          style={{
            transition: "transform 0.3s ease",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      <div
        style={{
          maxHeight: isOpen ? 600 : 0,
          opacity: isOpen ? 1 : 0,
          overflow: "hidden",
          transition: "max-height 0.4s ease, opacity 0.3s ease",
        }}
      >
        <div className="glass" style={{ padding: 24 }}>
          {/* KPI Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 24,
              marginBottom: 24,
            }}
          >
            <MetricBadge
              label="Revenue"
              value={`$${(revenueData.total.thisMonth / 1000).toFixed(1)}K`}
              trend={{
                value: `+${revenueData.total.growthPercent}%`,
                trend: "up",
                isGood: true,
              }}
            />
            <MetricBadge
              label="Ad Spend"
              value={`$${totalSpend.toLocaleString()}`}
            />
            <MetricBadge label="Blended ROI" value={`${roi}%`} />
            <MetricBadge label="New Clients" value="53" />
            <MetricBadge
              label="Active Clients"
              value={String(totalClients)}
            />
            <MetricBadge label="Avg Coach Rating" value={`${avgRating}/10`} />
          </div>

          {/* Mini Revenue Chart */}
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyRevenue}>
                <defs>
                  <linearGradient
                    id="revGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--accent)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--accent)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number | undefined) => [
                    `$${((value ?? 0) / 1000).toFixed(1)}K`,
                    "Revenue",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#revGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
