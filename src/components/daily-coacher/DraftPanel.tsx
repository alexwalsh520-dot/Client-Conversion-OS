"use client";

/**
 * Daily Coacher — draft message panel.
 *
 * Replaces DraftPlaceholder. When a topic is selected, the coach can:
 *   - Click Generate → POST /api/coaching/daily-coacher/[clientId]/generate
 *   - See the generated draft in an editable textarea (so they can tweak
 *     before pasting)
 *   - Click Copy to put the (possibly edited) draft on the clipboard
 *   - Click Regenerate to draw a different tip combination + new wording
 *
 * Handles three "not ready" states explicitly:
 *   - No topic selected
 *   - Topic selected but spec not wired (HTTP 409 with notReady=true)
 *   - Topic selected, spec wired, but no approved tips (HTTP 409 too)
 */

import { useEffect, useState } from "react";
import { Sparkles, Copy, Check, RefreshCw } from "lucide-react";
import type { TopicKey } from "@/lib/daily-coacher/topics";
import { TOPICS } from "@/lib/daily-coacher/topics";

interface TipUsed {
  id: number;
  tip_text: string;
}

interface Props {
  clientId: number;
  selectedTopic: TopicKey | null;
}

export default function DraftPanel({ clientId, selectedTopic }: Props) {
  const topic = selectedTopic ? TOPICS.find((t) => t.key === selectedTopic) : null;

  const [draft, setDraft] = useState<string>("");
  const [tipsUsed, setTipsUsed] = useState<TipUsed[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset on topic change so the previous topic's draft doesn't linger.
  useEffect(() => {
    setDraft("");
    setTipsUsed([]);
    setError(null);
    setNotReady(false);
    setCopied(false);
  }, [selectedTopic]);

  async function generate(): Promise<void> {
    if (!selectedTopic || generating) return;
    setGenerating(true);
    setError(null);
    setNotReady(false);
    try {
      const res = await fetch(
        `/api/coaching/daily-coacher/${clientId}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: selectedTopic }),
        }
      );
      const data = await res.json();
      if (res.status === 409 && data.notReady) {
        setNotReady(true);
        setError(data.error || "Topic not ready yet");
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setDraft(data.draft || "");
      setTipsUsed(data.tipsUsed || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate draft");
    } finally {
      setGenerating(false);
    }
  }

  async function copyToClipboard(): Promise<void> {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't access clipboard. Select the text and copy manually.");
    }
  }

  return (
    <div className="glass-static" style={{ padding: 20, borderRadius: 12 }}>
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
            Draft Message
            {topic && (
              <span style={{ marginLeft: 8, color: "var(--accent)", fontWeight: 500 }}>
                · {topic.label}
              </span>
            )}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {draft && (
            <button
              onClick={() => void copyToClipboard()}
              className="btn-secondary"
              style={{
                fontSize: 12,
                padding: "6px 10px",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: copied ? "var(--success)" : undefined,
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {topic && (
            <button
              onClick={() => void generate()}
              disabled={generating}
              className="btn-primary"
              style={{
                fontSize: 12,
                padding: "6px 14px",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                opacity: generating ? 0.5 : 1,
              }}
            >
              <RefreshCw size={12} className={generating ? "spin" : ""} />
              {generating ? "Generating…" : draft ? "Regenerate" : "Generate"}
            </button>
          )}
        </div>
      </div>

      {!topic && (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            fontStyle: "italic",
            padding: "20px 0",
            textAlign: "center",
          }}
        >
          Pick a topic above to generate a draft.
        </div>
      )}

      {topic && error && (
        <div
          style={{
            fontSize: 13,
            color: notReady ? "var(--warning)" : "var(--danger)",
            background: notReady ? "var(--warning-soft)" : "var(--danger-soft)",
            padding: "10px 12px",
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {notReady ? (
            <>
              <strong>Topic not ready.</strong> {error}
            </>
          ) : (
            error
          )}
        </div>
      )}

      {topic && draft && (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.max(4, Math.min(16, draft.split("\n").length + 2))}
            className="input-field"
            style={{
              width: "100%",
              fontSize: 14,
              lineHeight: 1.6,
              resize: "vertical",
              minHeight: 120,
              fontFamily: "var(--font-sans), system-ui, sans-serif",
            }}
          />
          {tipsUsed.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                {tipsUsed.length} tip{tipsUsed.length === 1 ? "" : "s"} used in this draft
              </summary>
              <ul
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  marginTop: 8,
                  paddingLeft: 20,
                  lineHeight: 1.5,
                }}
              >
                {tipsUsed.map((t) => (
                  <li key={t.id} style={{ marginBottom: 4 }}>
                    {t.tip_text}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {topic && !draft && !error && !generating && (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            fontStyle: "italic",
            padding: "12px 0",
          }}
        >
          Click Generate to draft a {topic.label} message.
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
