"use client";

import { useState, useCallback } from "react";
import {
  FileBarChart,
  Play,
  Loader2,
  AlertCircle,
  Send,
  Clock,
  Info,
  Download,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { Filters } from "../types";
import { getEffectiveDates } from "./FilterBar";
import { ReviewMarkdown } from "./ReviewMarkdown";

/* ── Types ────────────────────────────────────────────────────────── */

interface WeeklyReportProps {
  filters: Filters;
}

interface ReportRun {
  id: string;
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  report: string;
  pdfBase64: string | null;
}

/* ── Component ────────────────────────────────────────────────────── */

export default function WeeklyReport({ filters }: WeeklyReportProps) {
  const [report, setReport] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slackSent, setSlackSent] = useState(false);
  const [slackSending, setSlackSending] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  // Recent runs history
  const [recentRuns, setRecentRuns] = useState<ReportRun[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  /* ── Generate report ────────────────────────────────────────── */

  const generateReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    setPdfBase64(null);
    setSlackSent(false);
    setSlackError(null);

    try {
      const { dateFrom, dateTo } = getEffectiveDates(filters);

      const res = await fetch("/api/sales-hub/weekly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo, sendToSlack: false }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate report");
      }

      setReport(data.report);
      setPdfBase64(data.pdfBase64 || null);
      setGeneratedAt(new Date().toISOString());

      if (data.slackSent) setSlackSent(true);

      // Save to recent runs
      setRecentRuns((prev) => [
        {
          id: crypto.randomUUID(),
          dateFrom,
          dateTo,
          generatedAt: new Date().toISOString(),
          report: data.report,
          pdfBase64: data.pdfBase64 || null,
        },
        ...prev.slice(0, 9), // Keep max 10
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  /* ── Send to Slack ──────────────────────────────────────────── */

  const sendToSlack = useCallback(async () => {
    if (!report) return;

    setSlackSending(true);
    setSlackError(null);

    try {
      const { dateFrom, dateTo } = getEffectiveDates(filters);

      const res = await fetch("/api/sales-hub/weekly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo, sendToSlack: true }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to send to Slack");
      }

      if (data.slackSent) {
        setSlackSent(true);
      } else {
        setSlackError("Slack message was not sent. Check SLACK_BOT_TOKEN and SLACK_USER_DM environment variables.");
      }
    } catch (err) {
      setSlackError(err instanceof Error ? err.message : "Failed to send to Slack");
    } finally {
      setSlackSending(false);
    }
  }, [report, filters]);

  /* ── Download PDF ──────────────────────────────────────────── */

  const downloadPDF = useCallback((base64: string, dateFrom: string, dateTo: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weekly-report-${dateFrom}-to-${dateTo}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadMarkdown = useCallback((content: string, dateFrom: string, dateTo: string) => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weekly-report-${dateFrom}-to-${dateTo}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /* ── Render ──────────────────────────────────────────────────── */

  const { dateFrom, dateTo } = getEffectiveDates(filters);

  return (
    <div className="section">
      <h2 className="section-title">
        <FileBarChart size={16} />
        Weekly Marketing Report
      </h2>

      {/* Auto-generation note */}
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
          Reports auto-generate every Monday at 9 AM EST and are sent to Slack as PDF.
          Includes transcript analysis and 30 ad copies per client.
        </span>
      </div>

      {/* Generate controls */}
      <div className="glass-static" style={{ padding: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: report ? 20 : 0,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
              Generate Performance Report
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Period: {dateFrom} to {dateTo}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn-primary"
              onClick={generateReport}
              disabled={loading}
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
              {loading ? "Generating..." : "Generate Report"}
            </button>

            {report && (
              <>
                <button
                  className="btn-secondary"
                  onClick={sendToSlack}
                  disabled={slackSending || slackSent}
                  style={{ opacity: slackSending || slackSent ? 0.7 : 1 }}
                >
                  {slackSending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                  {slackSent ? "Sent to Slack" : "Send to Slack"}
                </button>

                {pdfBase64 && (
                  <button
                    className="btn-secondary"
                    onClick={() => downloadPDF(pdfBase64, dateFrom, dateTo)}
                  >
                    <Download size={14} />
                    Download PDF
                  </button>
                )}

                {!pdfBase64 && (
                  <button
                    className="btn-secondary"
                    onClick={() => downloadMarkdown(report, dateFrom, dateTo)}
                  >
                    <Download size={14} />
                    Download
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Loading indicator */}
        {loading && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: 48,
            }}
          >
            <Loader2 size={28} className="spin" style={{ color: "var(--accent)" }} />
            <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
              Generating weekly report with transcript analysis...
              <br />
              <span style={{ fontSize: 11 }}>
                This may take 30-60 seconds while aggregating data, transcripts, and generating ad copy.
              </span>
            </div>
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
              marginTop: 12,
              fontSize: 13,
              color: "var(--danger)",
            }}
          >
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {slackError && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "12px 16px",
              background: "var(--warning-soft)",
              borderRadius: 8,
              marginTop: 12,
              fontSize: 13,
              color: "var(--warning)",
            }}
          >
            <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            {slackError}
          </div>
        )}

        {/* Report content */}
        {report && !loading && (
          <div>
            {generatedAt && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Clock size={12} />
                Generated:{" "}
                {new Date(generatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            )}

            <div
              style={{
                padding: 20,
                background: "rgba(0,0,0,0.15)",
                borderRadius: 12,
                borderLeft: "3px solid var(--accent)",
                maxHeight: 600,
                overflowY: "auto",
              }}
            >
              <ReviewMarkdown content={report} />
            </div>
          </div>
        )}
      </div>

      {/* Recent Runs */}
      {recentRuns.length > 0 && (
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
            <Clock size={16} />
            Recent Runs ({recentRuns.length})
            {historyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {historyOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentRuns.map((run) => (
                <div key={run.id} className="glass-static" style={{ padding: "12px 16px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                        {run.dateFrom} to {run.dateTo}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 12 }}>
                        {new Date(run.generatedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {run.pdfBase64 ? (
                        <button
                          className="btn-secondary"
                          onClick={() => downloadPDF(run.pdfBase64!, run.dateFrom, run.dateTo)}
                          style={{ fontSize: 11, padding: "4px 10px" }}
                        >
                          <Download size={12} />
                          PDF
                        </button>
                      ) : (
                        <button
                          className="btn-secondary"
                          onClick={() => downloadMarkdown(run.report, run.dateFrom, run.dateTo)}
                          style={{ fontSize: 11, padding: "4px 10px" }}
                        >
                          <Download size={12} />
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
