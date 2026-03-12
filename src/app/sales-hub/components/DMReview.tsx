"use client";

import { useState, useEffect, useCallback } from "react";
import {
  MessageSquare,
  Play,
  Loader2,
  AlertCircle,
  History,
  ChevronDown,
  ChevronUp,
  FileText,
  Download,
} from "lucide-react";
import type { Filters } from "../types";
import { getEffectiveDates } from "./FilterBar";
import { ReviewMarkdown } from "./ReviewMarkdown";

/* ── Types ────────────────────────────────────────────────────────── */

interface Transcript {
  id: string;
  setter_name: string;
  client: string;
  transcript: string;
  submitted_at: string;
  reviewed: boolean;
  review_result: string | null;
  reviewed_at: string | null;
}

interface SetterGroup {
  name: string;
  client: string;
  transcripts: Transcript[];
  pending: number;
}

interface DMReviewProps {
  filters: Filters;
}

/* ── Constants ────────────────────────────────────────────────────── */

const SETTER_MAP: Record<string, string[]> = {
  tyson: ["Amara", "Kelechi"],
  keith: ["Gideon", "Debbie"],
  all: ["Amara", "Kelechi", "Gideon", "Debbie"],
};

const SETTER_CLIENT: Record<string, string> = {
  Amara: "tyson",
  Kelechi: "tyson",
  Gideon: "keith",
  Debbie: "keith",
};

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

export default function DMReview({ filters }: DMReviewProps) {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-setter review state
  const [reviewingStetter, setReviewingSetter] = useState<string | null>(null);
  const [reviewResults, setReviewResults] = useState<Record<string, string>>({});
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});

  // History
  const [historyOpen, setHistoryOpen] = useState(false);

  /* ── Fetch transcripts ──────────────────────────────────────── */

  const fetchTranscripts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { dateFrom, dateTo } = getEffectiveDates(filters);
      const clients =
        filters.client === "all" ? ["tyson", "keith"] : [filters.client];

      const allTranscripts: Transcript[] = [];

      for (const client of clients) {
        const params = new URLSearchParams({ client, dateFrom, dateTo });
        const res = await fetch(`/api/sales-hub/transcripts?${params}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch transcripts");
        }

        allTranscripts.push(...(data.transcripts || []));
      }

      setTranscripts(allTranscripts);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch transcripts"
      );
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchTranscripts();
  }, [fetchTranscripts]);

  /* ── Group by setter ────────────────────────────────────────── */

  const setterNames = SETTER_MAP[filters.client] || SETTER_MAP.all;

  const setterGroups: SetterGroup[] = setterNames.map((name) => {
    const setterTranscripts = transcripts.filter(
      (t) => t.setter_name.toLowerCase() === name.toLowerCase()
    );
    const pending = setterTranscripts.filter((t) => !t.reviewed).length;

    return {
      name,
      client: SETTER_CLIENT[name] || "unknown",
      transcripts: setterTranscripts,
      pending,
    };
  });

  /* ── Run review for a setter ────────────────────────────────── */

  const runSetterReview = useCallback(
    async (setter: SetterGroup) => {
      const toReview = setter.transcripts;
      if (toReview.length === 0) return;

      setReviewingSetter(setter.name);
      setReviewErrors((prev) => ({ ...prev, [setter.name]: "" }));

      try {
        // Combine all transcripts
        const combined = toReview
          .map(
            (t, i) =>
              `--- Conversation ${i + 1} (Submitted: ${formatDate(t.submitted_at)}) ---\n${t.transcript}`
          )
          .join("\n\n");

        // Send for review
        const res = await fetch("/api/sales-hub/review-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: combined,
            setterName: setter.name,
            type: "dm",
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to run review");
        }

        setReviewResults((prev) => ({
          ...prev,
          [setter.name]: data.review,
        }));

        // Send to Slack (fire and forget)
        fetch("/api/sales-hub/send-review-slack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ review: data.review, type: "dm", setterName: setter.name }),
        }).catch(() => {});

        // Save review results back to each transcript
        for (const t of toReview) {
          try {
            await fetch("/api/sales-hub/transcripts", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: t.id,
                reviewResult: data.review,
              }),
            });
          } catch {
            // Non-critical: review was still generated
          }
        }

        // Update local state to mark as reviewed
        setTranscripts((prev) =>
          prev.map((t) =>
            toReview.some((u) => u.id === t.id)
              ? {
                  ...t,
                  reviewed: true,
                  review_result: data.review,
                  reviewed_at: new Date().toISOString(),
                }
              : t
          )
        );
      } catch (err) {
        setReviewErrors((prev) => ({
          ...prev,
          [setter.name]:
            err instanceof Error ? err.message : "Failed to run review",
        }));
      } finally {
        setReviewingSetter(null);
      }
    },
    []
  );

  /* ── Reviewed transcripts (history) ──────────────────────────── */

  const reviewedTranscripts = transcripts.filter(
    (t) => t.reviewed && t.review_result
  );

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="section">
      <h2 className="section-title">
        <MessageSquare size={16} />
        DM Transcript Review
      </h2>

      {/* Loading state */}
      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 40,
          }}
        >
          <Loader2
            size={20}
            className="spin"
            style={{ color: "var(--text-muted)" }}
          />
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Loading transcripts...
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
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
          {error}
        </div>
      )}

      {/* Setter cards */}
      {!loading && (
        <div
          className="metric-grid metric-grid-2"
          style={{ marginBottom: 24 }}
        >
          {setterGroups.map((setter) => {
            const isReviewing = reviewingStetter === setter.name;
            const result = reviewResults[setter.name];
            const reviewError = reviewErrors[setter.name];
            const clientColor =
              setter.client === "tyson" ? "var(--tyson)" : "var(--keith)";

            return (
              <div key={setter.name} className="glass-static" style={{ padding: 20 }}>
                {/* Setter header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: clientColor,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {setter.name}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: clientColor,
                      textTransform: "uppercase",
                      fontWeight: 500,
                      letterSpacing: "0.5px",
                    }}
                  >
                    {setter.client === "tyson" ? "Tyson" : "Keith"}
                  </span>
                </div>

                {/* Stat row */}
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    marginBottom: 16,
                    fontSize: 13,
                  }}
                >
                  <div style={{ color: "var(--text-secondary)" }}>
                    Total:{" "}
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {setter.transcripts.length}
                    </span>
                  </div>
                  <div style={{ color: "var(--text-secondary)" }}>
                    Pending:{" "}
                    <span
                      style={{
                        fontWeight: 600,
                        color:
                          setter.pending > 0
                            ? "var(--warning)"
                            : "var(--success)",
                      }}
                    >
                      {setter.pending}
                    </span>
                  </div>
                </div>

                {/* Start review button */}
                <button
                  className="btn-primary"
                  onClick={() => runSetterReview(setter)}
                  disabled={isReviewing || setter.transcripts.length === 0}
                  style={{
                    opacity: isReviewing || setter.transcripts.length === 0 ? 0.7 : 1,
                    width: "100%",
                    justifyContent: "center",
                  }}
                >
                  {isReviewing ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  Review{setter.transcripts.length > 0 ? ` (${setter.transcripts.length})` : ""}
                </button>

                {/* Review error */}
                {reviewError && (
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 14px",
                      background: "var(--danger-soft)",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "var(--danger)",
                    }}
                  >
                    <AlertCircle size={14} />
                    {reviewError}
                  </div>
                )}

                {/* Inline review result */}
                {result && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: 16,
                      background: "rgba(0,0,0,0.2)",
                      borderRadius: 12,
                      borderLeft: `3px solid ${clientColor}`,
                    }}
                  >
                    <ReviewMarkdown content={result} />
                  </div>
                )}

                {/* Download button */}
                {result && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        const blob = new Blob([result], { type: "text/markdown" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `dm-review-${setter.name}-${new Date().toISOString().split("T")[0]}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      style={{ fontSize: 12 }}
                    >
                      <Download size={12} />
                      Download Review
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Review History ──────────────────────────────────────── */}
      {reviewedTranscripts.length > 0 && (
        <div>
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
            Review History ({reviewedTranscripts.length})
            {historyOpen ? (
              <ChevronUp size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>

          {historyOpen && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {reviewedTranscripts.map((t) => (
                <ReviewHistoryCard key={t.id} transcript={t} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Review History Card ──────────────────────────────────────── */

function ReviewHistoryCard({ transcript }: { transcript: Transcript }) {
  const [open, setOpen] = useState(false);
  const clientColor =
    transcript.client === "tyson" ? "var(--tyson)" : "var(--keith)";

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
          <FileText size={14} style={{ color: clientColor }} />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {transcript.setter_name}
          </span>
          <span
            className="status-badge status-completed"
            style={{ fontSize: 9 }}
          >
            Reviewed
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {transcript.reviewed_at
              ? formatDate(transcript.reviewed_at)
              : formatDate(transcript.submitted_at)}
          </span>
          {open ? (
            <ChevronUp size={14} style={{ color: "var(--text-muted)" }} />
          ) : (
            <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
          )}
        </div>
      </button>

      {open && transcript.review_result && (
        <div
          style={{
            padding: "0 16px 16px",
            borderTop: "1px solid var(--border-primary)",
          }}
        >
          <div style={{ marginTop: 12 }}>
            <ReviewMarkdown content={transcript.review_result} />
          </div>
        </div>
      )}
    </div>
  );
}
