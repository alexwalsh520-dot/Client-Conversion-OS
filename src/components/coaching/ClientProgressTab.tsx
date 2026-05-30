"use client";

/**
 * Client Progress tab in the Coaching Hub.
 *
 * Shows clients who have submitted at least one bi-weekly check-in form,
 * with their running Program Effectiveness Score. Default view is all
 * clients with submissions; coach filter narrows to one coach and the
 * top metric swaps from "net overall avg" to "this coach's avg."
 *
 * Click a row → expanded detail panel showing every form that client
 * has submitted (date + all 5 answers + per-form score). Only the
 * owner (saeed16765@gmail.com) sees delete buttons; server-side enforced
 * in /api/check-in/submissions/[id] DELETE.
 *
 * Days-left logic: same as ClientRosterTab — (end_date − today) in days.
 * Past end_date shows "Ended" in muted text; row stays in the table.
 *
 * Default sort: most recent submission first.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, LineChart as LineChartIcon, Search, Trash2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CheckInSubmissionRow } from "@/lib/check-in/types";
import type { Client } from "@/lib/types";
import CheckInLinkBox from "@/components/check-in/CheckInLinkBox";

const OWNER_EMAIL = "saeed16765@gmail.com";

interface Props {
  /** Pre-fetched in coaching/page.tsx so this tab and CoachPerformanceTab
   *  share one round-trip. */
  submissions: CheckInSubmissionRow[];
  /** Full client list — used by the chart picker so coaches can chart
   *  ANY client (not just submitting clients). A client without
   *  submissions just shows the "no check-ins yet" state in the chart
   *  panel. */
  clients: Client[];
}

interface PerClientStats {
  clientId: number | null;
  clientName: string;
  coachName: string | null;
  endDate: string | null;
  status: string | null;
  submissions: CheckInSubmissionRow[]; // newest first
  avgScore: number; // 0-100 rounded
  latestSubmittedAt: string;
}

function daysLeftFromEndDate(endDate: string | null): number | null {
  if (!endDate) return null;
  const end = new Date(endDate).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / 86400000);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function scoreColor(score: number): string {
  if (score >= 75) return "var(--success)";
  if (score >= 50) return "var(--warning)";
  return "var(--danger)";
}

export default function ClientProgressTab({ submissions: initialSubmissions, clients }: Props) {
  // Local copy so deletes can update the table without a refetch
  const [submissions, setSubmissions] = useState(initialSubmissions);
  useEffect(() => setSubmissions(initialSubmissions), [initialSubmissions]);

  const [search, setSearch] = useState("");
  const [coachFilter, setCoachFilter] = useState<string>("all");
  const [expandedClientKey, setExpandedClientKey] = useState<string | null>(null);

  // Probe owner status once for the delete button (saeed only).
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = await res.json();
        const email = (data?.user?.email as string | undefined)?.toLowerCase();
        if (!cancelled) setIsOwner(email === OWNER_EMAIL);
      } catch {
        // default non-owner
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Group submissions by client (use clientId when present, otherwise name as fallback)
  const perClient: PerClientStats[] = useMemo(() => {
    const groups = new Map<string, PerClientStats>();
    for (const s of submissions) {
      const key = s.clientId ? `id:${s.clientId}` : `name:${s.clientName}`;
      const existing = groups.get(key);
      if (existing) {
        existing.submissions.push(s);
        if (s.submittedAt > existing.latestSubmittedAt) {
          existing.latestSubmittedAt = s.submittedAt;
          // Take the most recent coachName snapshot (in case coach was reassigned)
          existing.coachName = s.coachName;
        }
      } else {
        groups.set(key, {
          clientId: s.clientId,
          clientName: s.clientName,
          coachName: s.coachName,
          endDate: s.clientEndDate,
          status: s.clientStatus,
          submissions: [s],
          avgScore: 0,
          latestSubmittedAt: s.submittedAt,
        });
      }
    }
    // Compute avg + sort each client's submissions newest-first
    return Array.from(groups.values()).map((g) => {
      g.submissions.sort((a, b) => (b.submittedAt > a.submittedAt ? 1 : -1));
      const sum = g.submissions.reduce((acc, x) => acc + x.score0to100, 0);
      g.avgScore = Math.round(sum / g.submissions.length);
      return g;
    });
  }, [submissions]);

  // Available coaches dropdown (only coaches that actually have submissions)
  const coachesWithSubmissions = useMemo(() => {
    const s = new Set<string>();
    for (const c of perClient) if (c.coachName) s.add(c.coachName);
    return Array.from(s).sort();
  }, [perClient]);

  // Apply filters
  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return perClient
      .filter((c) => (coachFilter === "all" ? true : c.coachName === coachFilter))
      .filter((c) => (q ? c.clientName.toLowerCase().includes(q) : true))
      .sort((a, b) => (b.latestSubmittedAt > a.latestSubmittedAt ? 1 : -1));
  }, [perClient, coachFilter, search]);

  // Header metric: net overall avg, or selected coach's avg
  const headerAvg = useMemo(() => {
    if (filteredClients.length === 0) return null;
    const sum = filteredClients.reduce((acc, c) => acc + c.avgScore, 0);
    return Math.round(sum / filteredClients.length);
  }, [filteredClients]);

  // Chart picker — separate state from the table search/filter so coaches
  // can chart a specific client while still browsing the broader table.
  // Picker shows ALL clients ever on CCOS (not just submitting clients).
  const [chartClientId, setChartClientId] = useState<number | null>(null);
  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name)),
    [clients]
  );
  const chartData = useMemo(() => {
    if (!chartClientId) return [];
    const subs = submissions
      .filter((s) => s.clientId === chartClientId)
      .sort((a, b) => (a.submittedAt > b.submittedAt ? 1 : -1));
    return subs.map((s) => ({
      date: new Date(s.submittedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      score: s.score0to100,
    }));
  }, [chartClientId, submissions]);
  const chartedClient = chartClientId
    ? sortedClients.find((c) => c.id === chartClientId)
    : null;

  const headerLabel =
    coachFilter === "all"
      ? "Net overall avg effectiveness"
      : `${coachFilter}'s avg effectiveness`;

  const handleDelete = async (submissionId: number) => {
    if (!confirm("Delete this check-in submission? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/check-in/submissions/${submissionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Delete failed: ${data.error || res.statusText}`);
        return;
      }
      setSubmissions((rows) => rows.filter((r) => r.id !== submissionId));
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : "network error"}`);
    }
  };

  return (
    <div>
      {/* Top KPIs */}
      <div className="metric-grid metric-grid-3" style={{ marginBottom: 16 }}>
        <div className="glass-static metric-card">
          <div className="metric-card-label">{headerLabel}</div>
          <div
            className="metric-card-value"
            style={{
              color: headerAvg == null ? "var(--text-muted)" : scoreColor(headerAvg),
            }}
          >
            {headerAvg == null ? "—" : `${headerAvg}`}
            {headerAvg != null && (
              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)", marginLeft: 4 }}>
                /100
              </span>
            )}
          </div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Clients with check-ins</div>
          <div className="metric-card-value">{filteredClients.length}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Total submissions</div>
          <div className="metric-card-value">
            {filteredClients.reduce((acc, c) => acc + c.submissions.length, 0)}
          </div>
        </div>
      </div>

      {/* Per-client chart — picker shows ALL clients ever on CCOS.
          Sits above the table because it's the "deep-dive" view for one
          specific client, while the table is the "browse everyone"
          view. Coaches usually arrive with a name in mind. */}
      <div
        className="glass-static"
        style={{ padding: 16, marginBottom: 16 }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              margin: 0,
            }}
          >
            <LineChartIcon size={14} /> Client check-in trend
          </h3>
          <select
            className="input-field"
            value={chartClientId ?? ""}
            onChange={(e) =>
              setChartClientId(e.target.value ? Number(e.target.value) : null)
            }
            style={{ minWidth: 240, maxWidth: 360 }}
          >
            <option value="">Select a client…</option>
            {sortedClients.map((c) => (
              <option key={c.id ?? c.name} value={c.id ?? ""}>
                {c.name}
                {c.coachName ? ` · ${c.coachName}` : ""}
              </option>
            ))}
          </select>
        </div>
        {!chartedClient ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            Pick a client to see their check-in score over time.
          </div>
        ) : chartData.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            {chartedClient.name} hasn&apos;t submitted any check-in forms yet.
          </div>
        ) : (
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                <XAxis
                  dataKey="date"
                  stroke="var(--text-muted)"
                  fontSize={11}
                />
                <YAxis
                  domain={[0, 100]}
                  stroke="var(--text-muted)"
                  fontSize={11}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-primary)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 12,
                  }}
                  formatter={(value) => [`${value}/100`, "Score"]}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="var(--accent)"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "var(--accent)" }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Check-in link — pinned just above the controls so coaches can
          re-grab the URL without tab-hopping to Milestones. */}
      <CheckInLinkBox style={{ marginTop: 0, marginBottom: 16 }} />

      {/* Controls */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: 10,
              color: "var(--text-muted)",
            }}
          />
          <input
            type="text"
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field"
            style={{ paddingLeft: 32, width: "100%" }}
          />
        </div>
        <select
          value={coachFilter}
          onChange={(e) => setCoachFilter(e.target.value)}
          className="input-field"
          style={{ width: "auto" }}
        >
          <option value="all">All Coaches</option>
          {coachesWithSubmissions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {filteredClients.length === 0 ? (
        <div
          className="glass-static"
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          {submissions.length === 0
            ? "No check-in submissions yet. Share the /check-in link with clients to get started."
            : "No clients match your filters."}
        </div>
      ) : (
        <div className="glass-static" style={{ overflow: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Client</th>
                <th>Coach</th>
                <th>Days Left</th>
                <th>Forms</th>
                <th>Effectiveness</th>
                <th>Last submitted</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((c) => {
                const key = c.clientId ? `id:${c.clientId}` : `name:${c.clientName}`;
                const expanded = expandedClientKey === key;
                const days = daysLeftFromEndDate(c.endDate);
                return (
                  <Fragment key={key}>
                    <tr
                      onClick={() => setExpandedClientKey(expanded ? null : key)}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ color: "var(--text-muted)" }}>
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td
                        style={{
                          fontWeight: 600,
                          color: "var(--text-primary)",
                        }}
                      >
                        {c.clientName}
                      </td>
                      <td>{c.coachName ?? "—"}</td>
                      <td>
                        {days == null ? (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        ) : days <= 0 ? (
                          <span style={{ color: "var(--text-muted)" }}>Ended</span>
                        ) : (
                          <span
                            style={{
                              fontWeight: 600,
                              color:
                                days <= 7
                                  ? "var(--danger)"
                                  : days <= 21
                                    ? "var(--warning)"
                                    : "var(--success)",
                            }}
                          >
                            {days}d
                          </span>
                        )}
                      </td>
                      <td>{c.submissions.length}</td>
                      <td>
                        <span
                          style={{
                            fontWeight: 700,
                            color: scoreColor(c.avgScore),
                          }}
                        >
                          {c.avgScore}
                        </span>
                        <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 4 }}>
                          /100
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {formatDateTime(c.latestSubmittedAt)}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0 }}>
                          <div
                            style={{
                              padding: 16,
                              background: "var(--hover-bg-subtle)",
                              borderTop: "1px solid var(--border-primary)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                marginBottom: 12,
                                fontWeight: 600,
                              }}
                            >
                              All submissions ({c.submissions.length})
                            </div>
                            <div
                              style={{ display: "flex", flexDirection: "column", gap: 10 }}
                            >
                              {c.submissions.map((s) => (
                                <div
                                  key={s.id}
                                  style={{
                                    padding: 12,
                                    borderRadius: 8,
                                    background: "var(--bg-card)",
                                    border: "1px solid var(--border-primary)",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      marginBottom: 10,
                                      gap: 10,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                      {formatDateTime(s.submittedAt)}
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                      <span
                                        style={{
                                          fontSize: 13,
                                          fontWeight: 700,
                                          color: scoreColor(s.score0to100),
                                        }}
                                      >
                                        {s.score0to100}/100
                                      </span>
                                      {isOwner && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(s.id);
                                          }}
                                          style={{
                                            background: "none",
                                            border: "none",
                                            cursor: "pointer",
                                            color: "var(--text-muted)",
                                            padding: 4,
                                            display: "flex",
                                            alignItems: "center",
                                          }}
                                          title="Delete submission (owner only)"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  <div
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                                      gap: 8,
                                      fontSize: 12,
                                      color: "var(--text-secondary)",
                                      marginBottom: s.q5OpenResponse ? 10 : 0,
                                    }}
                                  >
                                    <ScoreCell label="Q1 Coaching" value={s.q1Overall} max={10} />
                                    <ScoreCell label="Q2 Strength" value={s.q2Strength} max={10} />
                                    <ScoreCell label="Q3 Nutrition/Sleep" value={s.q3Lifestyle} max={10} />
                                    <ScoreCell label="Q4 Progress" value={s.q4Progress} max={10} />
                                  </div>
                                  {s.q5OpenResponse && (
                                    <div
                                      style={{
                                        marginTop: 6,
                                        padding: "8px 10px",
                                        borderLeft: "2px solid var(--accent)",
                                        background: "var(--hover-bg-subtle)",
                                        fontSize: 12,
                                        color: "var(--text-secondary)",
                                        whiteSpace: "pre-wrap",
                                        lineHeight: 1.5,
                                        borderRadius: "0 6px 6px 0",
                                      }}
                                    >
                                      {s.q5OpenResponse}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ScoreCell({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {label}
      </div>
      <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
        {value}
        <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: 2 }}>/{max}</span>
      </div>
    </div>
  );
}

