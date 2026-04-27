"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Upload,
  Download,
  Copy,
  Trash2,
  Plus,
  Save,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Loader2,
  Rocket,
  FileText,
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
  getSmartleadSegmentRoutes,
  saveSmartleadSegmentRoutes,
} from "@/lib/outreach-store";
import {
  buildColdDmsCsv,
  buildColdDmsRow,
  ColdDmsRow,
  mergeColdDmsRows,
} from "@/lib/outreach-export";
import {
  findSegmentRoute,
  normalizeSegmentKey,
  summarizeSegments,
  SegmentCount,
  SmartleadCampaignSummary,
  SmartleadSegmentRoute,
} from "@/lib/outreach-segments";
import OutreachDashboard from "@/components/outreach/OutreachDashboard";
import { AgencyBusinessMetrics } from "@/app/components/BusinessMetrics";

// ── CSV Parsing ────────────────────────────────────────────────

interface ParsedLead {
  first_name: string;
  last_name: string;
  email: string;
  instagram_username: string;
  instagram_link: string;
  segment: string;
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
    if (h === "segment" || h === "segments" || h.includes("leadsegment"))
      colMap.segment = i;
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
      segment: vals[colMap.segment] || "",
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

const IMPORT_BATCH_SIZE = 40;
const RUN_BATCH_SIZE = 40;

interface ImportApiResult {
  email: string;
  status: string;
  contactId?: string;
  error?: string;
}

interface ImportApiResponse {
  success: number;
  failed: number;
  already_existed: number;
  total: number;
  results: ImportApiResult[];
  contact_ids?: string[];
  contact_routes?: ImportedContactRoute[];
  segment_counts?: SegmentCount[];
  warnings?: string[];
  colddms_usernames: string[];
  colddms_rows?: ColdDmsRow[];
  colddms_csv?: string;
  error?: string;
}

interface ImportedContactRoute {
  contactId: string;
  segment: string;
  segment_key: string;
  segment_tag: string;
}

interface ContactSmartleadRoute extends ImportedContactRoute {
  campaignId?: string;
  campaignName?: string;
}

interface RunApiResponse {
  processed: number;
  smartlead_added: number;
  dms_queued: number;
  errors: string[];
  smartlead_campaigns?: SmartleadCampaignSummary[];
  unmapped_segments?: SegmentCount[];
  colddms_usernames: string[];
  colddms_rows?: ColdDmsRow[];
  colddms_csv?: string;
  error?: string;
}

interface PipelineApiResponse {
  pipelineId: string;
  stageMap?: Record<string, string>;
  newLeadStageId?: string | null;
  contactedStageId?: string | null;
  error?: string;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function readApiResponse<T>(res: Response) {
  const raw = await res.text();
  if (!raw) return { data: null as T | null, raw: "" };

  try {
    return { data: JSON.parse(raw) as T, raw };
  } catch {
    return { data: null as T | null, raw };
  }
}

function mergeSegmentCounts(
  existing: SegmentCount[],
  incoming: SegmentCount[] = []
) {
  const map = new Map<string, SegmentCount>();

  for (const item of [...existing, ...incoming]) {
    const key = item.segment_key || normalizeSegmentKey(item.segment);
    const current = map.get(key);
    if (current) {
      current.count += item.count;
    } else {
      map.set(key, { ...item, segment_key: key });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.segment.localeCompare(b.segment)
  );
}

function mergeSmartleadCampaignSummaries(
  existing: SmartleadCampaignSummary[],
  incoming: SmartleadCampaignSummary[] = []
) {
  const map = new Map<string, SmartleadCampaignSummary>();

  for (const item of [...existing, ...incoming]) {
    const key = `${item.campaign_id}::${item.segment_key}`;
    const current = map.get(key);
    if (current) {
      current.leads_added += item.leads_added;
    } else {
      map.set(key, { ...item });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.segment.localeCompare(b.segment)
  );
}

function buildContactSmartleadRoute(
  route: ImportedContactRoute,
  segmentRoutes: SmartleadSegmentRoute[]
): ContactSmartleadRoute {
  const smartleadRoute = findSegmentRoute(route.segment, segmentRoutes);

  return {
    ...route,
    campaignId: smartleadRoute?.campaignId.trim() || undefined,
    campaignName: smartleadRoute?.campaignName?.trim() || undefined,
  };
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
    colddms_csv: string;
    segment_counts: SegmentCount[];
    smartlead_campaigns: SmartleadCampaignSummary[];
    unmapped_segments: SegmentCount[];
  } | null>(null);
  const [runError, setRunError] = useState("");
  const [segmentRoutes, setSegmentRoutes] = useState<SmartleadSegmentRoute[]>([]);

  // History
  const [runs, setRuns] = useState<OutreachRun[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRuns(getRuns());
    setSegmentRoutes(getSmartleadSegmentRoutes());
  }, []);

  const saveSegmentRoutes = useCallback((routes: SmartleadSegmentRoute[]) => {
    setSegmentRoutes(routes);
    saveSmartleadSegmentRoutes(routes);
  }, []);

  const updateSegmentRoute = useCallback(
    (
      index: number,
      field: keyof SmartleadSegmentRoute,
      value: string
    ) => {
      const next = segmentRoutes.map((route, i) =>
        i === index ? { ...route, [field]: value } : route
      );
      saveSegmentRoutes(next);
    },
    [saveSegmentRoutes, segmentRoutes]
  );

  const addSegmentRoute = useCallback(
    (segment = "") => {
      saveSegmentRoutes([
        ...segmentRoutes,
        { segment, campaignId: "", campaignName: "" },
      ]);
    },
    [saveSegmentRoutes, segmentRoutes]
  );

  const removeSegmentRoute = useCallback(
    (index: number) => {
      saveSegmentRoutes(segmentRoutes.filter((_, i) => i !== index));
    },
    [saveSegmentRoutes, segmentRoutes]
  );

  const segmentSummaries = useMemo(() => {
    return summarizeSegments(parsedLeads, (lead) => lead.segment).map((item) => {
      const route = findSegmentRoute(item.segment, segmentRoutes);
      return {
        ...item,
        campaignId: route?.campaignId || "",
        campaignName: route?.campaignName || "",
        mapped: Boolean(route?.campaignId),
      };
    });
  }, [parsedLeads, segmentRoutes]);

  const addDetectedSegmentsToRoutes = useCallback(() => {
    const existingKeys = new Set(
      segmentRoutes.map((route) => normalizeSegmentKey(route.segment))
    );
    const missingRoutes = segmentSummaries
      .filter((segment) => !existingKeys.has(segment.segment_key))
      .map((segment) => ({
        segment: segment.segment,
        campaignId: "",
        campaignName: "",
      }));

    if (missingRoutes.length > 0) {
      saveSegmentRoutes([...segmentRoutes, ...missingRoutes]);
    }
  }, [saveSegmentRoutes, segmentRoutes, segmentSummaries]);

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

    try {
      const pipelineRes = await fetch("/api/outreach/pipeline");
      const { data: pipelineData, raw: pipelineRaw } =
        await readApiResponse<PipelineApiResponse>(pipelineRes);
      if (!pipelineData) {
        throw new Error(pipelineRaw || "Failed to load outreach pipeline");
      }
      if (!pipelineRes.ok) {
        throw new Error(
          pipelineData.error || pipelineRaw || "Failed to load outreach pipeline"
        );
      }

      const pipeline = {
        pipelineId: pipelineData.pipelineId,
        stageMap: pipelineData.stageMap || {},
        newLeadStageId: pipelineData.newLeadStageId || null,
        contactedStageId: pipelineData.contactedStageId || null,
      };

      const importTotals = {
        success: 0,
        failed: 0,
        already_existed: 0,
        results: [] as ImportApiResult[],
        colddms_rows: [] as ColdDmsRow[],
        warnings: [] as string[],
        segment_counts: [] as SegmentCount[],
      };
      const importedContactIds = new Set<string>();
      const importedContactRoutes = new Map<string, ContactSmartleadRoute>();
      const importBatches = chunkArray(parsedLeads, IMPORT_BATCH_SIZE);

      for (let index = 0; index < importBatches.length; index++) {
        const batch = importBatches[index];
        const completedCount = Math.min(
          (index + 1) * IMPORT_BATCH_SIZE,
          parsedLeads.length
        );
        setRunStep(`Importing leads to GHL... ${completedCount} of ${parsedLeads.length}`);

        const res = await fetch("/api/outreach/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leads: batch, pipeline }),
        });
        const { data, raw } = await readApiResponse<ImportApiResponse>(res);

        if (!data) {
          throw new Error(raw || "Import failed");
        }
        if (!res.ok) {
          throw new Error(data.error || raw || "Import failed");
        }

        importTotals.success += data.success || 0;
        importTotals.failed += data.failed || 0;
        importTotals.already_existed += data.already_existed || 0;
        importTotals.results.push(...(data.results || []));
        importTotals.colddms_rows = mergeColdDmsRows(
          importTotals.colddms_rows,
          data.colddms_rows
        );
        importTotals.warnings.push(...(data.warnings || []));
        importTotals.segment_counts = mergeSegmentCounts(
          importTotals.segment_counts,
          data.segment_counts
        );

        for (const route of data.contact_routes || []) {
          importedContactRoutes.set(
            route.contactId,
            buildContactSmartleadRoute(route, segmentRoutes)
          );
        }

        for (const contactId of data.contact_ids || []) {
          if (contactId) importedContactIds.add(contactId);
        }

        for (const item of data.results || []) {
          if (
            item.contactId &&
            item.status !== "failed" &&
            item.status !== "skipped"
          ) {
            importedContactIds.add(item.contactId);
          }
        }
      }

      setRunStatus("running");

      const runTotals = {
        smartlead_added: 0,
        errors: [] as string[],
        colddms_rows: [] as ColdDmsRow[],
        smartlead_campaigns: [] as SmartleadCampaignSummary[],
        unmapped_segments: [] as SegmentCount[],
      };
      const contactIds = Array.from(importedContactIds);
      const runBatches = chunkArray(contactIds, RUN_BATCH_SIZE);

      for (let index = 0; index < runBatches.length; index++) {
        const batch = runBatches[index];
        const completedCount = Math.min(
          (index + 1) * RUN_BATCH_SIZE,
          contactIds.length
        );
        setRunStep(`Adding to Smartlead campaign... ${completedCount} of ${contactIds.length}`);

        const res = await fetch("/api/outreach/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactIds: batch,
            pipeline,
            contactRoutes: batch
              .map((contactId) => importedContactRoutes.get(contactId))
              .filter(Boolean),
          }),
        });
        const { data, raw } = await readApiResponse<RunApiResponse>(res);

        if (!data) {
          throw new Error(raw || "Outreach run failed");
        }
        if (!res.ok) {
          throw new Error(data.error || raw || "Outreach run failed");
        }

        runTotals.smartlead_added += data.smartlead_added || 0;
        runTotals.errors.push(...(data.errors || []));
        runTotals.smartlead_campaigns = mergeSmartleadCampaignSummaries(
          runTotals.smartlead_campaigns,
          data.smartlead_campaigns
        );
        runTotals.unmapped_segments = mergeSegmentCounts(
          runTotals.unmapped_segments,
          data.unmapped_segments
        );
        runTotals.colddms_rows = mergeColdDmsRows(
          runTotals.colddms_rows,
          data.colddms_rows
        );
      }

      const mergedRows = mergeColdDmsRows(
        importTotals.colddms_rows,
        runTotals.colddms_rows
      );
      const uniqueUsernames = mergedRows.map((row) => row.username);
      const colddmsCsv = buildColdDmsCsv(mergedRows);

      const combined = {
        leads_imported: parsedLeads.length,
        new_contacts: importTotals.success - importTotals.already_existed,
        already_existed: importTotals.already_existed,
        failed_import: importTotals.failed,
        smartlead_added: runTotals.smartlead_added,
        dms_queued: uniqueUsernames.length,
        errors: [...importTotals.warnings, ...runTotals.errors],
        colddms_usernames: uniqueUsernames,
        colddms_csv: colddmsCsv,
        segment_counts: importTotals.segment_counts,
        smartlead_campaigns: runTotals.smartlead_campaigns,
        unmapped_segments: runTotals.unmapped_segments,
      };
      setResult(combined);
      setRunStatus("done");

      // Save to history
      const run: OutreachRun = {
        id: generateRunId(),
        timestamp: new Date().toISOString(),
        leads_imported: combined.leads_imported,
        new_contacts: combined.new_contacts,
        already_existed: combined.already_existed,
        failed_import: combined.failed_import,
        smartlead_added: combined.smartlead_added,
        dms_queued: combined.dms_queued,
        errors: combined.failed_import + combined.errors.length,
        error_details: combined.errors,
        colddms_file: `colddms_${new Date().toISOString().split("T")[0]}.txt`,
        colddms_usernames: uniqueUsernames,
        colddms_csv: combined.colddms_csv,
        segment_counts: combined.segment_counts,
        smartlead_campaigns: combined.smartlead_campaigns,
        unmapped_segments: combined.unmapped_segments,
        status:
          combined.errors.length > 0 && combined.smartlead_added === 0
            ? "failed"
            : combined.errors.length > 0
            ? "partial"
            : "completed",
      };
      saveRun(run);
      setRuns(getRuns());
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

  const downloadCsv = (csvContent: string, usernames: string[], filename?: string) => {
    const fallbackRows = usernames
      .map((username) => buildColdDmsRow({ username }))
      .filter((row): row is ColdDmsRow => Boolean(row));
    const csv = csvContent || buildColdDmsCsv(fallbackRows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `colddms_${new Date().toISOString().split("T")[0]}.csv`;
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
  };

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">
          <span className="gradient-text">Client Acquisition</span>
        </h1>
        <p className="page-subtitle">
          Agency business metrics plus outreach analytics, CSV import, Smartlead pushes, and ColdDM downloads
        </p>
      </div>

      <AgencyBusinessMetrics />

      <OutreachDashboard />

      {/* ── Run Outreach Panel ──────────────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <Rocket size={16} />
          Run Outreach
        </h2>
        <div className="glass-static" style={{ padding: 24 }}>
          {/* Smartlead routing */}
          <div style={{ marginBottom: 24, padding: 16, border: "1px solid var(--border-primary)", borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: 0 }}>
                  <Save size={14} />
                  Smartlead Campaign Routing
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  Segment names are matched loosely. Unmapped segments still run, but email is skipped.
                </div>
              </div>
              <button
                className="btn-secondary"
                onClick={() => addSegmentRoute()}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12 }}
              >
                <Plus size={14} /> Add Mapping
              </button>
            </div>

            {segmentRoutes.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "10px 0" }}>
                No Smartlead routes yet. Add segment names now, then paste campaign IDs when you have them.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "8px 10px", fontSize: 11 }}>Segment</th>
                      <th style={{ padding: "8px 10px", fontSize: 11 }}>Campaign ID</th>
                      <th style={{ padding: "8px 10px", fontSize: 11 }}>Campaign Name</th>
                      <th style={{ padding: "8px 10px", fontSize: 11 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {segmentRoutes.map((route, index) => (
                      <tr key={index}>
                        <td style={{ padding: "8px 10px", minWidth: 180 }}>
                          <input
                            value={route.segment}
                            onChange={(e) => updateSegmentRoute(index, "segment", e.target.value)}
                            placeholder="fitness coaches"
                            style={{ width: "100%", minWidth: 160, background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: 6, padding: "8px 10px", color: "var(--text-primary)", fontSize: 13 }}
                          />
                        </td>
                        <td style={{ padding: "8px 10px", minWidth: 170 }}>
                          <input
                            value={route.campaignId}
                            onChange={(e) => updateSegmentRoute(index, "campaignId", e.target.value)}
                            placeholder="Smartlead campaign ID"
                            style={{ width: "100%", minWidth: 150, background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: 6, padding: "8px 10px", color: "var(--text-primary)", fontSize: 13 }}
                          />
                        </td>
                        <td style={{ padding: "8px 10px", minWidth: 180 }}>
                          <input
                            value={route.campaignName || ""}
                            onChange={(e) => updateSegmentRoute(index, "campaignName", e.target.value)}
                            placeholder="Optional name"
                            style={{ width: "100%", minWidth: 160, background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: 6, padding: "8px 10px", color: "var(--text-primary)", fontSize: 13 }}
                          />
                        </td>
                        <td style={{ padding: "8px 10px", width: 44 }}>
                          <button
                            onClick={() => removeSegmentRoute(index)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}
                            title="Delete mapping"
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

            {segmentSummaries.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-primary)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0 }}>
                    CSV Segments
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={addDetectedSegmentsToRoutes}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", fontSize: 12 }}
                  >
                    <Plus size={13} /> Add Detected Segments
                  </button>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {segmentSummaries.map((segment) => (
                    <div
                      key={segment.segment_key}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(120px, 1fr) 80px minmax(150px, 1.4fr)",
                        gap: 10,
                        alignItems: "center",
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: segment.mapped ? "var(--success-soft)" : "var(--warning-soft)",
                        color: segment.mapped ? "var(--success)" : "var(--warning)",
                        fontSize: 12,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{segment.segment}</span>
                      <span>{fmtNumber(segment.count)} leads</span>
                      <span>{segment.mapped ? `Routes to ${segment.campaignName || segment.campaignId}` : "Not mapped. Smartlead email skipped."}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

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
                    Expected columns: first_name, email, instagram_username, segment
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
                      <th style={{ padding: "8px 12px", fontSize: 12 }}>Segment</th>
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
                        <td style={{ padding: "8px 12px", fontSize: 13, color: "var(--text-secondary)" }}>{lead.segment || "—"}</td>
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
                  {result.smartlead_added} leads added to Smartlead
                  {result.smartlead_campaigns.length > 0
                    ? ` across ${result.smartlead_campaigns.length} route${result.smartlead_campaigns.length !== 1 ? "s" : ""}`
                    : " email campaign"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} />
                  {result.dms_queued} Instagram usernames ready for ColdDMs
                </div>
              </div>

              {result.smartlead_campaigns.length > 0 && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-secondary)", fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
                  {result.smartlead_campaigns.map((campaign) => (
                    <div key={`${campaign.campaign_id}-${campaign.segment_key}`}>
                      {campaign.segment}: {fmtNumber(campaign.leads_added)} leads to {campaign.campaign_name || campaign.campaign_id}
                    </div>
                  ))}
                </div>
              )}

              {result.unmapped_segments.length > 0 && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--warning-soft)", fontSize: 12, color: "var(--warning)", marginBottom: 8 }}>
                  Unmapped: {result.unmapped_segments.map((segment) => `${segment.segment} (${fmtNumber(segment.count)})`).join(", ")}
                </div>
              )}

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
                  <button className="btn-secondary" onClick={() => downloadCsv(result.colddms_csv, result.colddms_usernames)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 13 }}>
                    <FileText size={14} /> Download ColdDMs Sheet (.csv)
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
                      {expandedRun === run.id && (
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--success-soft)", fontSize: 12, color: "var(--success)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                              <CheckCircle size={12} />
                              {fmtNumber(run.leads_imported)} leads imported to GHL — {fmtNumber(run.new_contacts || 0)} new, {fmtNumber(run.already_existed || 0)} existing
                              {(run.failed_import || 0) > 0 && `, ${fmtNumber(run.failed_import || 0)} failed`}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                              <CheckCircle size={12} />
                              {fmtNumber(run.smartlead_added)} leads added to Smartlead email campaign
                            </div>
                            {(run.smartlead_campaigns || []).map((campaign) => (
                              <div key={`${campaign.campaign_id}-${campaign.segment_key}`} style={{ marginLeft: 18, marginBottom: 3 }}>
                                {campaign.segment}: {fmtNumber(campaign.leads_added)} to {campaign.campaign_name || campaign.campaign_id}
                              </div>
                            ))}
                            {(run.unmapped_segments || []).length > 0 && (
                              <div style={{ marginLeft: 18, marginBottom: 3, color: "var(--warning)" }}>
                                Unmapped: {(run.unmapped_segments || []).map((segment) => `${segment.segment} (${fmtNumber(segment.count)})`).join(", ")}
                              </div>
                            )}
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <CheckCircle size={12} />
                              {fmtNumber(run.dms_queued)} Instagram usernames ready for ColdDMs
                            </div>
                          </div>
                          {run.error_details.length > 0 && (
                            <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--danger-soft)", fontSize: 11, color: "var(--danger)" }}>
                              {run.error_details.map((err, i) => <div key={i}>{err}</div>)}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{fmtNumber(run.leads_imported)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{fmtNumber(run.smartlead_added)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{fmtNumber(run.dms_queued)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: run.errors > 0 ? "var(--danger)" : "var(--text-muted)" }}>{run.errors}</td>
                    <td style={{ padding: "10px 14px" }}>
                      {run.colddms_usernames.length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn-secondary" onClick={() => downloadTxt(run.colddms_usernames, run.colddms_file)}
                            style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 11 }}>
                            <Download size={12} /> Txt
                          </button>
                          <button className="btn-secondary" onClick={() => downloadCsv(run.colddms_csv || "", run.colddms_usernames, run.colddms_file.replace(/\.txt$/, ".csv"))}
                            style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 11 }}>
                            <FileText size={12} /> CSV
                          </button>
                        </div>
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
