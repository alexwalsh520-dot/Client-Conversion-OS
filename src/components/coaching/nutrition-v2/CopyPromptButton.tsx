/**
 * Coach UI (B6c) — "Copy intake + macro targets as Claude.ai prompt".
 *
 * Click → fetches the assembled prompt server-side → reveals it inline
 * in a readonly textarea (autoselect on focus + Copy button). Coach
 * manually copies and pastes into a Claude.ai chat in their own tab.
 *
 * Server-side assembly keeps prompt content centralized: future tweaks
 * to wording/format don't need a frontend redeploy.
 */

"use client";

import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyPromptButtonProps {
  clientId: number;
}

export function CopyPromptButton({ clientId }: CopyPromptButtonProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [chars, setChars] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleLoad = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/nutrition/v2/client/${clientId}/copy-prompt`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const p = (data as { prompt: string }).prompt ?? "";
      const cc = (data as { meta?: { character_count?: number } }).meta?.character_count ?? p.length;
      setPrompt(p);
      setChars(cc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available — coach can still select-all in the textarea
    }
  };

  return (
    <div style={{ marginBottom: 12, minWidth: 0 }}>
      {!prompt ? (
        <button
          onClick={handleLoad}
          disabled={loading}
          style={primaryButton(loading)}
        >
          <Copy size={13} />
          {loading
            ? "Loading prompt…"
            : "Copy intake + macro targets as Claude.ai prompt"}
        </button>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <button onClick={handleCopy} style={primaryButton(false, copied)}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy prompt"}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {chars.toLocaleString()} characters · paste into a new Claude.ai chat
            </span>
          </div>
          <textarea
            readOnly
            value={prompt}
            onFocus={(e) => e.currentTarget.select()}
            rows={10}
            wrap="soft"
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              lineHeight: 1.4,
              background: "rgba(0,0,0,0.4)",
              color: "var(--text-primary)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 4,
              padding: 8,
              resize: "vertical",
              overflowWrap: "anywhere",
              overflowX: "hidden",
              overflowY: "auto",
            }}
          />
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
            Click the textarea to select all, or use Copy prompt above.
            Paste into Claude.ai, ask it to build the plan, then upload the
            resulting PDF using the Upload Plan button below.
          </div>
        </div>
      )}
      {error && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--danger, #ef4444)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function primaryButton(disabled: boolean, success = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    background: success
      ? "var(--success, #22c55e)"
      : disabled
        ? "rgba(99,102,241,0.5)"
        : "var(--accent, #6366f1)",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: disabled ? "wait" : "pointer",
    fontSize: 13,
    fontWeight: 600,
    transition: "background 200ms",
  };
}
