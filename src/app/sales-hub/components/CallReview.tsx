"use client";

import { useState, useCallback } from "react";
import {
  Phone,
  Loader2,
  AlertCircle,
  History,
  ChevronDown,
  ChevronUp,
  Download,
} from "lucide-react";
import type { Filters } from "../types";
import { getEffectiveDates } from "./FilterBar";
import { ReviewMarkdown } from "./ReviewMarkdown";

/* ── Types ────────────────────────────────────────────────────────── */

interface ReviewHistoryEntry {
  id: string;
  closerName: string;
  review: string;
  timestamp: string;
}

interface CallReviewProps {
  filters: Filters;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

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

const downloadReview = (content: string, closerName: string) => {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `call-review-${closerName}-${new Date().toISOString().split("T")[0]}.md`;
  a.click();
  URL.revokeObjectURL(url);
};

/* ── Component ────────────────────────────────────────────────────── */

export default function CallReview({ filters }: CallReviewProps) {
  const [closer, setCloser] = useState(CLOSERS[0]);

  // Loading / error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Review result
  const [reviewResult, setReviewResult] = useState<string | null>(null);

  // Review history
  const [reviewHistory, setReviewHistory] = useState<ReviewHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  /* ── Run full review pipeline ──────────────────────────────────── */

  const runReview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReviewResult(null);

    try {
      // 1. Fetch all calls from Fathom for this closer + date range
      const { dateFrom, dateTo } = getEffectiveDates(filters);
      const params = new URLSearchParams({
        closer,
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
        throw new Error(
          "No calls found for this closer in the selected date range."
        );
      }

      // 2. Combine all transcripts into one aggregate
      const aggregate = meetings
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((m: any) => m.transcript || m.transcriptText)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((m: any) => {
          const title = m.title || "Untitled Call";
          const transcript = m.transcript || m.transcriptText || "";
          return `--- Call: ${title} ---\n\n${transcript}`;
        })
        .join("\n\n\n");

      if (!aggregate.trim()) {
        throw new Error(
          "Calls were found but none had transcripts available."
        );
      }

      // 3. Send aggregate to review endpoint
      const reviewRes = await fetch("/api/sales-hub/review-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: aggregate,
          setterName: closer,
          type: "call",
        }),
      });

      const reviewData = await reviewRes.json();

      if (!reviewRes.ok) {
        throw new Error(reviewData.error || "Failed to run review");
      }

      setReviewResult(reviewData.review);

      // Save to history
      setReviewHistory((prev) => [
        {
          id: crypto.randomUUID(),
          closerName: closer,
          review: reviewData.review,
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ]);

      // 4. Send to Slack (fire and forget)
      fetch("/api/sales-hub/send-review-slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          review: reviewData.review,
          type: "call",
          closerName: closer,
        }),
      }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [closer, filters]);

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="section">
      {/* Controls */}
      <div className="glass-static" style={{ padding: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
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
            onClick={runReview}
            disabled={loading}
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Phone size={14} />
            )}
            {loading ? "Reviewing..." : "Review"}
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div
            style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 16px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: 8,
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            <Loader2 size={16} className="spin" style={{ color: "var(--accent)" }} />
            Fetching calls and generating review...
          </div>
        )}

        {/* Error state */}
        {error && (
          <div
            style={{
              marginTop: 16,
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
            {error}
          </div>
        )}

        {/* Review result */}
        {reviewResult && (
          <div style={{ marginTop: 20 }}>
            <div
              className="glass-static"
              style={{ padding: 20, marginBottom: 12 }}
            >
              <ReviewMarkdown content={reviewResult} />
            </div>

            <button
              className="btn-primary"
              onClick={() => downloadReview(reviewResult, closer)}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid var(--border-primary)",
              }}
            >
              <Download size={14} />
              Download Review
            </button>
          </div>
        )}
      </div>

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
          <Phone
            size={14}
            style={{ color: "var(--accent)", flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            Call Review — {entry.closerName}
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
            className="btn-primary"
            onClick={() => downloadReview(entry.review, entry.closerName)}
            style={{
              marginTop: 12,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--border-primary)",
            }}
          >
            <Download size={14} />
            Download Review
          </button>
        </div>
      )}
    </div>
  );
}
