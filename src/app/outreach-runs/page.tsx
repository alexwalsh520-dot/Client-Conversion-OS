"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Play,
  Upload,
  Download,
  Copy,
  Trash2,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Loader2,
  Rocket,
  FileText,
  BarChart3,
  Clock,
  AlertCircle,
} from "lucide-react";
import { fmtNumber } from "@/lib/formatters";
import {
  OutreachRun,
  getRuns,
  saveRun,
  deleteRun,
  generateRunId,
  getQuickStats,
} from "@/lib/outreach-store";

// ── CSV Parsing ────────────────────────────────────────────────

interface ParsedLead {
  first_name: string;
  last_name: string;
  email: string;
  instagram_username: string;
  instagram_link: string;
}

function normalizeColumnName(col: string): string {
  return col.toLowerCase().replace(/[\s_-]+/g, "").trim();
}

function parseCSV(text: string): ParsedLead[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const normalizedHeaders = headers.map(normalizeColumnName);

  // Map columns flexibly
  const colMap: Record<string, number> = {};
  normalizedHeaders.forEach((h, i) => {
    if (h.includes("firstname") || h === "first" || h === "name") colMap.first_name = i;
    if (h.includes("lastname") || h === "last") colMap.last_name = i;
    if (h.includes("email") || h === "emailaddress") colMap.email = i;
    if (
      h.includes("instagramusername") ||
      h === "instagram" ||
      h === "ig" ||
      h === "igusername" ||
      h === "username"
    )
      colMap.instagram_username = i;
    if (
      h.includes("instagramlink") ||
      h === "iglink" ||
      h === "instagramurl" ||
      h === "igurl"
    )
      colMap.instagram_link = i;
  });

  // If "name" column exists but no first_name, use name as first_name
  if (colMap.first_name === undefined) {
    const nameIdx = normalizedHeaders.findIndex(
      (h) => h === "name" || h === "fullname"
    );
    if (nameIdx >= 0) colMap.first_name = nameIdx;
  }

  const leads: ParsedLead[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
    if (vals.length < 2) continue;

    const lead: ParsedLead = {
      first_name: vals[colMap.first_name] || "",
      last_name: vals[colMap.last_name] || "",
      email: vals[colMap.email] || "",
      instagram_username: vals[colMap.instagram_username] || "",
      instagram_link: vals[colMap.instagram_link] || "",
    };

    // Derive instagram_link from username if missing
    if (lead.instagram_username && !lead.instagram_link) {
      lead.instagram_link = `https://instagram.com/${lead.instagram_username.replace(/^@/, "")}`;
    }
    // Derive username from link if missing
    if (lead.instagram_link && !lead.instagram_username) {
      const match = lead.instagram_link.match(
        /instagram\.com\/([A-Za-z0-9_.]+)/
      );
      if (match) lead.instagram_username = match[1];
    }

    // Skip completely empty rows
    if (!lead.first_name && !lead.email && !lead.instagram_username) continue;

    leads.push(lead);
  }
  return leads;
}

// ── Component ──────────────────────────────────────────────────

export default function OutreachRunsPage() {
  // CSV state
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedLeads, setParsedLeads] = useState<ParsedLead[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step state
  const [importStatus, setImportStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [importResult, setImportResult] = useState<{
    success: number;
    failed: number;
    already_existed: number;
    total: number;
    colddms_usernames: string[];
  } | null>(null);
  const [importError, setImportError] = useState("");

  const [runStatus, setRunStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [runResult, setRunResult] = useState<{
    processed: number;
    smartlead_added: number;
    dms_queued: number;
    errors: string[];
    colddms_usernames: string[];
    colddms_csv: string;
  } | null>(null);
  const [runError, setRunError] = useState("");

  // Run all state
  const [runAllStep, setRunAllStep] = useState<0 | 1 | 2>(0);

  // History state
  const [runs, setRuns] = useState<OutreachRun[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [quickStats, setQuickStats] = useState(getQuickStats());

  // Clipboard feedback
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRuns(getRuns());
    setQuickStats(getQuickStats());
  }, []);

  // ── File handling ──────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    setCsvFile(file);
    setImportStatus("idle");
    setImportResult(null);
    setRunStatus("idle");
    setRunResult(null);
    setRunAllStep(0);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const leads = parseCSV(text);
      setParsedLeads(leads);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".csv")) handleFile(file);
    },
    [handleFile]
  );

  // ── Import to GHL ─────────────────────────────────────────

  const handleImport = async () => {
    setImportStatus("loading");
    setImportError("");
    try {
      const res = await fetch("/api/outreach/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: parsedLeads }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportResult(data);
      setImportStatus("done");
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : "Import failed");
      setImportStatus("error");
    }
  };

  // ── Run Outreach ──────────────────────────────────────────

  const handleRun = async () => {
    setRunStatus("loading");
    setRunError("");
    try {
      const res = await fetch("/api/outreach/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Run failed");
      setRunResult(data);
      setRunStatus("done");

      // Combine usernames from import + run
      const allUsernames = [
        ...(importResult?.colddms_usernames || []),
        ...(data.colddms_usernames || []),
      ];
      const uniqueUsernames = [...new Set(allUsernames)];

      // Save run to history
      const run: OutreachRun = {
        id: generateRunId(),
        timestamp: new Date().toISOString(),
        leads_imported: importResult?.total || parsedLeads.length,
        smartlead_added: data.smartlead_added || 0,
        dms_queued: uniqueUsernames.length,
        errors: (importResult?.failed || 0) + (data.errors?.length || 0),
        error_details: data.errors || [],
        colddms_file: `colddms_${new Date().toISOString().split("T")[0]}.txt`,
        colddms_usernames: uniqueUsernames,
        status:
          data.errors?.length > 0 && data.processed === 0
            ? "failed"
            : data.errors?.length > 0
            ? "partial"
            : "completed",
      };
      saveRun(run);
      setRuns(getRuns());
      setQuickStats(getQuickStats());
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : "Run failed");
      setRunStatus("error");
    }
  };

  // ── Run All ───────────────────────────────────────────────

  const handleRunAll = async () => {
    setRunAllStep(1);
    // Step 1: Import
    setImportStatus("loading");
    setImportError("");
    try {
      const res = await fetch("/api/outreach/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: parsedLeads }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportResult(data);
      setImportStatus("done");
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : "Import failed");
      setImportStatus("error");
      setRunAllStep(0);
      return;
    }

    // Step 2: Run outreach
    setRunAllStep(2);
    await handleRun();
    setRunAllStep(0);
  };

  // ── Download helpers ──────────────────────────────────────

  const downloadTxt = (usernames: string[], filename?: string) => {
    const blob = new Blob([usernames.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `colddms_${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCsv = (usernames: string[]) => {
    const rows = ["username,firstName,name", ...usernames.map((u) => `${u},,`)];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `colddms_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyUsernames = (usernames: string[]) => {
    navigator.clipboard.writeText(usernames.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Delete run ────────────────────────────────────────────

  const handleDeleteRun = (id: string) => {
    deleteRun(id);
    setRuns(getRuns());
    setQuickStats(getQuickStats());
  };

  // ── Get all colddms usernames (from import + run) ────────

  const allColddmsUsernames = [
    ...new Set([
      ...(importResult?.colddms_usernames || []),
      ...(runResult?.colddms_usernames || []),
    ]),
  ];

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">
          <span className="gradient-text">Outreach Runs</span>
        </h1>
        <p className="page-subtitle">
          Upload leads, import to GHL, run outreach campaigns, and download
          ColdDMs files
        </p>
      </div>

      {/* ── Quick Stats ─────────────────────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <BarChart3 size={16} />
          Quick Stats
        </h2>
        <div className="metric-grid metric-grid-4">
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total Leads Imported</div>
            <div className="metric-card-value">
              {fmtNumber(quickStats.totalImported)}
            </div>
            <div className="metric-card-trend metric-card-trend-flat">
              all-time
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total Emails Sent</div>
            <div className="metric-card-value">
              {fmtNumber(quickStats.totalEmails)}
            </div>
            <div className="metric-card-trend metric-card-trend-flat">
              via Smartlead
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total DMs Queued</div>
            <div className="metric-card-value">
              {fmtNumber(quickStats.totalDMs)}
            </div>
            <div className="metric-card-trend metric-card-trend-flat">
              via ColdDMs
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Last Run</div>
            <div className="metric-card-value" style={{ fontSize: 18 }}>
              {quickStats.lastRun
                ? new Date(quickStats.lastRun).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                : "—"}
            </div>
            <div className="metric-card-trend metric-card-trend-flat">
              {quickStats.totalRuns} total runs
            </div>
          </div>
        </div>
      </div>

      {/* ── Run Outreach Panel ──────────────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <Rocket size={16} />
          Run Outreach
        </h2>
        <div className="glass-static" style={{ padding: 24 }}>
          {/* Step 1: Upload CSV */}
          <div style={{ marginBottom: 28 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background:
                    parsedLeads.length > 0
                      ? "var(--success-soft)"
                      : "var(--accent-soft)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  color:
                    parsedLeads.length > 0
                      ? "var(--success)"
                      : "var(--accent)",
                }}
              >
                {parsedLeads.length > 0 ? (
                  <CheckCircle size={14} />
                ) : (
                  "1"
                )}
              </div>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Upload Leads
              </span>
            </div>

            {/* Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${
                  dragOver
                    ? "var(--accent)"
                    : parsedLeads.length > 0
                    ? "var(--success)"
                    : "var(--border-primary)"
                }`,
                borderRadius: 12,
                padding: "32px 24px",
                textAlign: "center",
                cursor: "pointer",
                background: dragOver
                  ? "var(--accent-soft)"
                  : "transparent",
                transition: "all 0.2s",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
                style={{ display: "none" }}
              />
              {parsedLeads.length > 0 ? (
                <>
                  <CheckCircle
                    size={24}
                    style={{ color: "var(--success)", marginBottom: 8 }}
                  />
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      marginBottom: 4,
                    }}
                  >
                    {csvFile?.name} — {fmtNumber(parsedLeads.length)} leads
                    ready to import
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                    }}
                  >
                    Click or drag to replace
                  </div>
                </>
              ) : (
                <>
                  <Upload
                    size={24}
                    style={{
                      color: "var(--text-muted)",
                      marginBottom: 8,
                    }}
                  />
                  <div
                    style={{
                      fontSize: 14,
                      color: "var(--text-secondary)",
                      marginBottom: 4,
                    }}
                  >
                    Drop a CSV file here, or click to browse
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                    }}
                  >
                    Expected columns: first_name, email,
                    instagram_username
                  </div>
                </>
              )}
            </div>

            {/* Preview table */}
            {parsedLeads.length > 0 && (
              <div style={{ marginTop: 16, overflowX: "auto" }}>
                <table className="data-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "8px 12px", fontSize: 12 }}>
                        Name
                      </th>
                      <th style={{ padding: "8px 12px", fontSize: 12 }}>
                        Email
                      </th>
                      <th style={{ padding: "8px 12px", fontSize: 12 }}>
                        Instagram
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedLeads.slice(0, 5).map((lead, i) => (
                      <tr key={i}>
                        <td style={{ padding: "8px 12px", fontSize: 13 }}>
                          {lead.first_name} {lead.last_name}
                        </td>
                        <td
                          style={{
                            padding: "8px 12px",
                            fontSize: 13,
                            color: "var(--text-secondary)",
                          }}
                        >
                          {lead.email || "—"}
                        </td>
                        <td
                          style={{
                            padding: "8px 12px",
                            fontSize: 13,
                            color: "var(--text-secondary)",
                          }}
                        >
                          {lead.instagram_username
                            ? `@${lead.instagram_username}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedLeads.length > 5 && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      textAlign: "center",
                      padding: "8px 0",
                    }}
                  >
                    + {fmtNumber(parsedLeads.length - 5)} more leads
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Import to GHL */}
          <div style={{ marginBottom: 28 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background:
                    importStatus === "done"
                      ? "var(--success-soft)"
                      : "var(--accent-soft)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  color:
                    importStatus === "done"
                      ? "var(--success)"
                      : "var(--accent)",
                }}
              >
                {importStatus === "done" ? (
                  <CheckCircle size={14} />
                ) : (
                  "2"
                )}
              </div>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Import to GHL
              </span>
            </div>

            <button
              className="btn-primary"
              disabled={
                parsedLeads.length === 0 ||
                importStatus === "loading" ||
                importStatus === "done"
              }
              onClick={handleImport}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                fontSize: 14,
                opacity:
                  parsedLeads.length === 0 || importStatus === "done"
                    ? 0.5
                    : 1,
              }}
            >
              {importStatus === "loading" ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Upload size={16} />
              )}
              {importStatus === "loading"
                ? "Importing..."
                : importStatus === "done"
                ? "Imported"
                : "Import to GHL"}
            </button>

            {importStatus === "done" && importResult && (
              <div
                style={{
                  marginTop: 12,
                  padding: "12px 16px",
                  borderRadius: 8,
                  background: "var(--success-soft)",
                  fontSize: 13,
                  color: "var(--success)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <CheckCircle size={14} />
                {importResult.total} leads imported to GHL —{" "}
                {importResult.success - (importResult.already_existed || 0)}{" "}
                new contacts, {importResult.already_existed || 0} already
                existed
                {importResult.failed > 0 &&
                  `, ${importResult.failed} failed`}
              </div>
            )}

            {importStatus === "error" && (
              <div
                style={{
                  marginTop: 12,
                  padding: "12px 16px",
                  borderRadius: 8,
                  background: "var(--danger-soft)",
                  fontSize: 13,
                  color: "var(--danger)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <XCircle size={14} />
                {importError}
              </div>
            )}
          </div>

          {/* Step 3: Run Outreach */}
          <div style={{ marginBottom: 28 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background:
                    runStatus === "done"
                      ? "var(--success-soft)"
                      : "var(--accent-soft)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  color:
                    runStatus === "done"
                      ? "var(--success)"
                      : "var(--accent)",
                }}
              >
                {runStatus === "done" ? (
                  <CheckCircle size={14} />
                ) : (
                  "3"
                )}
              </div>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                Run Outreach
              </span>
            </div>

            <button
              className="btn-primary"
              disabled={
                importStatus !== "done" ||
                runStatus === "loading" ||
                runStatus === "done"
              }
              onClick={handleRun}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                fontSize: 14,
                opacity:
                  importStatus !== "done" || runStatus === "done"
                    ? 0.5
                    : 1,
              }}
            >
              {runStatus === "loading" ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Play size={16} />
              )}
              {runStatus === "loading"
                ? "Running..."
                : runStatus === "done"
                ? "Completed"
                : "Run Outreach"}
            </button>

            {runStatus === "done" && runResult && (
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: 8,
                    background: "var(--success-soft)",
                    fontSize: 13,
                    color: "var(--success)",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <CheckCircle size={14} />
                    {runResult.smartlead_added} leads added to Smartlead
                    email campaign
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CheckCircle size={14} />
                    {allColddmsUsernames.length} Instagram usernames ready
                    for ColdDMs
                  </div>
                </div>

                {runResult.errors.length > 0 && (
                  <div
                    style={{
                      padding: "12px 16px",
                      borderRadius: 8,
                      background: "var(--warning-soft)",
                      fontSize: 12,
                      color: "var(--warning)",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      <AlertCircle
                        size={12}
                        style={{ marginRight: 4 }}
                      />
                      {runResult.errors.length} warnings:
                    </div>
                    {runResult.errors.slice(0, 5).map((err, i) => (
                      <div key={i} style={{ marginLeft: 16 }}>
                        {err}
                      </div>
                    ))}
                    {runResult.errors.length > 5 && (
                      <div style={{ marginLeft: 16, fontStyle: "italic" }}>
                        +{runResult.errors.length - 5} more
                      </div>
                    )}
                  </div>
                )}

                {/* Download buttons */}
                {allColddmsUsernames.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      flexWrap: "wrap",
                      marginTop: 12,
                    }}
                  >
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        downloadTxt(allColddmsUsernames)
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 16px",
                        fontSize: 13,
                      }}
                    >
                      <Download size={14} />
                      Download ColdDMs (.txt)
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        downloadCsv(allColddmsUsernames)
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 16px",
                        fontSize: 13,
                      }}
                    >
                      <FileText size={14} />
                      Download ColdDMs (.csv)
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        copyUsernames(allColddmsUsernames)
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 16px",
                        fontSize: 13,
                      }}
                    >
                      <Copy size={14} />
                      {copied ? "Copied!" : "Copy Usernames"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {runStatus === "error" && (
              <div
                style={{
                  marginTop: 12,
                  padding: "12px 16px",
                  borderRadius: 8,
                  background: "var(--danger-soft)",
                  fontSize: 13,
                  color: "var(--danger)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <XCircle size={14} />
                {runError}
              </div>
            )}
          </div>

          {/* Divider */}
          <div
            style={{
              borderTop: "1px solid var(--border-primary)",
              paddingTop: 20,
              marginTop: 8,
            }}
          >
            {/* Run All button */}
            <button
              className="btn-primary"
              disabled={
                parsedLeads.length === 0 ||
                runAllStep > 0 ||
                (importStatus === "done" && runStatus === "done")
              }
              onClick={handleRunAll}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 24px",
                fontSize: 14,
                fontWeight: 600,
                opacity:
                  parsedLeads.length === 0 ||
                  (importStatus === "done" && runStatus === "done")
                    ? 0.5
                    : 1,
              }}
            >
              {runAllStep > 0 ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Rocket size={16} />
              )}
              {runAllStep === 1
                ? "Step 1/2: Importing leads to GHL..."
                : runAllStep === 2
                ? "Step 2/2: Running outreach..."
                : "Run All (Import + Outreach)"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Run History ─────────────────────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <Clock size={16} />
          Run History
        </h2>
        {runs.length === 0 ? (
          <div
            className="glass-static"
            style={{
              padding: "40px 24px",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 14,
            }}
          >
            No outreach runs yet. Upload a CSV and run your first
            campaign above.
          </div>
        ) : (
          <div className="glass-static" style={{ padding: 0, overflow: "hidden" }}>
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>
                    Date
                  </th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>
                    Leads Imported
                  </th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>
                    Emails Sent
                  </th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>
                    DMs Queued
                  </th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>
                    Errors
                  </th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>
                    ColdDMs
                  </th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>
                    Status
                  </th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>

                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td
                      style={{
                        padding: "10px 14px",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                      onClick={() =>
                        setExpandedRun(
                          expandedRun === run.id ? null : run.id
                        )
                      }
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {expandedRun === run.id ? (
                          <ChevronUp size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                        {new Date(run.timestamp).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }
                        )}
                      </div>
                      {expandedRun === run.id &&
                        run.error_details.length > 0 && (
                          <div
                            style={{
                              marginTop: 8,
                              padding: "8px 12px",
                              borderRadius: 6,
                              background: "var(--danger-soft)",
                              fontSize: 11,
                              color: "var(--danger)",
                            }}
                          >
                            {run.error_details.map((err, i) => (
                              <div key={i}>{err}</div>
                            ))}
                          </div>
                        )}
                    </td>
                    <td
                      style={{
                        padding: "10px 14px",
                        fontSize: 13,
                      }}
                    >
                      {fmtNumber(run.leads_imported)}
                    </td>
                    <td
                      style={{
                        padding: "10px 14px",
                        fontSize: 13,
                      }}
                    >
                      {fmtNumber(run.smartlead_added)}
                    </td>
                    <td
                      style={{
                        padding: "10px 14px",
                        fontSize: 13,
                      }}
                    >
                      {fmtNumber(run.dms_queued)}
                    </td>
                    <td
                      style={{
                        padding: "10px 14px",
                        fontSize: 13,
                        color:
                          run.errors > 0
                            ? "var(--danger)"
                            : "var(--text-muted)",
                      }}
                    >
                      {run.errors}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {run.colddms_usernames.length > 0 && (
                        <button
                          className="btn-secondary"
                          onClick={() =>
                            downloadTxt(
                              run.colddms_usernames,
                              run.colddms_file
                            )
                          }
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "4px 10px",
                            fontSize: 11,
                          }}
                        >
                          <Download size={12} />
                          Download
                        </button>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span
                        className="status-badge"
                        style={{
                          fontSize: 11,
                          padding: "3px 8px",
                          borderRadius: 6,
                          background:
                            run.status === "completed"
                              ? "var(--success-soft)"
                              : run.status === "partial"
                              ? "var(--warning-soft)"
                              : "var(--danger-soft)",
                          color:
                            run.status === "completed"
                              ? "var(--success)"
                              : run.status === "partial"
                              ? "var(--warning)"
                              : "var(--danger)",
                        }}
                      >
                        {run.status === "completed"
                          ? "Complete"
                          : run.status === "partial"
                          ? "Partial"
                          : "Failed"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <button
                        onClick={() => handleDeleteRun(run.id)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--text-muted)",
                          padding: 4,
                        }}
                        title="Delete run"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
