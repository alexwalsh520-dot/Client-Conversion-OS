/**
 * Coach UI v2 — "Copy correction prompt for Claude.ai" + sharable PDF
 * link block. Drives the round-trip with Claude.ai for State 3.
 */

"use client";

import React, { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";

interface CopyHandoffSectionProps {
  planId: number;
  pdfUrl: string | null;
}

export function CopyHandoffSection({ planId, pdfUrl }: CopyHandoffSectionProps) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [pdfCopied, setPdfCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCopy = async () => {
    setCopyState("copying");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/nutrition/v2/plan/${planId}/coach-handoff`);
      if (!res.ok) {
        throw new Error(`couldn't load handoff: HTTP ${res.status}`);
      }
      const data = await res.json();
      const prompt = (data.handoff_prompt as string) ?? "";
      if (!prompt) {
        throw new Error("handoff prompt is empty");
      }
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
      // Open Claude.ai in a new tab
      window.open("https://claude.ai/new", "_blank", "noopener");
      // Reset after 2.5s
      setTimeout(() => setCopyState("idle"), 2_500);
    } catch (e) {
      setCopyState("error");
      setErrorMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCopyPdfUrl = async () => {
    if (!pdfUrl) return;
    try {
      await navigator.clipboard.writeText(pdfUrl);
      setPdfCopied(true);
      setTimeout(() => setPdfCopied(false), 2_000);
    } catch {
      // ignore
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={handleCopy}
        disabled={copyState === "copying"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          background: copyState === "copied" ? "var(--success, #22c55e)" : "var(--accent, #6366f1)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: copyState === "copying" ? "wait" : "pointer",
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 8,
          transition: "background 200ms",
        }}
      >
        <Copy size={13} />
        {copyState === "copying"
          ? "Loading prompt…"
          : copyState === "copied"
            ? "✓ Copied — opening Claude.ai"
            : copyState === "error"
              ? "Failed — try again"
              : "Copy correction prompt for Claude.ai"}
      </button>

      {errorMessage && (
        <div style={{ fontSize: 11, color: "var(--danger, #ef4444)", marginBottom: 8 }}>
          {errorMessage}
        </div>
      )}

      {pdfUrl && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
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
            }}
          >
            <span
              style={{
                flex: 1,
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
              }}
              title="Copy URL"
            >
              {pdfCopied ? "✓" : <Copy size={11} />}
            </button>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--text-muted)", display: "flex", alignItems: "center" }}
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
