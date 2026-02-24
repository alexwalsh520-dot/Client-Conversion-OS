"use client";

import { useState, useEffect } from "react";
import {
  Settings,
  Users,
  Shield,
  MessageSquare,
  Dumbbell,
  FileSpreadsheet,
  RefreshCw,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { teamMembers } from "@/lib/mock-data";

export default function SettingsPage() {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // Fetch last sync on mount
  useEffect(() => {
    fetch("/api/sync")
      .then((r) => r.json())
      .then((data) => {
        if (data.syncs && data.syncs.length > 0) {
          const last = data.syncs[0];
          setLastSync(
            new Date(last.completed_at || last.started_at).toLocaleString()
          );
        }
      })
      .catch(() => {});
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setSyncResult({
          success: true,
          message: `Synced ${data.rows} rows from ${data.sheets?.length || 0} sheets`,
        });
        setLastSync(new Date().toLocaleString());
      } else {
        setSyncResult({
          success: false,
          message: data.error || "Sync failed",
        });
      }
    } catch (err) {
      setSyncResult({
        success: false,
        message: "Network error — could not reach sync endpoint",
      });
    } finally {
      setSyncing(false);
    }
  }

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

      {/* Integrations */}
      <div className="section">
        <h2 className="section-title">
          <Settings size={16} />
          Integrations
        </h2>
        <div className="metric-grid metric-grid-2">
          {/* Google Sheets Sync — LIVE */}
          <div
            className="glass-static"
            style={{
              padding: 24,
              borderLeft: "3px solid var(--success)",
            }}
          >
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
                  <FileSpreadsheet
                    size={18}
                    style={{ color: "var(--success)" }}
                  />
                </div>
                <div className="action-card-title">Google Sheets Sync</div>
              </div>
              <span className="status-badge status-active">Connected</span>
            </div>
            <div
              className="action-card-desc"
              style={{ marginBottom: 16 }}
            >
              Auto-syncs every hour from 5 Google Sheets (coaching, onboarding,
              sales, ads). Data is stored in Supabase with mock-data fallback.
            </div>

            {/* Last sync info */}
            {lastSync && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginBottom: 12,
                }}
              >
                Last synced: {lastSync}
              </div>
            )}

            {/* Sync result feedback */}
            {syncResult && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  marginBottom: 12,
                  color: syncResult.success
                    ? "var(--success)"
                    : "var(--danger)",
                }}
              >
                {syncResult.success ? (
                  <CheckCircle size={14} />
                ) : (
                  <XCircle size={14} />
                )}
                {syncResult.message}
              </div>
            )}

            {/* Sync Now button */}
            <button
              className="btn-primary"
              onClick={handleSync}
              disabled={syncing}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                opacity: syncing ? 0.7 : 1,
              }}
            >
              <RefreshCw
                size={14}
                style={{
                  animation: syncing ? "spin 1s linear infinite" : "none",
                }}
              />
              {syncing ? "Syncing..." : "Sync Now"}
            </button>
          </div>

          {/* Role Permissions — Coming Soon */}
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

          {/* Slack Integration — Coming Soon */}
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

          {/* EverFit Sync — Coming Soon */}
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
        </div>
      </div>
    </div>
  );
}
