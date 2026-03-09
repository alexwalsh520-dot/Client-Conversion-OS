"use client";

import { useState, useEffect, useCallback } from "react";
import {
  MessageSquareText,
  Users,
  PhoneCall,
  Link2,
  CreditCard,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  AlertCircle,
  Send,
  ClipboardCheck,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────

type Client = "tyson" | "keith";

interface ManychatDashboard {
  newLeads: number;
  leadsEngaged: number;
  callLinksSent: number;
  subLinksSent: number;
}

interface ManychatMetrics {
  dashboard: ManychatDashboard;
  setters: Record<string, ManychatDashboard>;
  tagsDetected: boolean;
}

// ── Constants ─────────────────────────────────────────────────

const CLIENT_OPTIONS: { value: Client; label: string }[] = [
  { value: "tyson", label: "Tyson Sonnek" },
  { value: "keith", label: "Keith Holland" },
];

const CLIENT_SETTERS: Record<Client, string[]> = {
  tyson: ["Amara", "Kelechi"],
  keith: ["Gideon", "Debbie"],
};

const REQUIRED_TAGS = [
  "new_lead",
  "lead_engaged",
  "call_link_sent",
  "sub_link_sent",
  "setter_amara",
  "setter_kelechi",
  "setter_gideon",
  "setter_debbie",
];

// ── Helpers ───────────────────────────────────────────────────

function getMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function getToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ── Main Page Component ───────────────────────────────────────

export default function DMReviewsPage() {
  // Filters
  const [client, setClient] = useState<Client>("tyson");
  const [dateMode, setDateMode] = useState<"mtd" | "custom">("mtd");
  const [dateFrom, setDateFrom] = useState(getMonthStart());
  const [dateTo, setDateTo] = useState(getToday());

  // Data states
  const [manychat, setManychat] = useState<ManychatMetrics | null>(null);
  const [manychatLoading, setManychatLoading] = useState(true);
  const [manychatError, setManychatError] = useState("");

  const [callsBooked, setCallsBooked] = useState<number | null>(null);
  const [callsLoading, setCallsLoading] = useState(true);
  const [callsError, setCallsError] = useState("");

  const [subsSold, setSubsSold] = useState<number | null>(null);
  const [subsLoading, setSubsLoading] = useState(true);
  const [subsError, setSubsError] = useState("");

  // Setup banner
  const [setupExpanded, setSetupExpanded] = useState(false);

  // Transcripts from database
  interface Transcript {
    id: string;
    setter_name: string;
    transcript: string;
    submitted_at: string;
    reviewed: boolean;
    review_result: string | null;
    reviewed_at: string | null;
  }
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [transcriptsLoading, setTranscriptsLoading] = useState(true);
  const [transcriptsError, setTranscriptsError] = useState("");
  const [reviewingSetter, setReviewingSetter] = useState<string | null>(null);
  const [latestReviewResult, setLatestReviewResult] = useState<{ setter: string; result: string } | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // Derived
  const effectiveDateFrom = dateMode === "mtd" ? getMonthStart() : dateFrom;
  const effectiveDateTo = dateMode === "mtd" ? getToday() : dateTo;
  const setters = CLIENT_SETTERS[client];

  // ── Fetch all data ────────────────────────────────────────

  const fetchData = useCallback(() => {
    const params = `client=${client}&dateFrom=${effectiveDateFrom}&dateTo=${effectiveDateTo}`;

    // Manychat
    setManychatLoading(true);
    setManychatError("");
    fetch(`/api/dm-reviews/manychat-metrics?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setManychat(data);
      })
      .catch((err) => setManychatError(err.message))
      .finally(() => setManychatLoading(false));

    // GHL bookings
    setCallsLoading(true);
    setCallsError("");
    fetch(`/api/dm-reviews/ghl-bookings?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCallsBooked(data.callsBooked);
      })
      .catch((err) => setCallsError(err.message))
      .finally(() => setCallsLoading(false));

    // Stripe sales
    setSubsLoading(true);
    setSubsError("");
    fetch(`/api/dm-reviews/stripe-sales?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSubsSold(data.subscriptionsSold);
      })
      .catch((err) => setSubsError(err.message))
      .finally(() => setSubsLoading(false));

    // Transcripts
    setTranscriptsLoading(true);
    setTranscriptsError("");
    fetch(`/api/dm-reviews/transcripts?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setTranscripts(data.transcripts ?? []);
      })
      .catch((err) => setTranscriptsError(err.message))
      .finally(() => setTranscriptsLoading(false));
  }, [client, effectiveDateFrom, effectiveDateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Derived: pending transcripts by setter, review history ──

  const pendingBySetter = setters.reduce((acc, s) => {
    acc[s] = transcripts.filter((t) => t.setter_name === s && !t.reviewed);
    return acc;
  }, {} as Record<string, Transcript[]>);

  // Build review history by grouping reviewed transcripts with same review_result
  const reviewedTranscripts = transcripts.filter((t) => t.reviewed && t.review_result);
  const reviewMap = new Map<string, { setter: string; result: string; date: string; count: number; id: string }>();
  for (const t of reviewedTranscripts) {
    const key = t.review_result!;
    if (!reviewMap.has(key)) {
      reviewMap.set(key, {
        setter: t.setter_name,
        result: t.review_result!,
        date: t.reviewed_at || t.submitted_at,
        count: 1,
        id: t.id,
      });
    } else {
      reviewMap.get(key)!.count++;
    }
  }
  const reviewHistory = Array.from(reviewMap.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // ── Run AI review on all pending transcripts for a setter ──

  const handleStartReview = async (setter: string) => {
    const pending = pendingBySetter[setter];
    if (!pending || pending.length === 0) return;

    setReviewingSetter(setter);
    setLatestReviewResult(null);

    try {
      // Combine all transcripts into one prompt
      const combined = pending
        .map(
          (t, i) =>
            `--- Conversation ${i + 1} (submitted ${new Date(t.submitted_at).toLocaleDateString()}) ---\n${t.transcript}`
        )
        .join("\n\n");

      // Call Claude for batch review
      const res = await fetch("/api/dm-reviews/review-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: combined, setterName: setter }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Save result to all transcripts in the batch
      await Promise.all(
        pending.map((t) =>
          fetch("/api/dm-reviews/transcripts", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: t.id, reviewResult: data.review }),
          })
        )
      );

      // Update local state
      const now = new Date().toISOString();
      setTranscripts((prev) =>
        prev.map((tr) =>
          pending.find((p) => p.id === tr.id)
            ? { ...tr, reviewed: true, review_result: data.review, reviewed_at: now }
            : tr
        )
      );

      setLatestReviewResult({ setter, result: data.review });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Review failed");
    } finally {
      setReviewingSetter(null);
    }
  };

  // ── Render helpers ────────────────────────────────────────

  const renderKPICard = (
    label: string,
    value: number | null,
    loading: boolean,
    error: string,
    icon: React.ReactNode
  ) => (
    <div className="glass-static metric-card" style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span style={{ color: "var(--text-muted)" }}>{icon}</span>
        <span className="metric-card-label" style={{ margin: 0 }}>
          {label}
        </span>
      </div>
      {loading ? (
        <div className="metric-card-value" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : error ? (
        <div
          className="metric-card-value"
          style={{ color: "var(--text-muted)", cursor: "help" }}
          title={error}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            &mdash;
            <AlertCircle size={14} style={{ color: "var(--danger)" }} />
          </span>
        </div>
      ) : (
        <div className="metric-card-value">{value ?? 0}</div>
      )}
    </div>
  );

  const showTagsBanner = manychat && !manychat.tagsDetected;

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">DM Reviews</h1>
        <p className="page-subtitle">
          DM setter performance, funnel metrics, and AI-powered transcript reviews
        </p>
      </div>

      {/* ═══ Setup Banner ═══ */}
      {showTagsBanner && (
        <div
          className="glass-static"
          style={{
            padding: "16px 20px",
            marginBottom: 24,
            borderLeft: "2px solid var(--warning)",
          }}
        >
          <button
            onClick={() => setSetupExpanded(!setupExpanded)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              color: "var(--warning)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Info size={16} />
            Setup Required: Manychat Tags
            {setupExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {setupExpanded && (
            <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <p style={{ marginBottom: 8 }}>
                Manychat tags not detected. Set up the required tags in your Manychat flows:
              </p>
              <div
                style={{
                  background: "var(--bg-glass)",
                  padding: "12px 16px",
                  borderRadius: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                Required tags: {REQUIRED_TAGS.join(", ")}
              </div>
              <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
                <li>
                  Create these tags in Manychat:{" "}
                  <code style={{ color: "var(--accent)" }}>new_lead</code>,{" "}
                  <code style={{ color: "var(--accent)" }}>lead_engaged</code>,{" "}
                  <code style={{ color: "var(--accent)" }}>call_link_sent</code>,{" "}
                  <code style={{ color: "var(--accent)" }}>sub_link_sent</code>,{" "}
                  <code style={{ color: "var(--accent)" }}>setter_amara</code>,{" "}
                  <code style={{ color: "var(--accent)" }}>setter_kelechi</code>,{" "}
                  <code style={{ color: "var(--accent)" }}>setter_gideon</code>,{" "}
                  <code style={{ color: "var(--accent)" }}>setter_debbie</code>
                </li>
                <li>
                  In the lead magnet flow: Add action to apply{" "}
                  <code style={{ color: "var(--accent)" }}>new_lead</code> tag when flow triggers
                </li>
                <li>
                  After the &quot;Wait for reply&quot; step (after the automated question): Apply{" "}
                  <code style={{ color: "var(--accent)" }}>lead_engaged</code> tag
                </li>
                <li>
                  Create Quick Action buttons for setters:
                  <ul style={{ paddingLeft: 16, marginTop: 4 }}>
                    <li>
                      &quot;Send Call Link&quot; button → sends the booking URL AND applies{" "}
                      <code style={{ color: "var(--accent)" }}>call_link_sent</code> tag
                    </li>
                    <li>
                      &quot;Send Sub Link&quot; button → sends the Stripe link AND applies{" "}
                      <code style={{ color: "var(--accent)" }}>sub_link_sent</code> tag
                    </li>
                  </ul>
                </li>
                <li>
                  When a lead is assigned to a setter, apply the corresponding{" "}
                  <code style={{ color: "var(--accent)" }}>setter_[name]</code> tag
                </li>
              </ol>
            </div>
          )}
        </div>
      )}

      {/* ═══ Section 1: Filters ═══ */}
      <div className="section">
        <div
          className="glass-static"
          style={{ padding: "16px 20px" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            {/* Client dropdown */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label className="form-label" style={{ margin: 0, whiteSpace: "nowrap" }}>
                Client
              </label>
              <select
                className="form-input"
                value={client}
                onChange={(e) => setClient(e.target.value as Client)}
                style={{ width: "auto", minWidth: 160, padding: "8px 12px" }}
              >
                {CLIENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ width: 1, height: 24, background: "var(--border-primary)" }} />

            {/* Date range */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                className={`context-tab ${dateMode === "mtd" ? "context-tab-active" : ""}`}
                onClick={() => setDateMode("mtd")}
              >
                Month to Date
              </button>
              <button
                className={`context-tab ${dateMode === "custom" ? "context-tab-active" : ""}`}
                onClick={() => setDateMode("custom")}
              >
                Custom Range
              </button>
            </div>

            {dateMode === "custom" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="date"
                  className="form-input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  style={{ width: "auto", padding: "8px 12px" }}
                />
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>to</span>
                <input
                  type="date"
                  className="form-input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  style={{ width: "auto", padding: "8px 12px" }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Section 2: KPI Dashboard ═══ */}
      <div className="section">
        <h2 className="section-title">
          <ClipboardCheck size={16} />
          Client Dashboard
        </h2>
        <div className="metric-grid metric-grid-6">
          {renderKPICard(
            "New Leads",
            manychat?.dashboard.newLeads ?? null,
            manychatLoading,
            manychatError,
            <UserCheck size={16} />
          )}
          {renderKPICard(
            "Leads Engaged",
            manychat?.dashboard.leadsEngaged ?? null,
            manychatLoading,
            manychatError,
            <MessageSquareText size={16} />
          )}
          {renderKPICard(
            "Call Links Sent",
            manychat?.dashboard.callLinksSent ?? null,
            manychatLoading,
            manychatError,
            <Link2 size={16} />
          )}
          {renderKPICard(
            "Sub Links Sent",
            manychat?.dashboard.subLinksSent ?? null,
            manychatLoading,
            manychatError,
            <Send size={16} />
          )}
          {renderKPICard(
            "Calls Booked",
            callsBooked,
            callsLoading,
            callsError,
            <PhoneCall size={16} />
          )}
          {renderKPICard(
            "Subs Sold",
            subsSold,
            subsLoading,
            subsError,
            <CreditCard size={16} />
          )}
        </div>
      </div>

      {/* ═══ Section 3: Setter Performance ═══ */}
      <div className="section">
        <h2 className="section-title">
          <Users size={16} />
          Setter Performance
        </h2>
        <div className="glass-static" style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>Setter</th>
                <th>New Leads</th>
                <th>Leads Engaged</th>
                <th>Call Links Sent</th>
                <th>Sub Links Sent</th>
                <th>Calls Booked</th>
                <th>Subs Sold</th>
                <th>Avg Response Time</th>
              </tr>
            </thead>
            <tbody>
              {setters.map((setter) => {
                const key = setter.toLowerCase();
                const metrics = manychat?.setters[key];
                return (
                  <tr key={setter}>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      {setter}
                    </td>
                    <td>
                      {manychatLoading ? (
                        <Loader2 size={14} className="spin" style={{ color: "var(--text-muted)" }} />
                      ) : manychatError ? (
                        <span title={manychatError} style={{ color: "var(--text-muted)", cursor: "help" }}>
                          &mdash;
                        </span>
                      ) : (
                        metrics?.newLeads ?? 0
                      )}
                    </td>
                    <td>
                      {manychatLoading ? (
                        <Loader2 size={14} className="spin" style={{ color: "var(--text-muted)" }} />
                      ) : manychatError ? (
                        <span title={manychatError} style={{ color: "var(--text-muted)", cursor: "help" }}>
                          &mdash;
                        </span>
                      ) : (
                        metrics?.leadsEngaged ?? 0
                      )}
                    </td>
                    <td>
                      {manychatLoading ? (
                        <Loader2 size={14} className="spin" style={{ color: "var(--text-muted)" }} />
                      ) : manychatError ? (
                        <span title={manychatError} style={{ color: "var(--text-muted)", cursor: "help" }}>
                          &mdash;
                        </span>
                      ) : (
                        metrics?.callLinksSent ?? 0
                      )}
                    </td>
                    <td>
                      {manychatLoading ? (
                        <Loader2 size={14} className="spin" style={{ color: "var(--text-muted)" }} />
                      ) : manychatError ? (
                        <span title={manychatError} style={{ color: "var(--text-muted)", cursor: "help" }}>
                          &mdash;
                        </span>
                      ) : (
                        metrics?.subLinksSent ?? 0
                      )}
                    </td>
                    <td>
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>N/A</span>
                    </td>
                    <td>
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>N/A</span>
                    </td>
                    <td>
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>N/A</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ Section 4: DM Review ═══ */}
      <div className="section">
        <h2 className="section-title">
          <MessageSquareText size={16} />
          DM Review
        </h2>

        {transcriptsLoading ? (
          <div className="glass-static" style={{ padding: 40, textAlign: "center" }}>
            <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : transcriptsError ? (
          <div
            className="glass-static"
            style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 8 }}
          >
            <AlertCircle size={16} style={{ color: "var(--danger)" }} />
            <span style={{ fontSize: 13, color: "var(--danger)" }}>{transcriptsError}</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {setters.map((setter) => {
              const pending = pendingBySetter[setter] || [];
              const isReviewing = reviewingSetter === setter;
              const showResult = latestReviewResult?.setter === setter;

              return (
                <div key={setter} className="glass-static" style={{ overflow: "hidden" }}>
                  <div
                    style={{
                      padding: "18px 20px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span
                        style={{
                          fontWeight: 600,
                          color: "var(--text-primary)",
                          fontSize: 15,
                        }}
                      >
                        {setter}
                      </span>
                      <span
                        style={{
                          color: pending.length > 0 ? "var(--accent)" : "var(--text-muted)",
                          fontSize: 13,
                        }}
                      >
                        {pending.length} pending transcript{pending.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <button
                      className="btn-primary"
                      onClick={() => handleStartReview(setter)}
                      disabled={isReviewing || pending.length === 0}
                      style={{
                        opacity: isReviewing || pending.length === 0 ? 0.5 : 1,
                        cursor: isReviewing || pending.length === 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      {isReviewing ? (
                        <>
                          <Loader2 size={14} className="spin" />
                          Analyzing...
                        </>
                      ) : (
                        "Start Review"
                      )}
                    </button>
                  </div>

                  {/* Show review result inline after running */}
                  {showResult && latestReviewResult && (
                    <div style={{ borderTop: "1px solid var(--border-primary)", padding: 20 }}>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 500,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                          color: "var(--text-muted)",
                          marginBottom: 12,
                        }}
                      >
                        AI Review &middot; {pending.length} transcript{pending.length !== 1 ? "s" : ""} analyzed &middot; Just now
                      </div>
                      <ReviewMarkdown content={latestReviewResult.result} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ Section 5: Review History ═══ */}
      <div className="section">
        <h2 className="section-title">
          <ClipboardCheck size={16} />
          Review History
        </h2>

        {transcriptsLoading ? (
          <div className="glass-static" style={{ padding: 40, textAlign: "center" }}>
            <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : reviewHistory.length === 0 ? (
          <div
            className="glass-static"
            style={{
              padding: "40px 20px",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            No reviews completed yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reviewHistory.map((review) => {
              const isExpanded = expandedHistoryId === review.id;
              const date = new Date(review.date);

              return (
                <div key={review.id} className="glass-static" style={{ overflow: "hidden" }}>
                  <div
                    style={{
                      padding: "14px 20px",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      cursor: "pointer",
                    }}
                    onClick={() => setExpandedHistoryId(isExpanded ? null : review.id)}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        fontSize: 14,
                        minWidth: 80,
                      }}
                    >
                      {review.setter}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      {date.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      at {date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--accent)",
                      }}
                    >
                      {review.count} transcript{review.count !== 1 ? "s" : ""}
                    </span>
                    <span style={{ flex: 1 }} />
                    {isExpanded ? (
                      <ChevronUp size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    ) : (
                      <ChevronDown size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    )}
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop: "1px solid var(--border-primary)", padding: 20 }}>
                      <ReviewMarkdown content={review.result} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Simple Markdown Renderer ──────────────────────────────────

function ReviewMarkdown({ content }: { content: string }) {
  // Parse markdown into rendered HTML-like JSX
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: "ol" | "ul" | null = null;

  const flushList = () => {
    if (listItems.length > 0 && listType) {
      const items = listItems.map((item, i) => (
        <li key={i} style={{ marginBottom: 4 }}>
          <InlineMarkdown text={item} />
        </li>
      ));
      if (listType === "ol") {
        elements.push(
          <ol
            key={`list-${elements.length}`}
            style={{ paddingLeft: 20, margin: "8px 0", color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.7 }}
          >
            {items}
          </ol>
        );
      } else {
        elements.push(
          <ul
            key={`list-${elements.length}`}
            style={{ paddingLeft: 20, margin: "8px 0", color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.7 }}
          >
            {items}
          </ul>
        );
      }
      listItems = [];
      listType = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headers
    if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <h3
          key={`h-${i}`}
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: "20px 0 8px",
            paddingBottom: 6,
            borderBottom: "1px solid var(--border-primary)",
          }}
        >
          {line.replace("## ", "")}
        </h3>
      );
      continue;
    }

    if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h4
          key={`h3-${i}`}
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: "16px 0 6px",
          }}
        >
          {line.replace("### ", "")}
        </h4>
      );
      continue;
    }

    // Numbered lists
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(olMatch[1]);
      continue;
    }

    // Bullet lists
    const ulMatch = line.match(/^[-*]\s+(.*)/);
    if (ulMatch) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(ulMatch[1]);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      flushList();
      continue;
    }

    // Paragraph
    flushList();
    elements.push(
      <p
        key={`p-${i}`}
        style={{
          margin: "8px 0",
          color: "var(--text-secondary)",
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
        <InlineMarkdown text={line} />
      </p>
    );
  }

  flushList();

  return <div>{elements}</div>;
}

function InlineMarkdown({ text }: { text: string }) {
  // Handle **bold** and *italic* and `code`
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Code
    const codeMatch = remaining.match(/`(.+?)`/);

    // Find earliest match
    let earliest: { type: "bold" | "code"; index: number; full: string; inner: string } | null = null;

    if (boldMatch && boldMatch.index !== undefined) {
      earliest = { type: "bold", index: boldMatch.index, full: boldMatch[0], inner: boldMatch[1] };
    }
    if (codeMatch && codeMatch.index !== undefined) {
      if (!earliest || codeMatch.index < earliest.index) {
        earliest = { type: "code", index: codeMatch.index, full: codeMatch[0], inner: codeMatch[1] };
      }
    }

    if (!earliest) {
      parts.push(remaining);
      break;
    }

    // Add text before match
    if (earliest.index > 0) {
      parts.push(remaining.substring(0, earliest.index));
    }

    if (earliest.type === "bold") {
      parts.push(
        <strong key={key++} style={{ color: "var(--text-primary)", fontWeight: 600 }}>
          {earliest.inner}
        </strong>
      );
    } else {
      parts.push(
        <code
          key={key++}
          style={{
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(255,255,255,0.06)",
            fontSize: "0.9em",
            color: "var(--accent)",
          }}
        >
          {earliest.inner}
        </code>
      );
    }

    remaining = remaining.substring(earliest.index + earliest.full.length);
  }

  return <>{parts}</>;
}
