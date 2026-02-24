"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Dumbbell,
  Users,
  Star,
  TrendingUp,
  MessageSquare,
  Plus,
} from "lucide-react";
import {
  coachPerformance,
  coachingFeedback as mockFeedback,
  satisfactionTrend,
  eodReports,
} from "@/lib/mock-data";
import { getCoachingFeedback } from "@/lib/data";
import { useAsyncData } from "@/lib/use-data";
import { fmtPercent } from "@/lib/formatters";

export default function CoachingPage() {
  const { data: coachingFeedback } = useAsyncData(getCoachingFeedback, mockFeedback);

  // Compute aggregates from coachPerformance
  const totalActiveClients = coachPerformance.reduce(
    (sum, c) => sum + c.activeClients,
    0
  );
  const avgSatisfaction =
    coachPerformance.reduce((sum, c) => sum + c.avgRating, 0) /
    coachPerformance.length;
  const avgCompletion =
    coachPerformance.reduce((sum, c) => sum + c.completionRate, 0) /
    coachPerformance.length;
  const avgNPS =
    coachPerformance.reduce((sum, c) => sum + c.avgNPS, 0) /
    coachPerformance.length;

  // Last 5 feedback entries
  const recentFeedback = coachingFeedback.slice(0, 5);

  // Coach EOD reports
  const coachEodReports = eodReports.filter((r) => r.role === "coach");

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Coaching Hub</h1>
        <p className="page-subtitle">
          Coach performance, client satisfaction, and feedback
        </p>
      </div>

      {/* KPI Strip */}
      <div className="section">
        <div className="metric-grid metric-grid-4">
          <div className="glass-static metric-card">
            <div className="metric-card-label">Active Clients</div>
            <div className="metric-card-value">{totalActiveClients}</div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Avg Satisfaction</div>
            <div className="metric-card-value">
              {avgSatisfaction.toFixed(1)}
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Avg Completion</div>
            <div className="metric-card-value">
              {fmtPercent(avgCompletion, 0)}
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Avg NPS</div>
            <div className="metric-card-value">{avgNPS.toFixed(1)}</div>
          </div>
        </div>
      </div>

      {/* Coach Leaderboard */}
      <div className="section">
        <h2 className="section-title">
          <Users size={16} />
          Coach Leaderboard
        </h2>
        <div className="glass-static" style={{ overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Active Clients</th>
                <th>Avg Rating</th>
                <th>NPS</th>
                <th>Completion Rate</th>
              </tr>
            </thead>
            <tbody>
              {coachPerformance.map((coach) => (
                <tr
                  key={coach.name}
                  className={coach.completionRate < 85 ? "row-flagged" : ""}
                >
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                    {coach.name}
                  </td>
                  <td>{coach.activeClients}</td>
                  <td>{coach.avgRating.toFixed(1)}</td>
                  <td>{coach.avgNPS.toFixed(1)}</td>
                  <td>{fmtPercent(coach.completionRate, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Feedback */}
      <div className="section">
        <h2 className="section-title">
          <MessageSquare size={16} />
          Recent Feedback
        </h2>
        {recentFeedback.map((fb, i) => (
          <div
            key={i}
            className="glass-static"
            style={{ padding: 16, marginBottom: 12 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div>
                <span
                  style={{
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    fontSize: 14,
                  }}
                >
                  {fb.name}
                </span>
                <span
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 12,
                    marginLeft: 8,
                  }}
                >
                  Coach: {fb.coachName}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Star
                  size={14}
                  style={{
                    color: "var(--warning)",
                    fill: "var(--warning)",
                  }}
                />
                <span
                  style={{
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    fontSize: 14,
                  }}
                >
                  {fb.coachRating}/10
                </span>
              </div>
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
              }}
            >
              {fb.feedback.length > 100
                ? fb.feedback.slice(0, 100) + "..."
                : fb.feedback}
            </div>
          </div>
        ))}
      </div>

      {/* Satisfaction Trend */}
      <div className="section">
        <h2 className="section-title">
          <TrendingUp size={16} />
          Satisfaction Trend
        </h2>
        <div className="glass-static" style={{ padding: 20 }}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={satisfactionTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" />
              <YAxis domain={[7.5, 9.5]} />
              <Tooltip
                contentStyle={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                }}
              />
              <Line
                type="monotone"
                dataKey="avgRating"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={{ fill: "var(--accent)", r: 4 }}
                name="Avg Rating"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* EOD Reports */}
      <div className="section">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2 className="section-title" style={{ marginBottom: 0 }}>
            <Dumbbell size={16} />
            Coach EOD Reports
          </h2>
          <button className="btn-primary" onClick={() => alert("Coming soon")}>
            <Plus size={14} />
            Submit Report
          </button>
        </div>
        {coachEodReports.map((report) => (
          <div key={report.id} className="glass-static eod-card">
            <div className="eod-header">
              <span className="eod-name">{report.submittedBy}</span>
              <span className="eod-date">{report.date}</span>
            </div>
            <div className="eod-stats">
              <span className="eod-stat">
                Checked In:{" "}
                <span className="eod-stat-value">
                  {report.clientsCheckedIn}
                </span>
              </span>
              <span className="eod-stat">
                Workouts:{" "}
                <span className="eod-stat-value">
                  {report.workoutsReviewed}
                </span>
              </span>
            </div>
            <div className="eod-label">Highlights</div>
            <div className="eod-text">{report.wins}</div>
            {report.challenges && (
              <>
                <div className="eod-label">Blockers</div>
                <div className="eod-text">{report.challenges}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
