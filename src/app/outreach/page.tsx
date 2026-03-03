"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Send,
  Mail,
  MessageCircle,
  Users,
  Activity,
  Zap,
  ArrowRight,
  Clock,
} from "lucide-react";
import {
  topStats,
  pipelineStages,
  activityFeed,
  emailPerformance,
  dmPerformance,
  trendData,
} from "@/lib/outreach-data";
import { fmtNumber, fmtPercent, fmtCompact } from "@/lib/formatters";

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const activityIcons: Record<string, React.ComponentType<{ size?: number }>> = {
  import: Users,
  email: Mail,
  dm: MessageCircle,
  reply: Zap,
  move: ArrowRight,
};

export default function OutreachPage() {
  const chartData = useMemo(
    () =>
      trendData.map((d) => ({
        ...d,
        date: new Date(d.date + "T00:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      })),
    []
  );

  const totalPipelineLeads = pipelineStages
    .filter((s) => s.name !== "Lost")
    .reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">
          <span className="gradient-text">Outreach</span>
        </h1>
        <p className="page-subtitle">
          Automated outreach pipeline — cold email + Instagram DMs
        </p>
      </div>

      {/* ── Section 1: Top-Level Stats ──────────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <Activity size={16} />
          Overview
        </h2>
        <div className="outreach-stats-grid">
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total in Pipeline</div>
            <div className="metric-card-value">
              {fmtNumber(totalPipelineLeads)}
            </div>
            <div className="metric-card-trend metric-card-trend-flat">
              excl. lost leads
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Contacted Today</div>
            <div className="metric-card-value">
              {topStats.leadsContactedToday}
            </div>
            <div className="metric-card-trend metric-card-trend-up">
              +{topStats.leadsContactedToday} new
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Emails Sent Today</div>
            <div className="metric-card-value">
              {fmtNumber(topStats.emailsSentToday)}
            </div>
            <div className="metric-card-trend metric-card-trend-flat">
              new + follow-ups
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">DMs Sent Today</div>
            <div className="metric-card-value">
              {fmtNumber(topStats.dmsSentToday)}
            </div>
            <div className="metric-card-trend metric-card-trend-flat">
              new + follow-ups
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Email Reply Rate</div>
            <div className="metric-card-value">
              {fmtPercent(topStats.emailReplyRate)}
            </div>
            <div className="metric-card-trend metric-card-trend-up">
              industry avg ~2%
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">DM Reply Rate</div>
            <div className="metric-card-value">
              {fmtPercent(topStats.dmReplyRate)}
            </div>
            <div className="metric-card-trend metric-card-trend-up">
              above target
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Active Sequences</div>
            <div className="metric-card-value">
              {fmtNumber(topStats.activeSequences)}
            </div>
            <div className="metric-card-trend metric-card-trend-flat">
              email + DM combined
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 2: Pipeline Overview ────────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <Users size={16} />
          Pipeline
        </h2>
        <div className="glass-static" style={{ padding: 24 }}>
          <div className="outreach-pipeline">
            {pipelineStages.map((stage, i) => (
              <div key={stage.name} className="outreach-pipeline-stage">
                <div
                  className="outreach-pipeline-bar"
                  style={{ background: stage.color }}
                />
                <div className="outreach-pipeline-count">
                  {fmtNumber(stage.count)}
                </div>
                <div className="outreach-pipeline-label">{stage.name}</div>
                {i < pipelineStages.length - 1 && (
                  <div className="outreach-pipeline-arrow">
                    <ArrowRight size={12} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section 3: Activity Feed ────────────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <Clock size={16} />
          Recent Activity
        </h2>
        <div className="glass-static" style={{ padding: 0, overflow: "hidden" }}>
          <div className="outreach-activity-list">
            {activityFeed.map((item, i) => {
              const Icon = activityIcons[item.type] || Activity;
              return (
                <div key={i} className="outreach-activity-item">
                  <div className="outreach-activity-icon">
                    <Icon size={14} />
                  </div>
                  <div className="outreach-activity-message">{item.message}</div>
                  <div className="outreach-activity-time">
                    {timeAgo(item.timestamp)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Section 4: Channel Performance ──────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <Send size={16} />
          Channel Performance
        </h2>
        <div className="metric-grid metric-grid-2">
          {/* Email Performance */}
          <div className="glass-static" style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(107, 140, 255, 0.10)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Mail size={16} style={{ color: "#6b8cff" }} />
              </div>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Email Performance
              </span>
            </div>
            <div className="outreach-channel-stats">
              <div className="outreach-channel-row">
                <span className="outreach-channel-label">Emails Sent</span>
                <span className="outreach-channel-value">
                  {fmtCompact(emailPerformance.sent.total)} /{" "}
                  {fmtNumber(emailPerformance.sent.today)} today
                </span>
              </div>
              <div className="outreach-channel-row">
                <span className="outreach-channel-label">Open Rate</span>
                <span className="outreach-channel-value">
                  {fmtPercent(emailPerformance.openRate)}
                </span>
              </div>
              <div className="outreach-channel-row">
                <span className="outreach-channel-label">Reply Rate</span>
                <span className="outreach-channel-value">
                  {fmtPercent(emailPerformance.replyRate)}
                </span>
              </div>
              <div className="outreach-channel-row">
                <span className="outreach-channel-label">Bounce Rate</span>
                <span className="outreach-channel-value">
                  {fmtPercent(emailPerformance.bounceRate)}
                </span>
              </div>
              <div className="outreach-channel-row">
                <span className="outreach-channel-label">Active Sequences</span>
                <span className="outreach-channel-value">
                  {fmtNumber(emailPerformance.activeSequences)}
                </span>
              </div>
              <div className="outreach-channel-row">
                <span className="outreach-channel-label">Domains Active</span>
                <span className="outreach-channel-value">
                  {emailPerformance.domainsActive}
                </span>
              </div>
            </div>
          </div>

          {/* DM Performance */}
          <div className="glass-static" style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(130, 197, 197, 0.10)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <MessageCircle size={16} style={{ color: "#82c5c5" }} />
              </div>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                DM Performance
              </span>
            </div>
            <div className="outreach-channel-stats">
              <div className="outreach-channel-row">
                <span className="outreach-channel-label">DMs Sent</span>
                <span className="outreach-channel-value">
                  {fmtCompact(dmPerformance.sent.total)} /{" "}
                  {fmtNumber(dmPerformance.sent.today)} today
                </span>
              </div>
              <div className="outreach-channel-row">
                <span className="outreach-channel-label">Reply Rate</span>
                <span className="outreach-channel-value">
                  {fmtPercent(dmPerformance.replyRate)}
                </span>
              </div>
              <div className="outreach-channel-row">
                <span className="outreach-channel-label">Response Rate</span>
                <span className="outreach-channel-value">
                  {fmtPercent(dmPerformance.responseRate)}
                </span>
              </div>
              <div className="outreach-channel-row">
                <span className="outreach-channel-label">Active Sequences</span>
                <span className="outreach-channel-value">
                  {fmtNumber(dmPerformance.activeSequences)}
                </span>
              </div>
              <div className="outreach-channel-row">
                <span className="outreach-channel-label">IG Accounts Active</span>
                <span className="outreach-channel-value">
                  {dmPerformance.igAccountsActive}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 5: 30-Day Trend Chart ───────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <Activity size={16} />
          30-Day Trends
        </h2>
        <div className="glass-static" style={{ padding: 20 }}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(v: number) => fmtCompact(v)} />
              <Tooltip
                contentStyle={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="leadsImported"
                name="Leads Imported"
                stroke="#c9a96e"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="emailsSent"
                name="Emails Sent"
                stroke="#6b8cff"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="dmsSent"
                name="DMs Sent"
                stroke="#82c5c5"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="repliesReceived"
                name="Replies"
                stroke="#7ec9a0"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
