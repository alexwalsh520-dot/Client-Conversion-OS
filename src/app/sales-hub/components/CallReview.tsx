"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Phone,
  Play,
  Loader2,
  AlertCircle,
  History,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
} from "lucide-react";
import type { Filters } from "../types";
import { getEffectiveDates } from "./FilterBar";
import { ReviewMarkdown } from "./ReviewMarkdown";

/* ── Types ────────────────────────────────────────────────────────── */

interface CallReviewProps {
  filters: Filters;
}

interface ReviewHistoryEntry {
  id: string;
  closerName: string;
  review: string;
  timestamp: string;
}

/* ── Constants ────────────────────────────────────────────────────── */

const CLOSERS = ["Broz", "Will", "Austin"];

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
  // Per-closer call counts
  const [callCounts, setCallCounts] = useState<Record<string, number>>({});
  const [countsLoading, setCountsLoading] = useState(false);

  // Per-closer review state
  const [reviewingCloser, setReviewingCloser] = useState<string | null>(null);
  const [reviewResults, setReviewResults] = useState<Record<string, string>>({});
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});

  // History
  const [reviewHistory, setReviewHistory] = useState<ReviewHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  /* ── Fetch call counts for each closer ───────────────────────── */

  const fetchCallCounts = useCallback(async () => {
    setCountsLoading(true);
    try {
      const { dateFrom, dateTo } = getEffectiveDates(filters);
      const counts: Record<string, number> = {};

      await Promise.all(
        CLOSERS.map(async (closer) => {
          try {
            const params = new URLSearchParams({ closer, dateFrom, dateTo });
            const res = await fetch(`/api/sales-hub/fathom-calls?${params}`);
            const data = await res.json();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            counts[closer] = (data.meetings || []).length;
          } catch {
            counts[closer] = 0;
          }
        })
      );

      setCallCounts(counts);
    } catch {
      // Non-critical
    } finally {
      setCountsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchCallCounts();
  }, [fetchCallCounts]);

  /* ── Run review for a closer ─────────────────────────────────── */

  const runCloserReview = useCallback(
    async (closerName: string) => {
      setReviewingCloser(closerName);
      setReviewErrors((prev) => ({ ...prev, [closerName]: "" }));

      try {
        const { dateFrom, dateTo } = getEffectiveDates(filters);
        const params = new URLSearchParams({
          closer: closerName,
          dateFrom,
          dateTo,
          includeTranscript: "true",
        });

        const fetchRes = await fetch(`/api/sales-hub/fathom-calls?${params}`);
        const fetchData = await fetchRes.json();

        if (fetchData.error && fetchData.error.includes("not configured")) {
          throw new Error(
            "Fathom API not configured. Add FATHOM_API_KEY in Vercel environment variables."
          );
        }

        if (!fetchRes.ok) {
          throw new Error(fetchData.error || "Failed to fetch calls from Fathom");
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meetings = fetchData.meetings || [];

        if (meetings.length === 0) {
          throw new Error("No calls found for this closer in the selected date range.");
        }

        // Combine transcripts — transcript is an array of { speaker, text, timestamp } segments
        const aggregate = meetings
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((m: any) => m.transcript && Array.isArray(m.transcript) && m.transcript.length > 0)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((m: any) => {
            const title = m.title || "Untitled Call";
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const transcriptText = m.transcript
              .map((seg: { speaker?: string; text?: string }) => `${seg.speaker || "Speaker"}: ${seg.text || ""}`)
              .join("\n");
            return `--- Call: ${title} ---\n\n${transcriptText}`;
          })
          .join("\n\n\n");

        if (!aggregate.trim()) {
          throw new Error("Calls were found but none had transcripts available.");
        }

        // Send for review
        const reviewRes = await fetch("/api/sales-hub/review-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: aggregate,
            setterName: closerName,
            type: "call",
          }),
        });

        const reviewData = await reviewRes.json();

        if (!reviewRes.ok) {
          throw new Error(reviewData.error || "Failed to run review");
        }

        setReviewResults((prev) => ({
          ...prev,
          [closerName]: reviewData.review,
        }));

        // Save to history
        setReviewHistory((prev) => [
          {
            id: crypto.randomUUID(),
            closerName,
            review: reviewData.review,
            timestamp: new Date().toISOString(),
          },
          ...prev,
        ]);

        // Send to Slack (fire and forget)
        fetch("/api/sales-hub/send-review-slack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            review: reviewData.review,
            type: "call",
            closerName,
          }),
        }).catch(() => {});

        // Save to report history (fire and forget)
        {
          const { dateFrom: rhFrom, dateTo: rhTo } = getEffectiveDates(filters);
          fetch("/api/sales-hub/report-history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "call_review",
              subject: closerName,
              date_from: rhFrom,
              date_to: rhTo,
              content: reviewData.review,
            }),
          }).catch(() => {});
        }
      } catch (err) {
        setReviewErrors((prev) => ({
          ...prev,
          [closerName]: err instanceof Error ? err.message : "Failed to run review",
        }));
      } finally {
        setReviewingCloser(null);
      }
    },
    [filters]
  );

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="section">
      <h2 className="section-title">
        <Phone size={16} />
        Call Transcript Review
      </h2>

      {/* Loading counts */}
      {countsLoading && (
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
            Loading call data...
          </span>
        </div>
      )}

      {/* Closer cards */}
      {!countsLoading && (
        <div
          className="metric-grid metric-grid-3"
          style={{ marginBottom: 24 }}
        >
          {CLOSERS.map((closerName) => {
            const isReviewing = reviewingCloser === closerName;
            const result = reviewResults[closerName];
            const reviewError = reviewErrors[closerName];
            const count = callCounts[closerName] || 0;

            return (
              <div key={closerName} className="glass-static" style={{ padding: 20 }}>
                {/* Closer header */}
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
                        background: "var(--accent)",
                      }}
                    />
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {closerName}
                    </span>
                  </div>
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
                    Calls:{" "}
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {count}
                    </span>
                  </div>
                </div>

                {/* Review button */}
                <button
                  className="btn-primary"
                  onClick={() => runCloserReview(closerName)}
                  disabled={isReviewing || count === 0}
                  style={{
                    opacity: isReviewing || count === 0 ? 0.7 : 1,
                    width: "100%",
                    justifyContent: "center",
                  }}
                >
                  {isReviewing ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  Review{count > 0 ? ` (${count})` : ""}
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
                      borderLeft: "3px solid var(--accent)",
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
                        a.download = `call-review-${closerName}-${new Date().toISOString().split("T")[0]}.md`;
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
      {reviewHistory.length > 0 && (
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
            Review History ({reviewHistory.length})
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
              {reviewHistory.map((entry) => (
                <ReviewHistoryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Review History Card ──────────────────────────────────────── */

function ReviewHistoryCard({ entry }: { entry: ReviewHistoryEntry }) {
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
          <FileText size={14} style={{ color: "var(--accent)" }} />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
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
          <button
            className="btn-secondary"
            onClick={() => {
              const blob = new Blob([entry.review], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `call-review-${entry.closerName}-${new Date().toISOString().split("T")[0]}.md`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{ marginTop: 12, fontSize: 12 }}
          >
            <Download size={12} />
            Download Review
          </button>
        </div>
      )}
    </div>
  );
}
