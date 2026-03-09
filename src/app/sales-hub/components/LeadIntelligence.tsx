"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Shield,
  FileText,
  BarChart3,
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  Send,
  Eye,
  Info,
} from "lucide-react";
import type { Filters, SheetRow } from "../types";
import { fmtDollars, fmtPercent } from "@/lib/formatters";
import { ReviewMarkdown } from "./ReviewMarkdown";

/* ── Types ────────────────────────────────────────────────────────── */

interface RiskLead {
  appointment: {
    id: string;
    calendarId: string;
    title: string;
    startTime: string;
    endTime: string;
    status: string;
  };
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  riskAssessment: {
    score: number;
    level: "low" | "medium" | "high";
    signals: string[];
  };
}

interface LeadIntelligenceProps {
  filters: Filters;
  sheetData: SheetRow[] | null;
}

/* ── Collapsible Section ──────────────────────────────────────── */

function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="glass-static" style={{ marginBottom: 16, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          fontFamily: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {icon}
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {title}
          </span>
        </div>
        {open ? (
          <ChevronUp size={16} style={{ color: "var(--text-muted)" }} />
        ) : (
          <ChevronDown size={16} style={{ color: "var(--text-muted)" }} />
        )}
      </button>
      {open && (
        <div
          style={{
            padding: "0 20px 20px",
            borderTop: "1px solid var(--border-primary)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Risk Badge ───────────────────────────────────────────────── */

function RiskBadge({ score }: { score: number }) {
  let label: string;
  let color: string;
  let bg: string;

  if (score <= 30) {
    label = "Low Risk";
    color = "var(--success)";
    bg = "var(--success-soft)";
  } else if (score <= 60) {
    label = "Medium Risk";
    color = "var(--warning)";
    bg = "var(--warning-soft)";
  } else {
    label = "High Risk";
    color = "var(--danger)";
    bg = "var(--danger-soft)";
  }

  return (
    <span
      className="status-badge"
      style={{ background: bg, color }}
    >
      {score} - {label}
    </span>
  );
}

/* ── Simple Bar ───────────────────────────────────────────────── */

function MiniBar({
  value,
  max,
  color = "var(--accent)",
  label,
  valueLabel,
}: {
  value: number;
  max: number;
  color?: string;
  label: string;
  valueLabel: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          marginBottom: 4,
        }}
      >
        <span style={{ color: "var(--text-secondary)" }}>{label}</span>
        <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
          {valueLabel}
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "var(--bg-glass)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(pct, 100)}%`,
            height: "100%",
            borderRadius: 3,
            background: color,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────── */

export default function LeadIntelligence({ filters, sheetData }: LeadIntelligenceProps) {
  return (
    <div className="section">
      <h2 className="section-title">
        <Shield size={16} />
        Lead Intelligence
      </h2>

      <NoShowRiskSection />
      <PreCallBriefsSection />
      <OutcomeTrackingSection sheetData={sheetData} filters={filters} />
      <ShowRateSection sheetData={sheetData} filters={filters} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SUB-SECTION A: No-Show Risk Scoring
   ══════════════════════════════════════════════════════════════════ */

function NoShowRiskSection() {
  const [leads, setLeads] = useState<RiskLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRiskScores() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/sales-hub/risk-score");
        const data = await res.json();

        if (data.error && data.leads?.length === 0) {
          setError(data.error);
          return;
        }

        setLeads(data.leads || []);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch risk scores"
        );
      } finally {
        setLoading(false);
      }
    }
    fetchRiskScores();
  }, []);

  return (
    <CollapsibleSection
      title="No-Show Risk Scoring"
      icon={<Shield size={16} style={{ color: "var(--danger)" }} />}
      defaultOpen={true}
    >
      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 32,
          }}
        >
          <Loader2
            size={20}
            className="spin"
            style={{ color: "var(--text-muted)" }}
          />
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Scoring upcoming appointments...
          </span>
        </div>
      )}

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            background: "var(--danger-soft)",
            borderRadius: 8,
            marginTop: 12,
            fontSize: 13,
            color: "var(--danger)",
          }}
        >
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {!loading && leads.length === 0 && !error && (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          No upcoming appointments found.
        </div>
      )}

      {!loading && leads.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Lead Name</th>
                <th>Call Date/Time</th>
                <th>Status</th>
                <th>Risk Score</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const isExpanded = expandedId === lead.appointment.id;
                return (
                  <>
                    <tr
                      key={lead.appointment.id}
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        setExpandedId(isExpanded ? null : lead.appointment.id)
                      }
                    >
                      <td
                        style={{
                          fontWeight: 600,
                          color: "var(--text-primary)",
                        }}
                      >
                        {lead.contact?.name || lead.appointment.title || "Unknown"}
                      </td>
                      <td>
                        {lead.appointment.startTime
                          ? new Date(lead.appointment.startTime).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              }
                            )
                          : "--"}
                      </td>
                      <td>
                        <span
                          className={`status-badge ${
                            lead.appointment.status === "confirmed"
                              ? "status-active"
                              : "status-pending"
                          }`}
                        >
                          {String(lead.appointment.status || "pending")}
                        </span>
                      </td>
                      <td>
                        <RiskBadge score={lead.riskAssessment.score} />
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            className="btn-secondary"
                            style={{
                              padding: "6px 12px",
                              fontSize: 11,
                              opacity: 0.6,
                            }}
                            title="Connect SendBlue to enable"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Send size={12} />
                            Send Text
                          </button>
                          <button
                            className="btn-secondary"
                            style={{
                              padding: "6px 12px",
                              fontSize: 11,
                              opacity: 0.6,
                            }}
                            title="Connect SendBlue to enable"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Eye size={12} />
                            DM History
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${lead.appointment.id}-detail`}>
                        <td
                          colSpan={5}
                          style={{
                            padding: "12px 16px 16px",
                            background: "rgba(0,0,0,0.15)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: "var(--text-muted)",
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                              marginBottom: 8,
                            }}
                          >
                            Signal Breakdown
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 4,
                            }}
                          >
                            {lead.riskAssessment.signals.map((signal, i) => (
                              <div
                                key={i}
                                style={{
                                  fontSize: 13,
                                  color: "var(--text-secondary)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <div
                                  style={{
                                    width: 4,
                                    height: 4,
                                    borderRadius: "50%",
                                    background: "var(--accent)",
                                    flexShrink: 0,
                                  }}
                                />
                                {signal}
                              </div>
                            ))}
                          </div>
                          {lead.contact?.email && (
                            <div
                              style={{
                                marginTop: 10,
                                fontSize: 12,
                                color: "var(--text-muted)",
                              }}
                            >
                              Email: {lead.contact.email}
                            </div>
                          )}
                          {lead.contact?.phone && (
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--text-muted)",
                              }}
                            >
                              Phone: {lead.contact.phone}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleSection>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SUB-SECTION B: Pre-Call Briefs
   ══════════════════════════════════════════════════════════════════ */

function PreCallBriefsSection() {
  const [leads, setLeads] = useState<RiskLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [briefs, setBriefs] = useState<Record<string, string>>({});
  const [briefLoading, setBriefLoading] = useState<string | null>(null);
  const [briefErrors, setBriefErrors] = useState<Record<string, string>>({});
  const [slackSending, setSlackSending] = useState<string | null>(null);
  const [slackSent, setSlackSent] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function fetchUpcoming() {
      setLoading(true);
      try {
        const res = await fetch("/api/sales-hub/risk-score");
        const data = await res.json();
        setLeads(data.leads || []);
      } catch {
        // Silently fail — risk section handles errors
      } finally {
        setLoading(false);
      }
    }
    fetchUpcoming();
  }, []);

  const generateBrief = useCallback(
    async (lead: RiskLead) => {
      const id = lead.appointment.id;
      setBriefLoading(id);
      setBriefErrors((prev) => ({ ...prev, [id]: "" }));

      try {
        const res = await fetch("/api/sales-hub/pre-call-brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactName: lead.contact?.name || lead.appointment.title || "Unknown",
            callDate: lead.appointment.startTime,
            closer: lead.appointment.title,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to generate brief");
        }

        setBriefs((prev) => ({ ...prev, [id]: data.brief }));
      } catch (err) {
        setBriefErrors((prev) => ({
          ...prev,
          [id]:
            err instanceof Error ? err.message : "Failed to generate brief",
        }));
      } finally {
        setBriefLoading(null);
      }
    },
    []
  );

  const sendToSlack = useCallback(
    async (lead: RiskLead) => {
      const id = lead.appointment.id;
      const brief = briefs[id];
      if (!brief) return;

      setSlackSending(id);

      try {
        const res = await fetch("/api/sales-hub/send-slack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelId: process.env.NEXT_PUBLIC_SLACK_CHANNEL_SALES || "sales",
            message: `*Pre-Call Brief: ${lead.contact?.name || "Unknown"}*\n\n${brief}`,
          }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to send to Slack");
        }

        setSlackSent((prev) => ({ ...prev, [id]: true }));
      } catch {
        // Show error inline — not critical
      } finally {
        setSlackSending(null);
      }
    },
    [briefs]
  );

  return (
    <CollapsibleSection
      title="Pre-Call Briefs"
      icon={<FileText size={16} style={{ color: "var(--accent)" }} />}
    >
      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 32,
          }}
        >
          <Loader2
            size={20}
            className="spin"
            style={{ color: "var(--text-muted)" }}
          />
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Loading upcoming calls...
          </span>
        </div>
      )}

      {!loading && leads.length === 0 && (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          No upcoming calls to generate briefs for.
        </div>
      )}

      {!loading && leads.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 12,
          }}
        >
          {leads.map((lead) => {
            const id = lead.appointment.id;
            const brief = briefs[id];
            const isGenerating = briefLoading === id;
            const briefError = briefErrors[id];
            const isSendingSlack = slackSending === id;
            const wasSent = slackSent[id];

            return (
              <div
                key={id}
                className="glass-subtle"
                style={{ padding: 16 }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: brief ? 12 : 0,
                  }}
                >
                  <div>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {lead.contact?.name || lead.appointment.title || "Unknown"}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        marginLeft: 12,
                      }}
                    >
                      {lead.appointment.startTime
                        ? new Date(lead.appointment.startTime).toLocaleDateString(
                            "en-US",
                            {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            }
                          )
                        : "--"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {!brief && (
                      <button
                        className="btn-primary"
                        style={{
                          padding: "6px 16px",
                          fontSize: 11,
                          opacity: isGenerating ? 0.7 : 1,
                        }}
                        onClick={() => generateBrief(lead)}
                        disabled={isGenerating}
                      >
                        {isGenerating ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <FileText size={12} />
                        )}
                        Generate Brief
                      </button>
                    )}
                    {brief && (
                      <button
                        className="btn-secondary"
                        style={{
                          padding: "6px 16px",
                          fontSize: 11,
                          opacity: isSendingSlack || wasSent ? 0.7 : 1,
                        }}
                        onClick={() => sendToSlack(lead)}
                        disabled={isSendingSlack || wasSent}
                      >
                        {isSendingSlack ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <Send size={12} />
                        )}
                        {wasSent ? "Sent" : "Send to Slack"}
                      </button>
                    )}
                  </div>
                </div>

                {briefError && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 14px",
                      background: "var(--danger-soft)",
                      borderRadius: 8,
                      marginTop: 8,
                      fontSize: 12,
                      color: "var(--danger)",
                    }}
                  >
                    <AlertCircle size={14} />
                    {briefError}
                  </div>
                )}

                {brief && (
                  <div
                    style={{
                      padding: 16,
                      background: "rgba(0,0,0,0.2)",
                      borderRadius: 10,
                      borderLeft: "3px solid var(--accent)",
                    }}
                  >
                    <ReviewMarkdown content={brief} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SUB-SECTION C: Outcome Tracking
   ══════════════════════════════════════════════════════════════════ */

function OutcomeTrackingSection({
  sheetData,
  filters,
}: {
  sheetData: SheetRow[] | null;
  filters: Filters;
}) {
  const stats = useMemo(() => {
    if (!sheetData || sheetData.length === 0) return null;

    const wins = sheetData.filter((r) => r.outcome === "WIN");

    // AOV by client
    const aovByClient: Record<string, { revenue: number; count: number }> = {};
    for (const row of wins) {
      const client = row.offer?.toLowerCase().includes("keith")
        ? "Keith"
        : row.offer?.toLowerCase().includes("tyson")
          ? "Tyson"
          : "Other";
      if (!aovByClient[client]) aovByClient[client] = { revenue: 0, count: 0 };
      aovByClient[client].revenue += row.revenue;
      aovByClient[client].count++;
    }

    // AOV by closer
    const aovByCloser: Record<string, { revenue: number; count: number }> = {};
    for (const row of wins) {
      if (!row.closer) continue;
      if (!aovByCloser[row.closer]) aovByCloser[row.closer] = { revenue: 0, count: 0 };
      aovByCloser[row.closer].revenue += row.revenue;
      aovByCloser[row.closer].count++;
    }

    // AOV by setter
    const aovBySetter: Record<string, { revenue: number; count: number }> = {};
    for (const row of wins) {
      if (!row.setter) continue;
      if (!aovBySetter[row.setter]) aovBySetter[row.setter] = { revenue: 0, count: 0 };
      aovBySetter[row.setter].revenue += row.revenue;
      aovBySetter[row.setter].count++;
    }

    // Close rate by setter
    const closeRateBySetter: Record<string, { total: number; wins: number }> = {};
    for (const row of sheetData) {
      if (!row.setter) continue;
      if (!closeRateBySetter[row.setter]) closeRateBySetter[row.setter] = { total: 0, wins: 0 };
      closeRateBySetter[row.setter].total++;
      if (row.outcome === "WIN") closeRateBySetter[row.setter].wins++;
    }

    // Revenue by payment method
    const revenueByMethod: Record<string, number> = {};
    for (const row of wins) {
      const method = row.method || "Unknown";
      revenueByMethod[method] = (revenueByMethod[method] || 0) + row.revenue;
    }

    return {
      aovByClient,
      aovByCloser,
      aovBySetter,
      closeRateBySetter,
      revenueByMethod,
      totalRevenue: wins.reduce((s, r) => s + r.revenue, 0),
      totalWins: wins.length,
    };
  }, [sheetData]);

  return (
    <CollapsibleSection
      title="Outcome Tracking"
      icon={<BarChart3 size={16} style={{ color: "var(--success)" }} />}
    >
      {!stats && (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          No sheet data available. Connect Google Sheets to see outcome tracking.
        </div>
      )}

      {stats && (
        <div style={{ marginTop: 12 }}>
          {/* Summary stat cards */}
          <div
            className="metric-grid metric-grid-3"
            style={{ marginBottom: 24 }}
          >
            <div className="glass-subtle" style={{ padding: 16, textAlign: "center" }}>
              <div className="metric-card-label">Total Revenue</div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: "var(--success)",
                  marginTop: 4,
                }}
              >
                {fmtDollars(stats.totalRevenue)}
              </div>
            </div>
            <div className="glass-subtle" style={{ padding: 16, textAlign: "center" }}>
              <div className="metric-card-label">Total Wins</div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: "var(--accent)",
                  marginTop: 4,
                }}
              >
                {stats.totalWins}
              </div>
            </div>
            <div className="glass-subtle" style={{ padding: 16, textAlign: "center" }}>
              <div className="metric-card-label">Overall AOV</div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  marginTop: 4,
                }}
              >
                {stats.totalWins > 0
                  ? fmtDollars(stats.totalRevenue / stats.totalWins)
                  : "$0"}
              </div>
            </div>
          </div>

          {/* AOV by Client */}
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 8,
            }}
          >
            AOV by Client
          </div>
          <div className="glass-subtle" style={{ padding: 16, marginBottom: 16 }}>
            {Object.entries(stats.aovByClient).map(([client, data]) => (
              <div
                key={client}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border-primary)",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    color:
                      client === "Tyson"
                        ? "var(--tyson)"
                        : client === "Keith"
                          ? "var(--keith)"
                          : "var(--text-secondary)",
                    fontWeight: 600,
                  }}
                >
                  {client}
                </span>
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                  {fmtDollars(data.count > 0 ? data.revenue / data.count : 0)}{" "}
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontWeight: 400,
                      fontSize: 11,
                    }}
                  >
                    ({data.count} deals)
                  </span>
                </span>
              </div>
            ))}
          </div>

          {/* AOV by Closer */}
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 8,
            }}
          >
            AOV by Closer
          </div>
          <div className="glass-subtle" style={{ padding: 16, marginBottom: 16 }}>
            {Object.entries(stats.aovByCloser).map(([closer, data]) => (
              <div
                key={closer}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border-primary)",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    color: "var(--text-primary)",
                    fontWeight: 600,
                  }}
                >
                  {closer}
                </span>
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                  {fmtDollars(data.count > 0 ? data.revenue / data.count : 0)}{" "}
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontWeight: 400,
                      fontSize: 11,
                    }}
                  >
                    ({data.count} deals)
                  </span>
                </span>
              </div>
            ))}
          </div>

          {/* Close Rate by Setter */}
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 8,
            }}
          >
            Close Rate by Setter
          </div>
          <div className="glass-subtle" style={{ padding: 16, marginBottom: 16 }}>
            {Object.entries(stats.closeRateBySetter).map(([setter, data]) => {
              const rate = data.total > 0 ? (data.wins / data.total) * 100 : 0;
              return (
                <MiniBar
                  key={setter}
                  label={setter}
                  value={rate}
                  max={100}
                  color={rate >= 30 ? "var(--success)" : rate >= 15 ? "var(--warning)" : "var(--danger)"}
                  valueLabel={`${fmtPercent(rate)} (${data.wins}/${data.total})`}
                />
              );
            })}
          </div>

          {/* Revenue by Payment Method */}
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 8,
            }}
          >
            Revenue by Payment Method
          </div>
          <div className="glass-subtle" style={{ padding: 16 }}>
            {Object.entries(stats.revenueByMethod).map(([method, revenue]) => (
              <MiniBar
                key={method}
                label={method}
                value={revenue}
                max={stats.totalRevenue}
                color="var(--accent)"
                valueLabel={fmtDollars(revenue)}
              />
            ))}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SUB-SECTION D: Show Rate Analytics
   ══════════════════════════════════════════════════════════════════ */

function ShowRateSection({
  sheetData,
  filters,
}: {
  sheetData: SheetRow[] | null;
  filters: Filters;
}) {
  const analytics = useMemo(() => {
    if (!sheetData || sheetData.length === 0) return null;

    const DAY_NAMES = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    // By client
    const byClient: Record<string, { scheduled: number; shown: number }> = {};
    for (const row of sheetData) {
      const client = row.offer?.toLowerCase().includes("keith")
        ? "Keith"
        : row.offer?.toLowerCase().includes("tyson")
          ? "Tyson"
          : "Other";
      if (!byClient[client]) byClient[client] = { scheduled: 0, shown: 0 };
      byClient[client].scheduled++;
      if (row.callTaken) byClient[client].shown++;
    }

    // By day of week
    const byDay: Record<string, { scheduled: number; shown: number }> = {};
    for (const row of sheetData) {
      if (!row.date) continue;
      const day = DAY_NAMES[new Date(row.date + "T00:00:00").getDay()];
      if (!day) continue;
      if (!byDay[day]) byDay[day] = { scheduled: 0, shown: 0 };
      byDay[day].scheduled++;
      if (row.callTaken) byDay[day].shown++;
    }

    // By setter
    const bySetter: Record<string, { scheduled: number; shown: number }> = {};
    for (const row of sheetData) {
      if (!row.setter) continue;
      if (!bySetter[row.setter]) bySetter[row.setter] = { scheduled: 0, shown: 0 };
      bySetter[row.setter].scheduled++;
      if (row.callTaken) bySetter[row.setter].shown++;
    }

    // By closer
    const byCloser: Record<string, { scheduled: number; shown: number }> = {};
    for (const row of sheetData) {
      if (!row.closer) continue;
      if (!byCloser[row.closer]) byCloser[row.closer] = { scheduled: 0, shown: 0 };
      byCloser[row.closer].scheduled++;
      if (row.callTaken) byCloser[row.closer].shown++;
    }

    // Overall
    const totalScheduled = sheetData.length;
    const totalShown = sheetData.filter((r) => r.callTaken).length;

    return {
      overall: { scheduled: totalScheduled, shown: totalShown },
      byClient,
      byDay,
      bySetter,
      byCloser,
    };
  }, [sheetData]);

  return (
    <CollapsibleSection
      title="Show Rate Analytics"
      icon={<CalendarCheck size={16} style={{ color: "var(--tyson)" }} />}
    >
      {!analytics && (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          No sheet data available. Connect Google Sheets to see show rate analytics.
        </div>
      )}

      {analytics && (
        <div style={{ marginTop: 12 }}>
          {/* Overall show rate */}
          <div
            className="glass-subtle"
            style={{ padding: 20, textAlign: "center", marginBottom: 16 }}
          >
            <div className="metric-card-label">Overall Show Rate</div>
            <div
              style={{
                fontSize: 36,
                fontWeight: 700,
                color:
                  analytics.overall.scheduled > 0 &&
                  (analytics.overall.shown / analytics.overall.scheduled) * 100 >= 70
                    ? "var(--success)"
                    : "var(--warning)",
                marginTop: 4,
              }}
            >
              {analytics.overall.scheduled > 0
                ? fmtPercent(
                    (analytics.overall.shown / analytics.overall.scheduled) * 100
                  )
                : "N/A"}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginTop: 4,
              }}
            >
              {analytics.overall.shown} / {analytics.overall.scheduled} calls
            </div>
          </div>

          <div className="metric-grid metric-grid-2">
            {/* By Client */}
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: 8,
                }}
              >
                By Client
              </div>
              <div className="glass-subtle" style={{ padding: 16 }}>
                {Object.entries(analytics.byClient).map(([client, data]) => {
                  const rate =
                    data.scheduled > 0
                      ? (data.shown / data.scheduled) * 100
                      : 0;
                  return (
                    <MiniBar
                      key={client}
                      label={client}
                      value={rate}
                      max={100}
                      color={
                        client === "Tyson"
                          ? "var(--tyson)"
                          : client === "Keith"
                            ? "var(--keith)"
                            : "var(--accent)"
                      }
                      valueLabel={`${fmtPercent(rate)} (${data.shown}/${data.scheduled})`}
                    />
                  );
                })}
              </div>
            </div>

            {/* By Closer */}
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: 8,
                }}
              >
                By Closer
              </div>
              <div className="glass-subtle" style={{ padding: 16 }}>
                {Object.entries(analytics.byCloser).map(([closer, data]) => {
                  const rate =
                    data.scheduled > 0
                      ? (data.shown / data.scheduled) * 100
                      : 0;
                  return (
                    <MiniBar
                      key={closer}
                      label={closer}
                      value={rate}
                      max={100}
                      color={rate >= 70 ? "var(--success)" : rate >= 50 ? "var(--warning)" : "var(--danger)"}
                      valueLabel={`${fmtPercent(rate)} (${data.shown}/${data.scheduled})`}
                    />
                  );
                })}
              </div>
            </div>

            {/* By Day of Week */}
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: 8,
                }}
              >
                By Day of Week
              </div>
              <div className="glass-subtle" style={{ padding: 16 }}>
                {Object.entries(analytics.byDay)
                  .sort((a, b) => {
                    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
                    return days.indexOf(a[0]) - days.indexOf(b[0]);
                  })
                  .map(([day, data]) => {
                    const rate =
                      data.scheduled > 0
                        ? (data.shown / data.scheduled) * 100
                        : 0;
                    return (
                      <MiniBar
                        key={day}
                        label={day}
                        value={rate}
                        max={100}
                        color="var(--accent)"
                        valueLabel={`${fmtPercent(rate)} (${data.shown}/${data.scheduled})`}
                      />
                    );
                  })}
              </div>
            </div>

            {/* By Setter */}
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: 8,
                }}
              >
                By Setter
              </div>
              <div className="glass-subtle" style={{ padding: 16 }}>
                {Object.entries(analytics.bySetter).map(([setter, data]) => {
                  const rate =
                    data.scheduled > 0
                      ? (data.shown / data.scheduled) * 100
                      : 0;
                  return (
                    <MiniBar
                      key={setter}
                      label={setter}
                      value={rate}
                      max={100}
                      color={rate >= 70 ? "var(--success)" : rate >= 50 ? "var(--warning)" : "var(--danger)"}
                      valueLabel={`${fmtPercent(rate)} (${data.shown}/${data.scheduled})`}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Reminder Sequencing Placeholder */}
          <div
            className="glass-subtle"
            style={{
              padding: "16px 20px",
              marginTop: 16,
              borderLeft: "3px solid var(--warning)",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <Info
              size={16}
              style={{
                color: "var(--warning)",
                flexShrink: 0,
                marginTop: 2,
              }}
            />
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: 4,
                }}
              >
                Reminder Sequencing
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                Connect SendBlue + GHL email tracking to populate reminder sequence
                analytics.
              </div>
            </div>
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}
