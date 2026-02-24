"use client";

import {
  Users,
  UserCheck,
  Ghost,
  AlertTriangle,
} from "lucide-react";
import { onboardingTracker as mockOnboarding } from "@/lib/mock-data";
import { getOnboardingTracker } from "@/lib/data";
import { useAsyncData } from "@/lib/use-data";
import { fmtDollars } from "@/lib/formatters";

export default function OnboardingPage() {
  const { data: onboardingTracker } = useAsyncData(getOnboardingTracker, mockOnboarding);

  // Compute KPIs
  const totalPipeline = onboardingTracker.length;
  const activeCount = onboardingTracker.filter(
    (c) => c.status === "active"
  ).length;
  const ghostedCount = onboardingTracker.filter(
    (c) => c.status === "ghosted"
  ).length;
  const atRiskCount = onboardingTracker.filter(
    (c) => c.reachOutCloser === true
  ).length;

  // Ghosted clients
  const ghostedClients = onboardingTracker.filter(
    (c) => c.status === "ghosted"
  );

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Onboarding Pipeline</h1>
        <p className="page-subtitle">
          Client onboarding status, ghosted recovery, and at-risk tracking
        </p>
      </div>

      {/* KPI Strip */}
      <div className="section">
        <div className="metric-grid metric-grid-4">
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total Pipeline</div>
            <div className="metric-card-value">{totalPipeline}</div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Active</div>
            <div className="metric-card-value">{activeCount}</div>
            <div className="metric-card-trend metric-card-trend-up">
              On track
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Ghosted</div>
            <div className="metric-card-value">{ghostedCount}</div>
            <div className="metric-card-trend metric-card-trend-down">
              Needs recovery
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Needs Follow-up</div>
            <div className="metric-card-value">{atRiskCount}</div>
            <div className="metric-card-trend metric-card-trend-down">
              Closer outreach flagged
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline Table */}
      <div className="section">
        <h2 className="section-title">
          <Users size={16} />
          Full Pipeline
        </h2>
        <div className="glass-static" style={{ overflow: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Closer</th>
                <th>Amount Paid</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Comments</th>
              </tr>
            </thead>
            <tbody>
              {onboardingTracker.map((entry, i) => {
                const statusClass =
                  entry.status === "active"
                    ? "status-active"
                    : entry.status === "ghosted"
                      ? "status-ghosted"
                      : "status-pending";
                return (
                  <tr key={i}>
                    <td
                      style={{
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {entry.client}
                    </td>
                    <td>{entry.closer}</td>
                    <td>{fmtDollars(entry.amountPaid)}</td>
                    <td>
                      {entry.pif === true
                        ? "PIF"
                        : entry.pif === false
                          ? "Pending"
                          : entry.pif}
                    </td>
                    <td>
                      <span className={`status-badge ${statusClass}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td>
                      {entry.comments.length > 60
                        ? entry.comments.slice(0, 60) + "..."
                        : entry.comments}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ghosted Clients */}
      {ghostedClients.length > 0 && (
        <div className="section">
          <h2 className="section-title">
            <Ghost size={16} />
            Ghosted Clients
          </h2>
          {ghostedClients.map((client, i) => (
            <div
              key={i}
              className="glass-static"
              style={{
                padding: 16,
                marginBottom: 12,
                borderLeft: "3px solid var(--danger)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    color: "var(--danger)",
                    fontSize: 14,
                  }}
                >
                  {client.client}
                </span>
                <span className="status-badge status-ghosted">Ghosted</span>
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  marginBottom: 6,
                }}
              >
                Closer: {client.closer} | Onboarder: {client.onboarder}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  lineHeight: 1.5,
                }}
              >
                {client.comments}
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                {client.rescheduleEmailSent && (
                  <span className="coming-soon-badge">Reschedule sent</span>
                )}
                {client.reachOutCloser && (
                  <span className="status-badge status-at-risk">
                    <AlertTriangle size={10} />
                    Closer follow-up needed
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
