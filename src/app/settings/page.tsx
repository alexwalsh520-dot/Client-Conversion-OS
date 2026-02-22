"use client";

import {
  Settings,
  Users,
  Shield,
  MessageSquare,
  Dumbbell,
  FileSpreadsheet,
} from "lucide-react";
import { teamMembers } from "@/lib/mock-data";

export default function SettingsPage() {
  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">
          Team management and integrations
        </p>
      </div>

      {/* Team Members */}
      <div className="section">
        <h2 className="section-title">
          <Users size={16} />
          Team Members
        </h2>
        <div className="glass-static" style={{ overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Email</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {teamMembers.map((member) => (
                <tr key={member.email}>
                  <td
                    style={{
                      fontWeight: 600,
                      color: "var(--text-primary)",
                    }}
                  >
                    {member.name}
                  </td>
                  <td>{member.role}</td>
                  <td
                    style={{ color: "var(--text-muted)", fontSize: 12 }}
                  >
                    {member.email}
                  </td>
                  <td>
                    <span
                      className={`status-badge ${
                        member.status === "active"
                          ? "status-active"
                          : "status-pending"
                      }`}
                    >
                      {member.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Coming Soon Integrations */}
      <div className="section">
        <h2 className="section-title">
          <Settings size={16} />
          Integrations
        </h2>
        <div className="metric-grid metric-grid-2">
          <div className="glass-static" style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  className="action-card-icon"
                  style={{ background: "var(--accent-soft)" }}
                >
                  <Shield size={18} style={{ color: "var(--accent)" }} />
                </div>
                <div className="action-card-title">Role Permissions</div>
              </div>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
            <div className="action-card-desc">
              Define who can view and edit each section of CCOS. Set admin,
              manager, and team member roles.
            </div>
          </div>

          <div className="glass-static" style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  className="action-card-icon"
                  style={{ background: "var(--tyson-soft)" }}
                >
                  <MessageSquare
                    size={18}
                    style={{ color: "var(--tyson)" }}
                  />
                </div>
                <div className="action-card-title">Slack Integration</div>
              </div>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
            <div className="action-card-desc">
              Connect Slack for automated EOD reports, AI alerts, and daily
              briefings delivered to your channels.
            </div>
          </div>

          <div className="glass-static" style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  className="action-card-icon"
                  style={{ background: "var(--success-soft)" }}
                >
                  <Dumbbell size={18} style={{ color: "var(--success)" }} />
                </div>
                <div className="action-card-title">EverFit Sync</div>
              </div>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
            <div className="action-card-desc">
              Sync client workout completion, check-in data, and coach metrics
              directly from EverFit.
            </div>
          </div>

          <div className="glass-static" style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  className="action-card-icon"
                  style={{ background: "var(--warning-soft)" }}
                >
                  <FileSpreadsheet
                    size={18}
                    style={{ color: "var(--warning)" }}
                  />
                </div>
                <div className="action-card-title">Google Sheets Sync</div>
              </div>
              <span className="coming-soon-badge">Coming Soon</span>
            </div>
            <div className="action-card-desc">
              Bi-directional sync with Google Sheets for ad data imports and
              custom reporting exports.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
