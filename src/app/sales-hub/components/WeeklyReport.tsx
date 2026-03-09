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
} from "lucide-react";
import type { Filters } from "../types";
import { getEffectiveDates } from "./FilterBar";
import { ReviewMarkdown } from "./ReviewMarkdown";

/* ── Types ────────────────────────────────────────────────────────── */

interface WeeklyReportProps {
  filters: Filters;
}

/* ── Component ────────────────────────────────────────────────────── */

export default function WeeklyReport({ filters }: WeeklyReportProps) {
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slackSent, setSlackSent] = useState(false);
  const [slackSending, setSlackSending] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  /* ── Generate report ────────────────────────────────────────── */

  const generateReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    setSlackSent(false);
    setSlackError(null);

    try {
      const { dateFrom, dateTo } = getEffectiveDates(filters);

      const res = await fetch("/api/sales-hub/weekly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFrom,
          dateTo,
          sendToSlack: false, // Manual generation — don't auto-send
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate report");
      }

      setReport(data.report);
      setGeneratedAt(new Date().toISOString());

      if (data.slackSent) {
        setSlackSent(true);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate report"
      );
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
        body: JSON.stringify({
          dateFrom,
          dateTo,
          sendToSlack: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to send to Slack");
      }

      if (data.slackSent) {
        setSlackSent(true);
      } else {
        setSlackError(
          "Slack message was not sent. Check SLACK_BOT_TOKEN and SLACK_CHANNEL_MARKETING environment variables."
        );
      }
    } catch (err) {
      setSlackError(
        err instanceof Error ? err.message : "Failed to send to Slack"
      );
    } finally {
      setSlackSending(false);
    }
  }, [report, filters]);

  /* ── Render ──────────────────────────────────────────────────── */

  const { dateFrom, dateTo } = getEffectiveDates(filters);

  return (
    <div className="section">
      <h2 className="section-title">
        <FileBarChart size={16} />
        Weekly Report
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
          Reports are automatically generated and sent to Slack every Monday at
          9 AM.
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
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: 4,
              }}
            >
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
              {loading ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Play size={14} />
              )}
              {loading ? "Generating..." : "Generate Report"}
            </button>

            {report && (
              <button
                className="btn-secondary"
                onClick={sendToSlack}
                disabled={slackSending || slackSent}
                style={{
                  opacity: slackSending || slackSent ? 0.7 : 1,
                }}
              >
                {slackSending ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Send size={14} />
                )}
                {slackSent ? "Sent to Slack" : "Send to Slack"}
              </button>
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
            <Loader2
              size={28}
              className="spin"
              style={{ color: "var(--accent)" }}
            />
            <div
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                textAlign: "center",
              }}
            >
              Generating weekly report...
              <br />
              <span style={{ fontSize: 11 }}>
                This may take 10-30 seconds while aggregating data from all
                sources.
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

        {/* Slack error */}
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
              }}
            >
              <ReviewMarkdown content={report} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
