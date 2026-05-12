"use client";

/**
 * Daily Coacher — persistent summary panel.
 *
 * Behavior:
 *   - On mount, if `initialStale` is true, auto-trigger a regen so the coach
 *     never sees stale context just because they opened the view at the
 *     right time. Manual "Refresh" button always available.
 *   - Shows the summary as plain text with markdown-style headers preserved.
 *     We don't import a markdown renderer — the format is tight (bold
 *     **HEADERS** + bulleted lists) and rendering manually keeps the
 *     dependency surface small.
 */

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

interface Props {
  clientId: number;
  initialSummary: string | null;
  initialUpdatedAt: string | null;
  initialStale: boolean;
}

export default function SummaryPanel({
  clientId,
  initialSummary,
  initialUpdatedAt,
  initialStale,
}: Props) {
  const [summary, setSummary] = useState<string | null>(initialSummary);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRegenAttempted = useRef(false);

  async function regenerate(): Promise<void> {
    if (isRegenerating) return;
    setIsRegenerating(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/coaching/daily-coacher/${clientId}/summary`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSummary(data.summary);
      setUpdatedAt(data.summaryUpdatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate summary");
    } finally {
      setIsRegenerating(false);
    }
  }

  // Auto-regen on mount when the server flagged the cached summary as stale.
  // useRef guard prevents StrictMode double-invocation in dev from firing twice.
  useEffect(() => {
    if (autoRegenAttempted.current) return;
    autoRegenAttempted.current = true;
    if (initialStale) {
      void regenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="glass-static fade-up"
      style={{
        padding: 20,
        borderLeft: "2px solid var(--accent)",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={14} style={{ color: "var(--accent)" }} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Persistent Summary
          </span>
          {isRegenerating && (
            <span
              style={{
                fontSize: 11,
                color: "var(--accent)",
                fontStyle: "italic",
              }}
            >
              · updating…
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {updatedAt && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {formatTimestamp(updatedAt)}
            </span>
          )}
          <button
            onClick={() => void regenerate()}
            disabled={isRegenerating}
            className="btn-secondary"
            style={{
              fontSize: 12,
              padding: "6px 10px",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: isRegenerating ? 0.5 : 1,
            }}
            title="Regenerate the summary from the latest inputs"
          >
            <RefreshCw size={12} className={isRegenerating ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            fontSize: 13,
            color: "var(--danger)",
            background: "var(--danger-soft)",
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {summary ? (
        <div
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
          // The summary is markdown-style with **bold** headers. Render as
          // pre-wrap text so lines preserve, and replace **bold** with <strong>
          // via a small regex to keep the headers visually distinct without
          // pulling in a full markdown parser for one feature.
          dangerouslySetInnerHTML={{ __html: renderSummary(summary) }}
        />
      ) : (
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: 13,
            fontStyle: "italic",
          }}
        >
          {isRegenerating
            ? "Generating summary for the first time…"
            : "No summary yet. Click Refresh to generate one."}
        </div>
      )}

      <style jsx>{`
        :global(.spin) {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSummary(raw: string): string {
  // Escape user-influenceable text first to prevent XSS, then re-introduce
  // the styling for **bold** headers.
  const escaped = escapeHtml(raw);
  return escaped.replace(
    /\*\*(.+?)\*\*/g,
    '<strong style="color: var(--text-primary); font-weight: 600; letter-spacing: 0.04em;">$1</strong>'
  );
}

function formatTimestamp(iso: string): string {
  try {
    const then = new Date(iso);
    const now = Date.now();
    const diffMs = now - then.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return then.toLocaleDateString();
  } catch {
    return iso;
  }
}
