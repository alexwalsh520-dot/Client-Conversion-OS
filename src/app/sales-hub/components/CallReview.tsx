"use client";

import { useState, useCallback } from "react";
import {
  Phone,
  Play,
  Clock,
  Loader2,
  AlertCircle,
  ClipboardPaste,
  History,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import type { Filters } from "../types";
import { getEffectiveDates } from "./FilterBar";
import { ReviewMarkdown } from "./ReviewMarkdown";

/* ── Types ────────────────────────────────────────────────────────── */

interface FathomCall {
  id: string;
  title: string;
  created_at: string;
  duration?: number;
  transcript?: string;
}

interface ReviewHistoryEntry {
  id: string;
  closerName: string;
  callTitle: string;
  review: string;
  timestamp: string;
}

interface CallReviewProps {
  filters: Filters;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

const CLOSERS = ["Broz", "Will", "Austin"];

function formatDuration(seconds?: number): string {
  if (!seconds) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ── Component ────────────────────────────────────────────────────── */

export default function CallReview({ filters }: CallReviewProps) {
  const [activeTab, setActiveTab] = useState<"fathom" | "paste">("fathom");
  const [closer, setCloser] = useState(CLOSERS[0]);
  const [calls, setCalls] = useState<FathomCall[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fathomNotConfigured, setFathomNotConfigured] = useState(false);

  // Expanded call
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  // Review state
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Paste tab state
  const [pasteTranscript, setPasteTranscript] = useState("");
  const [pasteCloserName, setPasteCloserName] = useState(CLOSERS[0]);
  const [pasteReviewLoading, setPasteReviewLoading] = useState(false);
  const [pasteReviewResult, setPasteReviewResult] = useState<string | null>(null);
  const [pasteReviewError, setPasteReviewError] = useState<string | null>(null);

  // Review history
  const [reviewHistory, setReviewHistory] = useState<ReviewHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  /* ── Fetch calls from Fathom ─────────────────────────────────── */

  const fetchCalls = useCallback(async () => {
    setFetchLoading(true);
    setFetchError(null);
    setFathomNotConfigured(false);
    setCalls([]);
    setExpandedCallId(null);
    setReviewResult(null);

    try {
      const { dateFrom, dateTo } = getEffectiveDates(filters);
      const params = new URLSearchParams({
        closer,
        dateFrom,
        dateTo,
        includeTranscript: "true",
      });

      const res = await fetch(`/api/sales-hub/fathom-calls?${params}`);
      const data = await res.json();

      if (data.error && data.error.includes("not configured")) {
        setFathomNotConfigured(true);
        setActiveTab("paste");
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch calls");
      }

      const meetings: FathomCall[] = (data.meetings || []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m: any) => ({
          id: m.id || m._id || crypto.randomUUID(),
          title: m.title || "Untitled Call",
          created_at: m.created_at || m.createdAt || new Date().toISOString(),
          duration: m.duration || m.duration_seconds || undefined,
          transcript: m.transcript || m.transcriptText || undefined,
        })
      );

      setCalls(meetings);

      if (meetings.length === 0) {
        setFetchError("No calls found for this closer in the selected date range.");
      }
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Failed to fetch calls"
      );
    } finally {
      setFetchLoading(false);
    }
  }, [closer, filters]);

  /* ── Run review ──────────────────────────────────────────────── */

  const runReview = useCallback(
    async (transcript: string, closerName: string, callTitle?: string) => {
      setReviewLoading(true);
      setReviewResult(null);
      setReviewError(null);

      try {
        const res = await fetch("/api/sales-hub/review-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript,
            setterName: closerName,
            type: "call",
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to run review");
        }

        setReviewResult(data.review);

        // Save to history
        setReviewHistory((prev) => [
          {
            id: crypto.randomUUID(),
            closerName,
            callTitle: callTitle || "Manual Paste",
            review: data.review,
            timestamp: new Date().toISOString(),
          },
          ...prev,
        ]);
      } catch (err) {
        setReviewError(
          err instanceof Error ? err.message : "Failed to run review"
        );
      } finally {
        setReviewLoading(false);
      }
    },
    []
  );

  /* ── Paste tab review ────────────────────────────────────────── */

  const runPasteReview = useCallback(async () => {
    if (!pasteTranscript.trim()) return;

    setPasteReviewLoading(true);
    setPasteReviewResult(null);
    setPasteReviewError(null);

    try {
      const res = await fetch("/api/sales-hub/review-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: pasteTranscript,
          setterName: pasteCloserName,
          type: "call",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to run review");
      }

      setPasteReviewResult(data.review);

      setReviewHistory((prev) => [
        {
          id: crypto.randomUUID(),
          closerName: pasteCloserName,
          callTitle: "Manual Paste",
          review: data.review,
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ]);
    } catch (err) {
      setPasteReviewError(
        err instanceof Error ? err.message : "Failed to run review"
      );
    } finally {
      setPasteReviewLoading(false);
    }
  }, [pasteTranscript, pasteCloserName]);

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="section">
      <h2 className="section-title">
        <Phone size={16} />
        Call Transcript Review
      </h2>

      {/* Fathom not configured notice */}
      {fathomNotConfigured && (
        <div
          className="glass-static"
          style={{
            padding: "16px 20px",
            marginBottom: 16,
            borderLeft: "3px solid var(--warning)",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <Info
            size={18}
            style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }}
          />
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: 4,
              }}
            >
              Fathom Not Connected
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
              }}
            >
              Connect Fathom API to auto-pull call recordings. Add{" "}
              <code
                style={{
                  color: "var(--accent)",
                  background: "rgba(255,255,255,0.06)",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                FATHOM_API_KEY
              </code>{" "}
              in Vercel environment variables.
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 16,
        }}
      >
        <button
          className={`context-tab ${activeTab === "fathom" ? "context-tab-active" : ""}`}
          onClick={() => setActiveTab("fathom")}
        >
          <Phone
            size={14}
            style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }}
          />
          Fathom Calls
        </button>
        <button
          className={`context-tab ${activeTab === "paste" ? "context-tab-active" : ""}`}
          onClick={() => setActiveTab("paste")}
        >
          <ClipboardPaste
            size={14}
            style={{ display: "inline", verticalAlign: "middle", marginRight: 6 }}
          />
          Paste Transcript
        </button>
      </div>

      {/* ── Fathom Tab ──────────────────────────────────────────── */}
      {activeTab === "fathom" && (
        <div className="glass-static" style={{ padding: 20 }}>
          {/* Controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 20,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label
                className="form-label"
                style={{ margin: 0, whiteSpace: "nowrap" }}
              >
                Closer
              </label>
              <select
                className="form-input"
                value={closer}
                onChange={(e) => setCloser(e.target.value)}
                style={{ width: "auto", minWidth: 140, padding: "8px 12px" }}
              >
                {CLOSERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <button
              className="btn-primary"
              onClick={fetchCalls}
              disabled={fetchLoading}
              style={{ opacity: fetchLoading ? 0.7 : 1 }}
            >
              {fetchLoading ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Phone size={14} />
              )}
              Fetch Calls
            </button>
          </div>

          {/* Fetch error */}
          {fetchError && !fathomNotConfigured && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 16px",
                background: "var(--danger-soft)",
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 13,
                color: "var(--danger)",
              }}
            >
              <AlertCircle size={16} />
              {fetchError}
            </div>
          )}

          {/* Call list */}
          {calls.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {calls.map((call) => {
                const isExpanded = expandedCallId === call.id;
                return (
                  <div
                    key={call.id}
                    className="glass-subtle"
                    style={{ overflow: "hidden" }}
                  >
                    {/* Call header — clickable */}
                    <button
                      onClick={() =>
                        setExpandedCallId(isExpanded ? null : call.id)
                      }
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "14px 16px",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "inherit",
                        fontFamily: "inherit",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <Play
                          size={14}
                          style={{
                            color: isExpanded
                              ? "var(--accent)"
                              : "var(--text-muted)",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: "var(--text-primary)",
                          }}
                        >
                          {call.title}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 16,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--text-muted)",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Clock size={12} />
                          {formatDuration(call.duration)}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--text-muted)",
                          }}
                        >
                          {formatDate(call.created_at)}
                        </span>
                        {isExpanded ? (
                          <ChevronUp
                            size={14}
                            style={{ color: "var(--text-muted)" }}
                          />
                        ) : (
                          <ChevronDown
                            size={14}
                            style={{ color: "var(--text-muted)" }}
                          />
                        )}
                      </div>
                    </button>

                    {/* Expanded view */}
                    {isExpanded && (
                      <div
                        style={{
                          padding: "0 16px 16px",
                          borderTop: "1px solid var(--border-primary)",
                        }}
                      >
                        {/* Transcript */}
                        {call.transcript ? (
                          <div
                            style={{
                              marginTop: 12,
                              maxHeight: 300,
                              overflowY: "auto",
                              padding: 16,
                              background: "rgba(0,0,0,0.3)",
                              borderRadius: 8,
                              fontFamily: "var(--font-mono), monospace",
                              fontSize: 12,
                              color: "var(--text-secondary)",
                              lineHeight: 1.6,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {call.transcript}
                          </div>
                        ) : (
                          <div
                            style={{
                              marginTop: 12,
                              padding: 16,
                              textAlign: "center",
                              fontSize: 13,
                              color: "var(--text-muted)",
                            }}
                          >
                            No transcript available for this call.
                          </div>
                        )}

                        {/* Run Review button */}
                        {call.transcript && (
                          <div style={{ marginTop: 12 }}>
                            <button
                              className="btn-primary"
                              onClick={() =>
                                runReview(call.transcript!, closer, call.title)
                              }
                              disabled={reviewLoading}
                              style={{ opacity: reviewLoading ? 0.7 : 1 }}
                            >
                              {reviewLoading ? (
                                <Loader2 size={14} className="spin" />
                              ) : (
                                <Play size={14} />
                              )}
                              Run Review
                            </button>
                          </div>
                        )}

                        {/* Review result (inline) */}
                        {reviewResult && expandedCallId === call.id && (
                          <div
                            className="glass-static"
                            style={{ marginTop: 16, padding: 20 }}
                          >
                            <ReviewMarkdown content={reviewResult} />
                          </div>
                        )}

                        {reviewError && expandedCallId === call.id && (
                          <div
                            style={{
                              marginTop: 12,
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "12px 16px",
                              background: "var(--danger-soft)",
                              borderRadius: 8,
                              fontSize: 13,
                              color: "var(--danger)",
                            }}
                          >
                            <AlertCircle size={16} />
                            {reviewError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Paste Transcript Tab ────────────────────────────────── */}
      {activeTab === "paste" && (
        <div className="glass-static" style={{ padding: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label
                className="form-label"
                style={{ margin: 0, whiteSpace: "nowrap" }}
              >
                Closer Name
              </label>
              <select
                className="form-input"
                value={pasteCloserName}
                onChange={(e) => setPasteCloserName(e.target.value)}
                style={{ width: "auto", minWidth: 140, padding: "8px 12px" }}
              >
                {CLOSERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <textarea
            className="form-input form-textarea"
            placeholder="Paste the full call transcript here..."
            value={pasteTranscript}
            onChange={(e) => setPasteTranscript(e.target.value)}
            style={{
              minHeight: 200,
              fontFamily: "var(--font-mono), monospace",
              fontSize: 12,
              lineHeight: 1.6,
              resize: "vertical",
            }}
          />

          <div style={{ marginTop: 12 }}>
            <button
              className="btn-primary"
              onClick={runPasteReview}
              disabled={
                pasteReviewLoading || !pasteTranscript.trim()
              }
              style={{
                opacity:
                  pasteReviewLoading || !pasteTranscript.trim()
                    ? 0.7
                    : 1,
              }}
            >
              {pasteReviewLoading ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Play size={14} />
              )}
              Run Review
            </button>
          </div>

          {/* Paste review result */}
          {pasteReviewResult && (
            <div
              className="glass-static"
              style={{ marginTop: 16, padding: 20 }}
            >
              <ReviewMarkdown content={pasteReviewResult} />
            </div>
          )}

          {pasteReviewError && (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 16px",
                background: "var(--danger-soft)",
                borderRadius: 8,
                fontSize: 13,
                color: "var(--danger)",
              }}
            >
              <AlertCircle size={16} />
              {pasteReviewError}
            </div>
          )}
        </div>
      )}

      {/* ── Review History ──────────────────────────────────────── */}
      {reviewHistory.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button
            className="section-title"
            onClick={() => setHistoryOpen(!historyOpen)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              width: "100%",
              fontFamily: "inherit",
              padding: 0,
            }}
          >
            <History size={16} />
            Review History ({reviewHistory.length})
            {historyOpen ? (
              <ChevronUp size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>

          {historyOpen && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              {reviewHistory.map((entry) => (
                <HistoryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── History Card (collapsible) ───────────────────────────────── */

function HistoryCard({ entry }: { entry: ReviewHistoryEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="glass-static" style={{ overflow: "hidden" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          fontFamily: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {entry.callTitle}
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            {entry.closerName}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {formatDate(entry.timestamp)}
          </span>
          {open ? (
            <ChevronUp size={14} style={{ color: "var(--text-muted)" }} />
          ) : (
            <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
          )}
        </div>
      </button>
      {open && (
        <div
          style={{
            padding: "0 16px 16px",
            borderTop: "1px solid var(--border-primary)",
          }}
        >
          <div style={{ marginTop: 12 }}>
            <ReviewMarkdown content={entry.review} />
          </div>
        </div>
      )}
    </div>
  );
}
