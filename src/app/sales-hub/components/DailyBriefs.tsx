"use client";

import { useState, useCallback } from "react";
import {
  Calendar,
  Play,
  Loader2,
  AlertCircle,
  Clock,
  Download,
} from "lucide-react";
import type { Filters } from "../types";
import { ReviewMarkdown } from "./ReviewMarkdown";

/* ── Types ────────────────────────────────────────────────────────── */

interface DailyBriefsProps {
  filters: Filters;
}

interface BriefResult {
  closer: string;
  brief: string;
  pdfBase64: string | null;
}

/* ── Constants ────────────────────────────────────────────────────── */

const CLOSERS = ["Broz", "Will", "Jacob"];

/* ── Component ────────────────────────────────────────────────────── */

export default function DailyBriefs({ filters }: DailyBriefsProps) {
  const [generatingCloser, setGeneratingCloser] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [results, setResults] = useState<Record<string, BriefResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  /* ── Generate for one closer ─────────────────────────────────── */

  const generateForCloser = useCallback(async (closerName: string) => {
    setGeneratingCloser(closerName);
    setErrors((prev) => ({ ...prev, [closerName]: "" }));

    try {
      const res = await fetch("/api/sales-hub/daily-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closer: closerName, sendToSlack: false }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to generate brief");

      if (data.briefs && data.briefs.length > 0) {
        const brief = data.briefs[0];
        setResults((prev) => ({ ...prev, [closerName]: brief }));
      } else {
        setErrors((prev) => ({
          ...prev,
          [closerName]: data.message || "No appointments found for this closer today.",
        }));
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [closerName]: err instanceof Error ? err.message : "Failed to generate brief",
      }));
    } finally {
      setGeneratingCloser(null);
    }
  }, []);

  /* ── Generate all ────────────────────────────────────────────── */

  const generateAll = useCallback(async () => {
    setGeneratingAll(true);
    setErrors({});

    try {
      const res = await fetch("/api/sales-hub/daily-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendToSlack: true }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to generate briefs");

      if (data.briefs && data.briefs.length > 0) {
        const newResults: Record<string, BriefResult> = {};
        for (const brief of data.briefs) {
          newResults[brief.closer] = brief;
        }
        setResults((prev) => ({ ...prev, ...newResults }));
      } else {
        setErrors({ all: data.message || "No appointments found today." });
      }
    } catch (err) {
      setErrors({ all: err instanceof Error ? err.message : "Failed to generate briefs" });
    } finally {
      setGeneratingAll(false);
    }
  }, []);

  /* ── Download helpers ────────────────────────────────────────── */

  const downloadPDF = useCallback((base64: string, closerName: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-brief-${closerName.toLowerCase()}-${new Date().toISOString().split("T")[0]}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadMarkdown = useCallback((content: string, closerName: string) => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-brief-${closerName.toLowerCase()}-${new Date().toISOString().split("T")[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /* ── Render ──────────────────────────────────────────────────── */

  const isAnyGenerating = generatingCloser !== null || generatingAll;

  return (
    <div className="section">
      <h2 className="section-title">
        <Calendar size={16} />
        Daily Closer Briefs
      </h2>

      {/* Info banner */}
      <div
        className="glass-subtle"
        style={{
          padding: "12px 16px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Clock size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Daily briefs auto-generate at 5 AM EST and are sent to Slack as PDF. Use the buttons
          below to generate on demand.
        </span>
      </div>

      {/* Generate All button */}
      <div style={{ marginBottom: 20 }}>
        <button
          className="btn-primary"
          onClick={generateAll}
          disabled={isAnyGenerating}
          style={{ opacity: isAnyGenerating ? 0.7 : 1 }}
        >
          {generatingAll ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          {generatingAll ? "Generating All Briefs..." : "Generate All Briefs"}
        </button>
      </div>

      {/* Global error */}
      {errors.all && (
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
          {errors.all}
        </div>
      )}

      {/* Closer cards */}
      <div className="metric-grid metric-grid-3">
        {CLOSERS.map((closerName) => {
          const isGenerating = generatingCloser === closerName || generatingAll;
          const result = results[closerName];
          const error = errors[closerName];

          return (
            <div key={closerName} className="glass-static" style={{ padding: 20 }}>
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 16,
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

              {/* Generate button */}
              <button
                className="btn-primary"
                onClick={() => generateForCloser(closerName)}
                disabled={isGenerating}
                style={{
                  opacity: isGenerating ? 0.7 : 1,
                  width: "100%",
                  justifyContent: "center",
                }}
              >
                {isGenerating ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                {isGenerating ? "Generating..." : "Generate Brief"}
              </button>

              {/* Error */}
              {error && (
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
                  {error}
                </div>
              )}

              {/* Result */}
              {result && (
                <>
                  <div
                    style={{
                      marginTop: 16,
                      padding: 16,
                      background: "rgba(0,0,0,0.2)",
                      borderRadius: 12,
                      borderLeft: "3px solid var(--accent)",
                      maxHeight: 400,
                      overflowY: "auto",
                    }}
                  >
                    <ReviewMarkdown content={result.brief} />
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    {result.pdfBase64 ? (
                      <button
                        className="btn-secondary"
                        onClick={() => downloadPDF(result.pdfBase64!, closerName)}
                        style={{ fontSize: 12 }}
                      >
                        <Download size={12} />
                        PDF
                      </button>
                    ) : (
                      <button
                        className="btn-secondary"
                        onClick={() => downloadMarkdown(result.brief, closerName)}
                        style={{ fontSize: 12 }}
                      >
                        <Download size={12} />
                        Download
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
