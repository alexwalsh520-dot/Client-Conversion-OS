"use client";

import { useState, useEffect, useCallback } from "react";
import {
  History,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
} from "lucide-react";
import { ReviewMarkdown } from "./ReviewMarkdown";

/* ── Types ────────────────────────────────────────────────────────── */

interface ReportEntry {
  id: string;
  type: string;
  subject: string;
  date_from: string | null;
  date_to: string | null;
  content: string;
  pdf_base64: string | null;
  created_at: string;
}

type FilterType = "all" | "weekly_marketing" | "weekly_sales" | "call_review" | "dm_review" | "daily_brief";

const FILTER_OPTIONS: { value: FilterType; label: string; color: string }[] = [
  { value: "all", label: "All", color: "var(--text-secondary)" },
  { value: "weekly_marketing", label: "Marketing", color: "var(--accent)" },
  { value: "weekly_sales", label: "Sales", color: "var(--success, #22c55e)" },
  { value: "call_review", label: "Call Reviews", color: "#f59e0b" },
  { value: "dm_review", label: "DM Reviews", color: "#8b5cf6" },
  { value: "daily_brief", label: "Briefs", color: "#06b6d4" },
];

function getTypeColor(type: string): string {
  const opt = FILTER_OPTIONS.find((f) => f.value === type);
  return opt?.color || "var(--text-muted)";
}

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    weekly_marketing: "Marketing",
    weekly_sales: "Sales",
    call_review: "Call Review",
    dm_review: "DM Review",
    daily_brief: "Brief",
  };
  return labels[type] || type;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ── Component ────────────────────────────────────────────────────── */

export default function ReportHistory() {
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* ── Fetch ───────────────────────────────────────────────────── */

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const typeParam = filter !== "all" ? `&type=${filter}` : "";
      const res = await fetch(`/api/sales-hub/report-history?limit=50${typeParam}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to fetch report history");

      setReports(data.reports || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch report history");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  /* ── Downloads ───────────────────────────────────────────────── */

  const downloadPDF = useCallback((base64: string, type: string, subject: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-${subject}-${new Date().toISOString().split("T")[0]}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadMarkdown = useCallback((content: string, type: string, subject: string) => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-${subject}-${new Date().toISOString().split("T")[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="section">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          <History size={16} />
          Report History
        </h2>
        <button
          className="btn-secondary"
          onClick={fetchReports}
          disabled={loading}
          style={{ fontSize: 12, padding: "6px 12px" }}
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Filter pills */}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              border: filter === opt.value ? `1px solid ${opt.color}` : "1px solid var(--border-subtle)",
              background: filter === opt.value ? `${opt.color}15` : "var(--bg-card)",
              color: filter === opt.value ? opt.color : "var(--text-secondary)",
              fontSize: 12,
              fontWeight: filter === opt.value ? 600 : 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 40,
          }}
        >
          <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading history...</span>
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
            marginBottom: 16,
            fontSize: 13,
            color: "var(--danger)",
          }}
        >
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && reports.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: 40,
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          No reports found. Generate a report above and it will appear here.
        </div>
      )}

      {/* Report list */}
      {!loading && reports.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {reports.map((report) => {
            const isExpanded = expandedId === report.id;
            const typeColor = getTypeColor(report.type);

            return (
              <div key={report.id} className="glass-static" style={{ overflow: "hidden" }}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : report.id)}
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
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: `${typeColor}15`,
                        color: typeColor,
                        fontWeight: 600,
                      }}
                    >
                      {getTypeLabel(report.type)}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                      {report.subject !== "all" ? report.subject : ""}
                    </span>
                    {report.date_from && report.date_to && (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {report.date_from} to {report.date_to}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {formatTimestamp(report.created_at)}
                    </span>
                    {isExpanded ? (
                      <ChevronUp size={14} style={{ color: "var(--text-muted)" }} />
                    ) : (
                      <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div
                    style={{
                      padding: "0 16px 16px",
                      borderTop: "1px solid var(--border-primary)",
                    }}
                  >
                    <div
                      style={{
                        marginTop: 12,
                        padding: 16,
                        background: "rgba(0,0,0,0.15)",
                        borderRadius: 12,
                        borderLeft: `3px solid ${typeColor}`,
                        maxHeight: 500,
                        overflowY: "auto",
                      }}
                    >
                      <ReviewMarkdown content={report.content} />
                    </div>

                    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                      {report.pdf_base64 ? (
                        <button
                          className="btn-secondary"
                          onClick={() => downloadPDF(report.pdf_base64!, report.type, report.subject)}
                          style={{ fontSize: 11, padding: "4px 10px" }}
                        >
                          <Download size={12} />
                          PDF
                        </button>
                      ) : (
                        <button
                          className="btn-secondary"
                          onClick={() => downloadMarkdown(report.content, report.type, report.subject)}
                          style={{ fontSize: 11, padding: "4px 10px" }}
                        >
                          <Download size={12} />
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
