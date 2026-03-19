"use client";

import { ExternalLink, UserPlus, Clock, CheckCircle } from "lucide-react";
import type { Client } from "@/lib/types";

interface Props {
  clients: Client[];
}

export default function OnboardingTab({ clients }: Props) {
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  // Recently onboarded (started within last 14 days)
  const recentlyOnboarded = clients
    .filter((c) => {
      if (!c.startDate) return false;
      const diff = Math.ceil(
        (now.getTime() - new Date(c.startDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      return diff >= 0 && diff <= 14 && c.status === "active";
    })
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  // Upcoming (start date in future)
  const upcoming = clients
    .filter((c) => c.startDate && c.startDate > today && c.status === "active")
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  // All active sorted by start date (newest first)
  const allActive = clients
    .filter((c) => c.status === "active")
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  const daysAgo = (date: string) => {
    const diff = Math.ceil((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return `${diff} days ago`;
  };

  const daysUntil = (date: string) => {
    const diff = Math.ceil((new Date(date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    return `In ${diff} days`;
  };

  return (
    <div>
      {/* KPIs */}
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 20 }}>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Upcoming Onboardings</div>
          <div className="metric-card-value">{upcoming.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Recently Onboarded (14d)</div>
          <div className="metric-card-value">{recentlyOnboarded.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Total Active</div>
          <div className="metric-card-value">{allActive.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Cancelled/Refunded</div>
          <div className="metric-card-value" style={{ color: "var(--danger)" }}>
            {clients.filter((c) => c.status === "cancelled" || c.status === "refunded").length}
          </div>
        </div>
      </div>

      {/* Upcoming Onboardings */}
      {upcoming.length > 0 && (
        <div className="section">
          <h2 className="section-title">
            <Clock size={16} />
            Upcoming Onboardings
          </h2>
          {upcoming.map((client) => (
            <div key={client.id || client.name} className="glass-static" style={{ padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15 }}>{client.name}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 10 }}>{client.email}</span>
                </div>
                <span style={{ color: "var(--warning)", fontWeight: 600, fontSize: 13 }}>{daysUntil(client.startDate)}</span>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                <span>Coach: <strong>{client.coachName}</strong></span>
                <span>Program: {client.program}</span>
                <span>Offer: {client.offer}</span>
                <span>Paid: ${client.amountPaid.toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {client.salesFathomLink && (
                  <a href={client.salesFathomLink} target="_blank" rel="noopener noreferrer" className="btn-link" style={{ fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
                    <ExternalLink size={12} /> Sales Recording
                  </a>
                )}
                {client.onboardingFathomLink && (
                  <a href={client.onboardingFathomLink} target="_blank" rel="noopener noreferrer" className="btn-link" style={{ fontSize: 12, color: "var(--success)", display: "flex", alignItems: "center", gap: 4 }}>
                    <ExternalLink size={12} /> Onboarding Recording
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recently Onboarded */}
      <div className="section">
        <h2 className="section-title">
          <UserPlus size={16} />
          Recently Onboarded (Last 14 Days)
        </h2>
        {recentlyOnboarded.length === 0 ? (
          <div className="glass-static" style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>
            No recent onboardings
          </div>
        ) : (
          <div className="glass-static" style={{ overflow: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Email</th>
                  <th>Coach</th>
                  <th>Program</th>
                  <th>Start Date</th>
                  <th>Onboarded</th>
                  <th>Paid</th>
                  <th>Recordings</th>
                </tr>
              </thead>
              <tbody>
                {recentlyOnboarded.map((client) => (
                  <tr key={client.id || client.name}>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{client.name}</td>
                    <td style={{ fontSize: 12 }}>{client.email}</td>
                    <td>{client.coachName}</td>
                    <td>{client.program}</td>
                    <td style={{ fontSize: 12 }}>{client.startDate}</td>
                    <td>
                      <span style={{ color: "var(--success)", fontSize: 12 }}>
                        <CheckCircle size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
                        {daysAgo(client.startDate)}
                      </span>
                    </td>
                    <td>${client.amountPaid.toLocaleString()}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      {client.salesFathomLink && (
                        <a href={client.salesFathomLink} target="_blank" rel="noopener noreferrer" title="Sales" style={{ color: "var(--accent)" }}>
                          <ExternalLink size={13} />
                        </a>
                      )}
                      {client.onboardingFathomLink && (
                        <a href={client.onboardingFathomLink} target="_blank" rel="noopener noreferrer" title="Onboarding" style={{ color: "var(--success)" }}>
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
