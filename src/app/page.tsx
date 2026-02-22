"use client";

import { useState } from "react";
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
} from "lucide-react";
import { revenueData, revenueByMonth } from "@/lib/mock-data";
import { generateBriefing } from "@/lib/intelligence-engine";
import { fmtDollars } from "@/lib/formatters";

export default function HomePage() {
  const { data: session } = useSession();
  const [briefingOpen, setBriefingOpen] = useState(true);

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
        <div className="metric-grid metric-grid-3">
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total Revenue</div>
            <div className="metric-card-value">
              {fmtDollars(revenueData.total.thisMonth)}
            </div>
            <div className="metric-card-trend metric-card-trend-up">
              +{revenueData.total.growthPercent}% vs last month
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Keith</div>
            <div className="metric-card-value">
              {fmtDollars(revenueData.keith.thisMonth)}
            </div>
            <div className="metric-card-trend metric-card-trend-up">
              {revenueData.keith.activeSubscriptions} active subs
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Tyson</div>
            <div className="metric-card-value">
              {fmtDollars(revenueData.tyson.combined.thisMonth)}
            </div>
            <div className="metric-card-trend metric-card-trend-up">
              {revenueData.tyson.combined.activeSubscriptions} active subs
            </div>
          </div>
        </div>
      </div>

      {/* Revenue Chart */}
      <div className="section">
        <div className="glass-static" style={{ padding: 20 }}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={revenueByMonth}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(v: number) => `$${v / 1000}K`} />
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
