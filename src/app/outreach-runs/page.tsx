"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
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

    if (lead.instagram_username && !lead.instagram_link) {
      lead.instagram_link = `https://instagram.com/${lead.instagram_username.replace(/^@/, "")}`;
    }
    if (lead.instagram_link && !lead.instagram_username) {
      const match = lead.instagram_link.match(/instagram\.com\/([A-Za-z0-9_.]+)/);
      if (match) lead.instagram_username = match[1];
    }

    if (!lead.first_name && !lead.email && !lead.instagram_username) continue;
    leads.push(lead);
  }
  return leads;
}

// ── Component ──────────────────────────────────────────────────

export default function OutreachRunsPage() {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedLeads, setParsedLeads] = useState<ParsedLead[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Single workflow state
  const [runStatus, setRunStatus] = useState<"idle" | "importing" | "running" | "done" | "error">("idle");
  const [runStep, setRunStep] = useState("");
  const [result, setResult] = useState<{
    leads_imported: number;
    new_contacts: number;
    already_existed: number;
    failed_import: number;
    smartlead_added: number;
    dms_queued: number;
    errors: string[];
    colddms_usernames: string[];
  } | null>(null);
  const [runError, setRunError] = useState("");

  // History
  const [runs, setRuns] = useState<OutreachRun[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [quickStats, setQuickStats] = useState(getQuickStats());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRuns(getRuns());
    setQuickStats(getQuickStats());
  }, []);

  // ── File handling ──────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    setCsvFile(file);
    setRunStatus("idle");
    setResult(null);
    setRunError("");

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setParsedLeads(parseCSV(text));
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

  // ── Single "Run Outreach" — Import to GHL then add to Smartlead ──

  const handleRunOutreach = async () => {
    setRunStatus("importing");
    setRunStep("Importing leads to GHL...");
    setRunError("");
    setResult(null);

    let importData: {
      success: number;
      failed: number;
      already_existed: number;
      total: number;
      colddms_usernames: string[];
      error?: string;
    };

    // Step 1: Import to GHL
    try {
      const res = await fetch("/api/outreach/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: parsedLeads }),
      });
      importData = await res.json();
      if (!res.ok) throw new Error(importData.error || "Import failed");
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : "Import to GHL failed");
      setRunStatus("error");
      return;
    }

    // Step 2: Run outreach (add to Smartlead + move to Contacted)
    setRunStatus("running");
    setRunStep("Adding to Smartlead campaign...");

    try {
      const res = await fetch("/api/outreach/run", { method: "POST" });
      const runData = await res.json();
      if (!res.ok) throw new Error(runData.error || "Outreach run failed");

      // Combine results
      const allUsernames = [
        ...(importData.colddms_usernames || []),
        ...(runData.colddms_usernames || []),
      ];
      const uniqueUsernames = [...new Set(allUsernames)];

      const combined = {
        leads_imported: importData.total,
        new_contacts: importData.success - (importData.already_existed || 0),
        already_existed: importData.already_existed || 0,
        failed_import: importData.failed || 0,
        smartlead_added: runData.smartlead_added || 0,
        dms_queued: uniqueUsernames.length,
        errors: runData.errors || [],
        colddms_usernames: uniqueUsernames,
      };
      setResult(combined);
      setRunStatus("done");

      // Save to history
      const run: OutreachRun = {
        id: generateRunId(),
        timestamp: new Date().toISOString(),
        leads_imported: combined.leads_imported,
        smartlead_added: combined.smartlead_added,
        dms_queued: combined.dms_queued,
        errors: combined.failed_import + combined.errors.length,
        error_details: combined.errors,
        colddms_file: `colddms_${new Date().toISOString().split("T")[0]}.txt`,
        colddms_usernames: uniqueUsernames,
        status:
          combined.errors.length > 0 && combined.smartlead_added === 0
            ? "failed"
            : combined.errors.length > 0
            ? "partial"
            : "completed",
      };
      saveRun(run);
      setRuns(getRuns());
      setQuickStats(getQuickStats());
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : "Outreach run failed");
      setRunStatus("error");
    }
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

  const handleDeleteRun = (id: string) => {
    deleteRun(id);
    setRuns(getRuns());
    setQuickStats(getQuickStats());
  };

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">
          <span className="gradient-text">Outreach Runs</span>
        </h1>
        <p className="page-subtitle">
          Upload leads, import to GHL, push to Smartlead, and download ColdDMs
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
            <div className="metric-card-value">{fmtNumber(quickStats.totalImported)}</div>
            <div className="metric-card-trend metric-card-trend-flat">all-time</div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total Emails Sent</div>
            <div className="metric-card-value">{fmtNumber(quickStats.totalEmails)}</div>
            <div className="metric-card-trend metric-card-trend-flat">via Smartlead</div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total DMs Queued</div>
            <div className="metric-card-value">{fmtNumber(quickStats.totalDMs)}</div>
            <div className="metric-card-trend metric-card-trend-flat">via ColdDMs</div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Last Run</div>
            <div className="metric-card-value" style={{ fontSize: 18 }}>
              {quickStats.lastRun
                ? new Date(quickStats.lastRun).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : "—"}
            </div>
            <div className="metric-card-trend metric-card-trend-flat">{quickStats.totalRuns} total runs</div>
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
          {/* Upload CSV */}
          <div style={{ marginBottom: 24 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "var(--accent)" : parsedLeads.length > 0 ? "var(--success)" : "var(--border-primary)"}`,
                borderRadius: 12,
                padding: "32px 24px",
                textAlign: "center",
                cursor: "pointer",
                background: dragOver ? "var(--accent-soft)" : "transparent",
                transition: "all 0.2s",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); }}
                style={{ display: "none" }}
              />
              {parsedLeads.length > 0 ? (
                <>
                  <CheckCircle size={24} style={{ color: "var(--success)", marginBottom: 8 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
                    {csvFile?.name} — {fmtNumber(parsedLeads.length)} leads ready
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Click or drag to replace</div>
                </>
              ) : (
                <>
                  <Upload size={24} style={{ color: "var(--text-muted)", marginBottom: 8 }} />
                  <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 4 }}>
                    Drop a CSV file here, or click to browse
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Expected columns: first_name, email, instagram_username
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
                      <th style={{ padding: "8px 12px", fontSize: 12 }}>Name</th>
                      <th style={{ padding: "8px 12px", fontSize: 12 }}>Email</th>
                      <th style={{ padding: "8px 12px", fontSize: 12 }}>Instagram</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedLeads.slice(0, 5).map((lead, i) => (
                      <tr key={i}>
                        <td style={{ padding: "8px 12px", fontSize: 13 }}>{lead.first_name} {lead.last_name}</td>
                        <td style={{ padding: "8px 12px", fontSize: 13, color: "var(--text-secondary)" }}>{lead.email || "—"}</td>
                        <td style={{ padding: "8px 12px", fontSize: 13, color: "var(--text-secondary)" }}>
                          {lead.instagram_username ? `@${lead.instagram_username}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedLeads.length > 5 && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "8px 0" }}>
                    + {fmtNumber(parsedLeads.length - 5)} more leads
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Single Run Button */}
          <button
            className="btn-primary"
            disabled={parsedLeads.length === 0 || runStatus === "importing" || runStatus === "running" || runStatus === "done"}
            onClick={handleRunOutreach}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 24px",
              fontSize: 14,
              fontWeight: 600,
              opacity: parsedLeads.length === 0 || runStatus === "done" ? 0.5 : 1,
            }}
          >
            {runStatus === "importing" || runStatus === "running" ? (
              <Loader2 size={16} className="spin" />
            ) : runStatus === "done" ? (
              <CheckCircle size={16} />
            ) : (
              <Rocket size={16} />
            )}
            {runStatus === "importing" || runStatus === "running"
              ? runStep
              : runStatus === "done"
              ? "Outreach Complete"
              : "Run Outreach"}
          </button>

          {/* Results */}
          {runStatus === "done" && result && (
            <div style={{ marginTop: 16 }}>
              <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--success-soft)", fontSize: 13, color: "var(--success)", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <CheckCircle size={14} />
                  {result.leads_imported} leads imported to GHL — {result.new_contacts} new, {result.already_existed} existing
                  {result.failed_import > 0 && `, ${result.failed_import} failed`}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <CheckCircle size={14} />
                  {result.smartlead_added} leads added to Smartlead email campaign
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} />
                  {result.dms_queued} Instagram usernames ready for ColdDMs
                </div>
              </div>

              {result.errors.length > 0 && (
                <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--warning-soft)", fontSize: 12, color: "var(--warning)", marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    <AlertCircle size={12} style={{ marginRight: 4 }} />
                    {result.errors.length} warnings:
                  </div>
                  {result.errors.slice(0, 5).map((err, i) => (
                    <div key={i} style={{ marginLeft: 16 }}>{err}</div>
                  ))}
                  {result.errors.length > 5 && (
                    <div style={{ marginLeft: 16, fontStyle: "italic" }}>+{result.errors.length - 5} more</div>
                  )}
                </div>
              )}

              {result.colddms_usernames.length > 0 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  <button className="btn-secondary" onClick={() => downloadTxt(result.colddms_usernames)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13 }}>
                    <Download size={14} /> Download ColdDMs (.txt)
                  </button>
                  <button className="btn-secondary" onClick={() => downloadCsv(result.colddms_usernames)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13 }}>
                    <FileText size={14} /> Download ColdDMs (.csv)
                  </button>
                  <button className="btn-secondary" onClick={() => copyUsernames(result.colddms_usernames)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13 }}>
                    <Copy size={14} /> {copied ? "Copied!" : "Copy Usernames"}
                  </button>
                </div>
              )}
            </div>
          )}

          {runStatus === "error" && (
            <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 8, background: "var(--danger-soft)", fontSize: 13, color: "var(--danger)", display: "flex", alignItems: "center", gap: 8 }}>
              <XCircle size={14} /> {runError}
            </div>
          )}
        </div>
      </div>

      {/* ── Run History ─────────────────────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <Clock size={16} />
          Run History
        </h2>
        {runs.length === 0 ? (
          <div className="glass-static" style={{ padding: "40px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
            No outreach runs yet. Upload a CSV and run your first campaign above.
          </div>
        ) : (
          <div className="glass-static" style={{ padding: 0, overflow: "hidden" }}>
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>Date</th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>Leads Imported</th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>Emails Sent</th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>DMs Queued</th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>Errors</th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>ColdDMs</th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}>Status</th>
                  <th style={{ padding: "10px 14px", fontSize: 12 }}></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td style={{ padding: "10px 14px", fontSize: 13, cursor: "pointer" }}
                      onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {expandedRun === run.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {new Date(run.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                      {expandedRun === run.id && run.error_details.length > 0 && (
                        <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "var(--danger-soft)", fontSize: 11, color: "var(--danger)" }}>
                          {run.error_details.map((err, i) => <div key={i}>{err}</div>)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{fmtNumber(run.leads_imported)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{fmtNumber(run.smartlead_added)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{fmtNumber(run.dms_queued)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: run.errors > 0 ? "var(--danger)" : "var(--text-muted)" }}>{run.errors}</td>
                    <td style={{ padding: "10px 14px" }}>
                      {run.colddms_usernames.length > 0 && (
                        <button className="btn-secondary" onClick={() => downloadTxt(run.colddms_usernames, run.colddms_file)}
                          style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 11 }}>
                          <Download size={12} /> Download
                        </button>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        fontSize: 11, padding: "3px 8px", borderRadius: 6,
                        background: run.status === "completed" ? "var(--success-soft)" : run.status === "partial" ? "var(--warning-soft)" : "var(--danger-soft)",
                        color: run.status === "completed" ? "var(--success)" : run.status === "partial" ? "var(--warning)" : "var(--danger)",
                      }}>
                        {run.status === "completed" ? "Complete" : run.status === "partial" ? "Partial" : "Failed"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <button onClick={() => handleDeleteRun(run.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }} title="Delete run">
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
