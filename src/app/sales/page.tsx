"use client";

import {
  Phone,
  PhoneCall,
  Trophy,
  DollarSign,
  Plus,
  MessageSquare,
} from "lucide-react";
import {
  salesData,
  funnelStages,
  setterStats,
  eodReports,
} from "@/lib/mock-data";
import { fmtDollars, fmtPercent, fmtNumber } from "@/lib/formatters";

export default function SalesPage() {
  const closerEodReports = eodReports.filter((r) => r.role === "closer");

  // Compute the max value for funnel bar scaling
  const maxFunnel = funnelStages.length > 0
    ? funnelStages[0].keith + funnelStages[0].tyson
    : 1;

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Sales Pipeline</h1>
        <p className="page-subtitle">
          Closer performance, setter stats, and funnel analysis
        </p>
      </div>

      {/* KPI Strip */}
      <div className="section">
        <div className="metric-grid metric-grid-4">
          <div className="glass-static metric-card">
            <div className="metric-card-label">Calls Booked</div>
            <div className="metric-card-value">
              {fmtNumber(salesData.totalCallsBooked)}
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Calls Completed</div>
            <div className="metric-card-value">
              {fmtNumber(salesData.liveCallsCompleted)}
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Deals Won</div>
            <div className="metric-card-value">
              {fmtNumber(salesData.totalWon)}
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Revenue</div>
            <div className="metric-card-value">
              {fmtDollars(salesData.revenueTotal)}
            </div>
          </div>
        </div>
      </div>

      {/* Closer Leaderboard */}
      <div className="section">
        <h2 className="section-title">
          <Trophy size={16} />
          Closer Leaderboard
        </h2>
        <div className="glass-static" style={{ overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Calls Booked</th>
                <th>Calls Taken</th>
                <th>Closed</th>
                <th>Revenue</th>
                <th>Close Rate</th>
              </tr>
            </thead>
            <tbody>
              {salesData.closerStats.map((closer) => {
                const closeRate =
                  closer.callsTaken > 0
                    ? (closer.closed / closer.callsTaken) * 100
                    : 0;
                return (
                  <tr key={closer.name}>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      {closer.name}
                    </td>
                    <td>{closer.callsBooked}</td>
                    <td>{closer.callsTaken}</td>
                    <td>{closer.closed}</td>
                    <td>{fmtDollars(closer.revenue)}</td>
                    <td>{fmtPercent(closeRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Setter Stats */}
      <div className="section">
        <h2 className="section-title">
          <MessageSquare size={16} />
          Setter Stats
        </h2>
        <div className="glass-static" style={{ overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Messages Handled</th>
                <th>Calls Booked</th>
                <th>Conversion Rate</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {setterStats.map((setter) => (
                <tr key={setter.name}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                    {setter.name}
                  </td>
                  <td>{fmtNumber(setter.messagesHandled)}</td>
                  <td>{setter.callsBooked}</td>
                  <td>{fmtPercent(setter.conversionRate)}</td>
                  <td>
                    <span
                      style={{
                        color:
                          setter.source === "keith"
                            ? "var(--keith)"
                            : "var(--tyson)",
                      }}
                    >
                      {setter.source.charAt(0).toUpperCase() +
                        setter.source.slice(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Funnel */}
      <div className="section">
        <h2 className="section-title">
          <PhoneCall size={16} />
          Sales Funnel
        </h2>
        <div className="glass-static" style={{ padding: 24 }}>
          {funnelStages.map((stage) => {
            const total = stage.keith + stage.tyson;
            const pct = (total / maxFunnel) * 100;
            return (
              <div key={stage.stage} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 6,
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>
                    {stage.stage}
                  </span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {fmtNumber(total)}
                  </span>
                </div>
                <div
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background: "var(--bg-glass)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      borderRadius: 4,
                      background:
                        "linear-gradient(90deg, var(--accent), var(--tyson))",
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
              </div>
            );
          })}
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
            <Phone size={16} />
            Closer EOD Reports
          </h2>
          <button className="btn-primary" onClick={() => alert("Coming soon")}>
            <Plus size={14} />
            Submit Report
          </button>
        </div>
        {closerEodReports.map((report) => (
          <div key={report.id} className="glass-static eod-card">
            <div className="eod-header">
              <span className="eod-name">{report.submittedBy}</span>
              <span className="eod-date">{report.date}</span>
            </div>
            <div className="eod-stats">
              <span className="eod-stat">
                Calls:{" "}
                <span className="eod-stat-value">{report.callsTaken}</span>
              </span>
              <span className="eod-stat">
                Closed:{" "}
                <span className="eod-stat-value">{report.callsClosed}</span>
              </span>
              <span className="eod-stat">
                Revenue:{" "}
                <span className="eod-stat-value">
                  {fmtDollars(report.revenue || 0)}
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
