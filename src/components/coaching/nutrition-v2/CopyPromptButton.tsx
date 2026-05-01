/**
 * Coach UI — "Generate prompt for Claude.ai".
 *
 * Click → fetches the assembled prompt with the locked kcal target →
 * reveals it inline in a readonly textarea (autoselect on focus + Copy
 * button). Below the textarea: download links for the two reference
 * design PDFs the coach can attach to their Claude.ai chat for visual
 * uniformity.
 *
 * Disabled until the parent (MacroTargetEditor) reports a locked kcal.
 * The lock-then-generate flow makes "I have decided on the target" an
 * explicit step distinct from "now build the prompt."
 */

"use client";

import React, { useState } from "react";
import { Copy, Check, Download, ExternalLink } from "lucide-react";

interface ReferencePdf {
  label: string;
  url: string;
}

interface CopyPromptButtonProps {
  clientId: number;
  /** When null, the button is disabled — coach hasn't locked a target yet. */
  lockedKcal: number | null;
}

export function CopyPromptButton({ clientId, lockedKcal }: CopyPromptButtonProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [chars, setChars] = useState<number>(0);
  const [refs, setRefs] = useState<ReferencePdf[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleLoad = async () => {
    if (lockedKcal == null) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/nutrition/v2/client/${clientId}/copy-prompt?kcal=${lockedKcal}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const p = (data as { prompt: string }).prompt ?? "";
      const cc = (data as { meta?: { character_count?: number } }).meta?.character_count ?? p.length;
      const r = (data as { reference_pdfs?: ReferencePdf[] }).reference_pdfs ?? [];
      setPrompt(p);
      setChars(cc);
      setRefs(r);
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

  // Re-derived disabled flag — covers both initial state and the case
  // where the coach unlocked the editor after generating once.
  const disabled = lockedKcal == null;

  return (
    <div style={{ marginBottom: 12, minWidth: 0 }}>
      {!prompt ? (
        <>
          <button
            onClick={handleLoad}
            disabled={loading || disabled}
            style={primaryButton(loading, disabled)}
            title={disabled ? "Lock a kcal target above first" : undefined}
          >
            <Copy size={13} />
            {loading
              ? "Loading prompt…"
              : disabled
                ? "Lock a kcal target above first"
                : "Generate prompt for Claude.ai"}
          </button>
          {disabled && (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
              Adjust kcal if needed, then click <strong>Lock target</strong> in the macro editor above to unlock this button.
            </div>
          )}
        </>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <button onClick={handleCopy} style={primaryButton(false, false, copied)}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy prompt"}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {chars.toLocaleString()} characters · paste into a new Claude.ai chat
            </span>
            <button
              onClick={() => {
                setPrompt(null);
                setRefs([]);
              }}
              style={{
                marginLeft: "auto",
                padding: "4px 10px",
                background: "none",
                color: "var(--text-muted)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              Hide prompt
            </button>
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
            Paste into a new Claude.ai chat, ask Claude to build the plan,
            then upload the resulting PDF using the Upload Plan button below.
          </div>

          {/* Reference PDF downloads — coach attaches these to their
              Claude.ai chat for visual uniformity (Pro/Max plans only;
              free Claude can still produce a usable plan from the prompt
              alone since the structure is described inline). */}
          {refs.length > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 10px",
                background: "rgba(99,102,241,0.06)",
                border: "1px solid rgba(99,102,241,0.2)",
                borderRadius: 6,
                fontSize: 11,
              }}
            >
              <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
                Optional: design reference PDFs
              </div>
              <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>
                If your Claude plan supports file attachments (Pro/Max), download
                these and drag them into your Claude.ai chat <em>before</em> pasting
                the prompt. They&apos;re real plans we&apos;ve shipped — Claude will
                match their layout and section flow.
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                {refs.map((r) => (
                  <div
                    key={r.url}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 8px",
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ flex: 1, color: "var(--text-primary)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.label}
                    </span>
                    <a
                      href={r.url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        color: "var(--accent, #6366f1)",
                        textDecoration: "none",
                        fontSize: 11,
                      }}
                      title="Download PDF"
                    >
                      <Download size={11} /> Download
                    </a>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        color: "var(--text-muted)",
                      }}
                      title="Open in new tab"
                    >
                      <ExternalLink size={11} />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
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

function primaryButton(loading: boolean, disabled = false, success = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    background: success
      ? "var(--success, #22c55e)"
      : disabled
        ? "rgba(99,102,241,0.3)"
        : loading
          ? "rgba(99,102,241,0.5)"
          : "var(--accent, #6366f1)",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: disabled ? "not-allowed" : loading ? "wait" : "pointer",
    fontSize: 13,
    fontWeight: 600,
    transition: "background 200ms",
  };
}
