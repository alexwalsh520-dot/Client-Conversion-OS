/**
 * Coach UI v2 — handoff prompt + sharable PDF link block.
 *
 * Click "Get correction prompt" → fetches the pre-rendered handoff
 * markdown and reveals it inline in a textarea. Coach copies manually
 * (or clicks the copy button) and pastes into a Claude.ai chat in their
 * own browser tab.
 *
 * Earlier rev opened claude.ai/new automatically and pushed text to
 * clipboard, but the new tab loses clipboard access in some browsers
 * and the paste failed silently. Showing the prompt inline + manual
 * copy is more reliable for coaches.
 */

"use client";

import React, { useState } from "react";
import { Copy, ExternalLink, Check } from "lucide-react";

interface CopyHandoffSectionProps {
  planId: number;
  pdfUrl: string | null;
}

export function CopyHandoffSection({ planId, pdfUrl }: CopyHandoffSectionProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textCopied, setTextCopied] = useState(false);
  const [pdfCopied, setPdfCopied] = useState(false);

  const handleLoad = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/nutrition/v2/plan/${planId}/coach-handoff`);
      if (!res.ok) {
        throw new Error(`couldn't load handoff: HTTP ${res.status}`);
      }
      const data = await res.json();
      const p = (data.handoff_prompt as string) ?? "";
      if (!p) {
        throw new Error("handoff prompt is empty");
      }
      setPrompt(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setTextCopied(true);
      setTimeout(() => setTextCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — coach can still select-all in the
      // textarea below as a fallback.
    }
  };

  const handleCopyPdfUrl = async () => {
    if (!pdfUrl) return;
    try {
      await navigator.clipboard.writeText(pdfUrl);
      setPdfCopied(true);
      setTimeout(() => setPdfCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div style={{ marginBottom: 12, minWidth: 0 }}>
      {!prompt ? (
        <button
          onClick={handleLoad}
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            background: "var(--accent, #6366f1)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: loading ? "wait" : "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <Copy size={13} />
          {loading ? "Loading prompt…" : "Get correction prompt for Claude.ai"}
        </button>
      ) : (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <button
              onClick={handleCopyPrompt}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                background: textCopied ? "var(--success, #22c55e)" : "var(--accent, #6366f1)",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {textCopied ? <Check size={12} /> : <Copy size={12} />}
              {textCopied ? "Copied" : "Copy prompt"}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {prompt.length.toLocaleString()} characters · paste into a new
              Claude.ai chat
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
              // Removed `whiteSpace: "pre"` — it was forcing lines not
              // to wrap and demanding a wider intrinsic min-width than
              // the panel could provide, which contributed to horizontal
              // overflow. Soft-wrap is fine for a copy-only display;
              // the actual newlines round-trip through the clipboard.
              overflowWrap: "anywhere",
              overflowX: "hidden",
              overflowY: "auto",
            }}
          />
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
            Click the textarea to select all, or use the Copy prompt button
            above. Then open Claude.ai in another tab, start a new chat, and
            paste.
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "var(--danger, #ef4444)",
          }}
        >
          {error}
        </div>
      )}

      {pdfUrl && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12 }}>
          <div style={{ marginBottom: 4 }}>PDF link to share with Claude.ai:</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 8px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 4,
              fontFamily: "ui-monospace, monospace",
              minWidth: 0,
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--text-primary)",
              }}
              title={pdfUrl}
            >
              {pdfUrl}
            </span>
            <button
              onClick={handleCopyPdfUrl}
              style={{
                background: "none",
                border: "none",
                color: pdfCopied ? "var(--success, #22c55e)" : "var(--text-muted)",
                cursor: "pointer",
                padding: "2px 4px",
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
              }}
              title="Copy URL"
            >
              {pdfCopied ? <Check size={11} /> : <Copy size={11} />}
            </button>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                flexShrink: 0,
              }}
              title="Open PDF"
            >
              <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
