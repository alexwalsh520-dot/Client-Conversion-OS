"use client";

import { useState, useRef, useEffect } from "react";
import {
  Crosshair,
  Play,
  Download,
  Instagram,
  Youtube,
  Mail,
  Users,
  Activity,
  Brain,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  CheckCircle,
  AlertCircle,
  Search,
  Zap,
  Clock,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface Lead {
  score: number;
  username: string;
  fullName: string;
  igEmail: string;
  youtubeChannel: string | null;
  youtubeMethod: string | null;
  followers: number;
  engagementRate: number | null;
  avgViews: number | null;
  avgLikes: number | null;
  monetization: string;
  reason: string;
  brandSource: string;
  biography: string;
  website: string;
  profileUrl: string;
  businessCategory: string;
  dataAvailable: boolean;
}

interface RunStats {
  brands: number;
  brandErrors: number;
  raw: number;
  filtered: number;
  enriched: number;
  engagementPassed?: number;
  withEmail?: number;
  qualified: number;
  youtube: number;
  emails: number;
}

type PipelineStep = number | null;

// Poll response shape
interface PollResponse {
  status: "enriching" | "complete" | "failed";
  leads?: Lead[];
  stats?: { scrapedCount: number; enrichedCount: number; emailCount: number };
  progress?: { runStatus: string; scrapedCount: number; datasetItemCount?: number; requestsFinished?: number; requestsTotal?: number };
  error?: string;
}

interface HistoryRun {
  id: string;
  status: string;
  mode: string;
  created_at: string;
  scraped_count: number;
  lead_count: number;
  email_count: number;
  config: any;
}

const FULL_STEP_LABELS: Record<number, string> = {
  1: "Scraping Brands",
  2: "Enriching Profiles",
  3: "Engagement Filter",
  4: "AI Scoring",
  5: "YouTube Discovery",
};

const QUICK_STEP_LABELS: Record<number, string> = {
  1: "Scraping Brands",
  2: "Starting Enrichment",
};

const DEFAULT_BRANDS = [
  "gymshark", "1stphorm", "youngla", "darcsport", "alphaleteathletics",
  "nvgtn", "ghostlifestyle", "rawgear", "gymreapers", "gorillawear",
  "musclenation", "buffbunnyco", "rabornyofficial",
];

// ─── Component ──────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  // Mode
  const [mode, setMode] = useState<"full" | "quick">("quick");

  // Run state
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<PipelineStep>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Async polling state (Quick Scan)
  const [polling, setPolling] = useState(false);
  const [pollJobId, setPollJobId] = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState<string>("");
  const [enrichStartTime, setEnrichStartTime] = useState<number | null>(null);
  const [enrichElapsed, setEnrichElapsed] = useState(0);
  const [enrichPct, setEnrichPct] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // History
  const [showHistory, setShowHistory] = useState(false);
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);

  // Config
  const [testMode, setTestMode] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [brands, setBrands] = useState(DEFAULT_BRANDS.join(", "));
  const [maxFollowing, setMaxFollowing] = useState("200");
  const [minFollowers, setMinFollowers] = useState("100000");
  const [maxFollowers, setMaxFollowers] = useState("5000000");
  const [minScore, setMinScore] = useState("60");

  // Table
  const [searchFilter, setSearchFilter] = useState("");
  const [sortBy, setSortBy] = useState<"score" | "followers">("followers");

  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const totalSteps = mode === "quick" ? 2 : 5;
  const stepLabels = mode === "quick" ? QUICK_STEP_LABELS : FULL_STEP_LABELS;

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Reset results when switching modes
  useEffect(() => {
    if (!running && !polling) {
      setLeads([]);
      setStats(null);
      setError(null);
      setLogs([]);
      setCurrentStep(null);
      setSortBy(mode === "quick" ? "followers" : "score");
    }
  }, [mode]);

  // Cleanup poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Tick elapsed time every second while polling
  useEffect(() => {
    if (!polling || !enrichStartTime) {
      setEnrichElapsed(0);
      return;
    }
    const tick = setInterval(() => {
      setEnrichElapsed(Math.floor((Date.now() - enrichStartTime) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [polling, enrichStartTime]);

  // ─── History ───────────────────────────────────────────────────────────────

  async function fetchHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/lead-gen/history");
      if (!res.ok) throw new Error("Failed to load history");
      const data = await res.json();
      setHistoryRuns(data.runs || []);
    } catch {
      setHistoryRuns([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next) fetchHistory();
  }

  async function downloadHistoryCSV(jobId: string) {
    setDownloadingJobId(jobId);
    try {
      const res = await fetch(`/api/lead-gen/history/${jobId}`);
      if (!res.ok) throw new Error("Failed to load job");
      const { job } = await res.json();
      if (!job?.results || !Array.isArray(job.results)) {
        alert("No results stored for this run.");
        return;
      }

      const esc = (v: any) => {
        const str = String(v ?? "");
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const isQuick = job.mode === "quick";
      const headers = isQuick
        ? ["username", "full_name", "email", "followers", "biography", "website", "profile_url", "brand_source", "business_category"]
        : ["score", "username", "full_name", "ig_email", "youtube_channel", "followers", "engagement_rate", "avg_views", "monetization", "reason", "brand_source", "biography", "website", "profile_url"];

      const rows = job.results.map((l: any) =>
        isQuick
          ? [l.username, l.fullName, l.igEmail, l.followers, l.biography, l.website, l.profileUrl, l.brandSource, l.businessCategory]
          : [l.score, l.username, l.fullName, l.igEmail, l.youtubeChannel || "", l.followers, l.engagementRate ?? "", l.avgViews ?? "", l.monetization, l.reason, l.brandSource, l.biography, l.website, l.profileUrl]
      );

      const csv = [headers.join(","), ...rows.map((r: any[]) => r.map(esc).join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dateStr = new Date(job.created_at).toISOString().slice(0, 10);
      a.download = `${isQuick ? "quick" : "full"}_leads_${dateStr}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || "Download failed");
    } finally {
      setDownloadingJobId(null);
    }
  }

  // ─── Poll for async enrichment results ────────────────────────────────────

  function startPolling(jobId: string) {
    setPollJobId(jobId);
    setPolling(true);
    setEnrichStartTime(Date.now());
    setEnrichPct(0);
    setEnrichProgress("Enrichment starting on Apify...");

    // Poll immediately, then every 5 seconds
    pollOnce(jobId);
    pollTimerRef.current = setInterval(() => pollOnce(jobId), 5000);
  }

  async function pollOnce(jobId: string) {
    try {
      const res = await fetch(`/api/lead-gen/poll?jobId=${jobId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Poll failed" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: PollResponse = await res.json();

      if (data.status === "complete" && data.leads) {
        // Done! Stop polling and show results
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        setPolling(false);
        setRunning(false);
        setCurrentStep(null);
        setEnrichProgress("");
        setEnrichStartTime(null);
        setEnrichPct(100);

        setLeads(data.leads);
        setStats({
          brands: 0, // will be set from job
          brandErrors: 0,
          raw: data.stats?.scrapedCount || 0,
          filtered: data.stats?.scrapedCount || 0,
          enriched: data.stats?.enrichedCount || 0,
          withEmail: data.stats?.emailCount || 0,
          qualified: 0,
          youtube: 0,
          emails: data.stats?.emailCount || 0,
        });

        const emailCount = data.stats?.emailCount || 0;
        const totalCount = data.leads.length;
        setLogs((prev) => [
          ...prev,
          `✅ Enrichment complete — ${totalCount} profiles, ${emailCount} emails found`,
        ]);

        // Refresh history if panel is open
        if (showHistory) fetchHistory();

      } else if (data.status === "failed") {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        setPolling(false);
        setRunning(false);
        setError(data.error || "Enrichment failed");
        setEnrichProgress("");
        setEnrichStartTime(null);
        setEnrichPct(0);

      } else if (data.status === "enriching" && data.progress) {
        // Still running — update progress
        const p = data.progress;
        const finished = p.datasetItemCount || p.requestsFinished || 0;
        const total = p.requestsTotal || p.scrapedCount || 0;
        const pct = total > 0 ? Math.round((finished / total) * 100) : 0;
        setEnrichPct(pct);
        setEnrichProgress(
          total > 0 && finished > 0
            ? `Enriching profiles... ${finished}/${total} (${pct}%)`
            : p.runStatus === "READY" || p.runStatus === "RUNNING"
            ? "Apify actor spinning up..."
            : `Enriching profiles... ${p.runStatus}`
        );
      }
    } catch (err: any) {
      // Don't stop polling on transient errors
      setEnrichProgress(`Checking enrichment status... (${err.message?.slice(0, 50)})`);
    }
  }

  // ─── Run Pipeline ───────────────────────────────────────────────────────────

  async function runPipeline() {
    setRunning(true);
    setLogs([]);
    setLeads([]);
    setStats(null);
    setError(null);
    setCurrentStep(null);

    abortRef.current = new AbortController();

    try {
      const configPayload = {
        brandAccounts: brands.split(",").map((b) => b.trim()).filter(Boolean),
        maxFollowingPerBrand: parseInt(maxFollowing) || 200,
        minFollowers: parseInt(minFollowers) || 100000,
        maxFollowers: parseInt(maxFollowers) || 5000000,
        minScore: parseInt(minScore) || 60,
      };

      const res = await fetch("/api/lead-gen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: testMode, mode, config: configPayload }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      // Read SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (currentEvent) {
                case "log":
                  setLogs((prev) => [...prev, data.message]);
                  break;
                case "step":
                  setCurrentStep(data.step);
                  setLogs((prev) => [...prev, `── Step ${data.step}: ${data.label} ──`]);
                  break;
                case "job_started":
                  // Quick Scan async — SSE stream ends, switch to polling
                  setLogs((prev) => [
                    ...prev,
                    `⏳ Enrichment started for ${data.scrapedCount} profiles — polling for results...`,
                  ]);
                  setCurrentStep(null);
                  if (data.jobId) {
                    startPolling(data.jobId);
                  } else {
                    setError("No job ID returned");
                    setRunning(false);
                  }
                  break;
                case "complete":
                  setLeads(data.leads || []);
                  setStats(data.stats || null);
                  setCurrentStep(null);
                  break;
                case "error":
                  setError(data.message);
                  break;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      // Don't clear running if we transitioned to async polling
      if (!pollTimerRef.current) {
        setRunning(false);
      }
    }
  }

  function stopPipeline() {
    abortRef.current?.abort();
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
    setEnrichProgress("");
    setEnrichStartTime(null);
    setEnrichPct(0);
    setRunning(false);
  }

  // ─── CSV Export ─────────────────────────────────────────────────────────────

  function downloadCSV() {
    const escapeCSV = (v: any) => {
      const str = String(v ?? "");
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    if (mode === "quick") {
      const headers = [
        "username", "full_name", "email", "followers",
        "biography", "website", "profile_url", "brand_source", "business_category",
      ];
      const rows = leads.map((l) => [
        l.username, l.fullName, l.igEmail, l.followers,
        l.biography, l.website, l.profileUrl, l.brandSource, l.businessCategory,
      ]);
      const csv = [headers.join(","), ...rows.map((r) => r.map(escapeCSV).join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quick_leads_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const headers = [
        "score", "username", "full_name", "ig_email", "youtube_channel",
        "followers", "engagement_rate", "avg_views", "monetization", "reason",
        "brand_source", "biography", "website", "profile_url",
      ];
      const rows = leads
        .filter((l) => l.score >= (parseInt(minScore) || 60))
        .map((l) => [
          l.score, l.username, l.fullName, l.igEmail, l.youtubeChannel || "",
          l.followers, l.engagementRate ?? "", l.avgViews ?? "", l.monetization,
          l.reason, l.brandSource, l.biography, l.website, l.profileUrl,
        ]);
      const csv = [headers.join(","), ...rows.map((r) => r.map(escapeCSV).join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  // ─── Filtered + Sorted Leads ────────────────────────────────────────────────

  const filteredLeads = leads
    .filter((l) => {
      if (mode === "full") return l.score >= (parseInt(minScore) || 0);
      return true; // Quick scan — show all
    })
    .filter((l) => {
      if (!searchFilter) return true;
      const q = searchFilter.toLowerCase();
      return (
        l.username.toLowerCase().includes(q) ||
        l.fullName.toLowerCase().includes(q) ||
        l.brandSource.toLowerCase().includes(q) ||
        (l.igEmail || "").toLowerCase().includes(q) ||
        (l.biography || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => (sortBy === "score" ? b.score - a.score : b.followers - a.followers));

  // ─── Score Badge Color ──────────────────────────────────────────────────────

  function scoreColor(score: number) {
    if (score >= 80) return "var(--success)";
    if (score >= 60) return "var(--accent)";
    if (score >= 40) return "var(--warning)";
    return "var(--danger)";
  }

  function scoreBg(score: number) {
    if (score >= 80) return "var(--success-soft)";
    if (score >= 60) return "var(--accent-soft)";
    if (score >= 40) return "var(--warning-soft)";
    return "var(--danger-soft)";
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 className="page-title">
              <span className="gradient-text">Lead Machine</span>
            </h1>
            <p className="page-subtitle">
              {mode === "quick"
                ? "Fast email scraper — scan brand followers and export accounts with email in bio"
                : "Find fitness influencer leads from brand following lists, score with AI, discover YouTube channels"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {leads.length > 0 && (
              <button className="btn-secondary" onClick={downloadCSV} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <Download size={14} />
                Export CSV ({leads.length})
              </button>
            )}
            {running || polling ? (
              <button
                className="btn-secondary"
                onClick={stopPipeline}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
              >
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                {polling ? "Enriching..." : "Stop"}
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={runPipeline}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
              >
                {mode === "quick" ? <Zap size={14} /> : <Play size={14} />}
                {mode === "quick" ? "Quick Scan" : "Run Pipeline"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mode Tabs + History Toggle */}
      <div className="section" style={{ paddingBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "inline-flex",
              gap: 2,
              background: "rgba(255,255,255,0.03)",
              borderRadius: 10,
              padding: 3,
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <button
              onClick={() => !running && !polling && setMode("quick")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 18px",
                borderRadius: 8,
                border: "none",
                fontSize: 13,
                fontWeight: mode === "quick" ? 600 : 400,
                cursor: running || polling ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
                background: mode === "quick" ? "rgba(201,169,110,0.15)" : "transparent",
                color: mode === "quick" ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              <Zap size={14} />
              Quick Scan
            </button>
            <button
              onClick={() => !running && !polling && setMode("full")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 18px",
                borderRadius: 8,
                border: "none",
                fontSize: 13,
                fontWeight: mode === "full" ? 600 : 400,
                cursor: running || polling ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
                background: mode === "full" ? "rgba(201,169,110,0.15)" : "transparent",
                color: mode === "full" ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              <Brain size={14} />
              Full Pipeline
            </button>
          </div>
          <button
            onClick={toggleHistory}
            title="Run History"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              borderRadius: 8,
              border: showHistory ? "1px solid rgba(201,169,110,0.3)" : "1px solid rgba(255,255,255,0.06)",
              background: showHistory ? "rgba(201,169,110,0.12)" : "rgba(255,255,255,0.03)",
              color: showHistory ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              flexShrink: 0,
            }}
          >
            <Clock size={15} />
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, marginBottom: 0 }}>
          {mode === "quick"
            ? "Scrape → Enrich → Export emails. No AI scoring or YouTube lookup."
            : "Scrape → Enrich → Engagement → AI Score → YouTube. Full qualification."}
        </p>
      </div>

      {/* Run History Panel */}
      {showHistory && (
        <div className="section">
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            <Clock size={16} />
            Run History
          </h2>
          {historyLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, padding: 16 }}>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              Loading runs...
            </div>
          ) : historyRuns.length === 0 ? (
            <div className="glass-static" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              No runs yet. Run a Quick Scan or Full Pipeline to see history here.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {historyRuns.map((run) => {
                const date = new Date(run.created_at);
                const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                const isComplete = run.status === "complete";
                const isFailed = run.status === "failed";
                const isEnriching = run.status === "enriching";
                const brands = run.config?.brandAccounts?.length || 0;
                const isTest = run.config?.isTest;

                return (
                  <div
                    key={run.id}
                    className="glass-static"
                    style={{
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                      {/* Status dot */}
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: isComplete
                            ? "var(--success)"
                            : isFailed
                            ? "var(--danger)"
                            : "var(--accent)",
                        }}
                      />
                      {/* Date + Time */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                          {dateStr} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{timeStr}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                          {/* Mode badge */}
                          <span
                            style={{
                              padding: "1px 6px",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                              background: run.mode === "quick" ? "rgba(201,169,110,0.12)" : "rgba(126,201,160,0.12)",
                              color: run.mode === "quick" ? "var(--accent)" : "var(--success)",
                            }}
                          >
                            {run.mode === "quick" ? "Quick" : "Full"}
                          </span>
                          {isTest && (
                            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>TEST</span>
                          )}
                          <span>{run.scraped_count || 0} scraped</span>
                          {isComplete && (
                            <>
                              <span>·</span>
                              <span>{run.lead_count || 0} leads</span>
                              <span>·</span>
                              <span style={{ color: "var(--accent)" }}>{run.email_count || 0} emails</span>
                            </>
                          )}
                          {isFailed && <span style={{ color: "var(--danger)" }}>Failed</span>}
                          {isEnriching && <span style={{ color: "var(--accent)" }}>Enriching...</span>}
                        </div>
                      </div>
                    </div>
                    {/* Download button */}
                    {isComplete && (run.lead_count || 0) > 0 && (
                      <button
                        onClick={() => downloadHistoryCSV(run.id)}
                        disabled={downloadingJobId === run.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: "1px solid rgba(255,255,255,0.08)",
                          background: "rgba(255,255,255,0.03)",
                          color: "var(--text-secondary)",
                          cursor: downloadingJobId === run.id ? "wait" : "pointer",
                          fontSize: 12,
                          flexShrink: 0,
                          transition: "all 0.15s ease",
                          opacity: downloadingJobId === run.id ? 0.5 : 1,
                        }}
                      >
                        {downloadingJobId === run.id ? (
                          <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                        ) : (
                          <Download size={12} />
                        )}
                        CSV
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Config Panel */}
      <div className="section">
        <button
          onClick={() => setShowConfig(!showConfig)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: "1px",
            fontWeight: 500,
            padding: 0,
            marginBottom: showConfig ? 16 : 0,
          }}
        >
          <Crosshair size={14} />
          Configuration
          {showConfig ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showConfig && (
          <div className="glass-static" style={{ padding: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {/* Mode Toggle */}
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="form-label">Run Mode</label>
                <div
                  onClick={() => setTestMode(!testMode)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                    padding: "10px 16px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    userSelect: "none",
                  }}
                >
                  {/* Toggle track */}
                  <div style={{
                    width: 40,
                    height: 22,
                    borderRadius: 11,
                    background: testMode ? "rgba(201,169,110,0.3)" : "var(--accent)",
                    position: "relative",
                    transition: "background 0.2s",
                    flexShrink: 0,
                  }}>
                    <div style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: testMode ? "var(--text-secondary)" : "var(--bg-primary)",
                      position: "absolute",
                      top: 3,
                      left: testMode ? 3 : 21,
                      transition: "left 0.2s, background 0.2s",
                    }} />
                  </div>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                      {testMode ? "Test Mode" : "Full Run"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                      {testMode ? "1 brand · up to 100 accounts · fast" : `All ${brands.split(",").filter(Boolean).length} brands · ${maxFollowing} per brand`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Leads per Brand */}
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="form-label">Leads per Brand</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {["100", "200", "300", "500"].map((val) => (
                    <button
                      key={val}
                      onClick={() => setMaxFollowing(val)}
                      style={{
                        padding: "8px 20px",
                        borderRadius: 8,
                        border: maxFollowing === val
                          ? "1px solid var(--accent)"
                          : "1px solid rgba(255,255,255,0.08)",
                        background: maxFollowing === val
                          ? "rgba(201,169,110,0.15)"
                          : "rgba(255,255,255,0.03)",
                        color: maxFollowing === val ? "var(--accent)" : "var(--text-secondary)",
                        fontWeight: maxFollowing === val ? 600 : 400,
                        fontSize: 13,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {val}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, display: "block" }}>
                  {testMode ? "Test mode caps at 100 regardless" : `Scrape up to ${maxFollowing} accounts per brand`}
                </span>
              </div>

              {/* Brands */}
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="form-label">Brand Accounts (comma-separated)</label>
                <textarea
                  className="form-input"
                  value={brands}
                  onChange={(e) => setBrands(e.target.value)}
                  rows={3}
                  style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
                />
              </div>

              {/* Follower Range */}
              <div>
                <label className="form-label">Min Followers</label>
                <input
                  className="form-input"
                  type="number"
                  value={minFollowers}
                  onChange={(e) => setMinFollowers(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Max Followers</label>
                <input
                  className="form-input"
                  type="number"
                  value={maxFollowers}
                  onChange={(e) => setMaxFollowers(e.target.value)}
                />
              </div>

              {/* Score Threshold — only for Full Pipeline */}
              {mode === "full" && (
                <div>
                  <label className="form-label">Min Score (0-100)</label>
                  <input
                    className="form-input"
                    type="number"
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value)}
                    min={0}
                    max={100}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pipeline Progress */}
      {(running || polling || logs.length > 0) && (
        <div className="section">
          <h2 className="section-title">
            <Activity size={16} />
            Pipeline Progress
          </h2>

          {/* Step Indicators */}
          {(running || polling) && (
            <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
              {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
                <div
                  key={step}
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    background:
                      polling
                        ? "var(--accent)" // all steps done when polling
                        : currentStep && step < currentStep
                        ? "var(--success)"
                        : currentStep && step === currentStep
                        ? "var(--accent)"
                        : "var(--border-primary)",
                    transition: "background 0.3s ease",
                  }}
                />
              ))}
            </div>
          )}

          {running && currentStep && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 12,
                fontSize: 13,
                color: "var(--accent)",
              }}
            >
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              Step {currentStep}/{totalSteps}: {stepLabels[currentStep] || "Processing..."}
            </div>
          )}

          {/* Async enrichment polling indicator */}
          {polling && (
            <div
              style={{
                marginBottom: 12,
                borderRadius: 10,
                background: "rgba(201,169,110,0.06)",
                border: "1px solid rgba(201,169,110,0.15)",
                overflow: "hidden",
              }}
            >
              {/* Progress bar */}
              <div style={{ height: 3, background: "rgba(255,255,255,0.03)", position: "relative" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(enrichPct, 5)}%`,
                    background: "linear-gradient(90deg, var(--accent), rgba(201,169,110,0.6))",
                    borderRadius: 3,
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
              <div style={{ padding: "12px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--accent)" }}>
                    <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                    {enrichProgress || "Enriching profiles..."}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", display: "flex", gap: 12, alignItems: "center" }}>
                    {/* Elapsed time */}
                    {enrichElapsed > 0 && (
                      <span>
                        {enrichElapsed >= 60
                          ? `${Math.floor(enrichElapsed / 60)}m ${enrichElapsed % 60}s`
                          : `${enrichElapsed}s`}
                      </span>
                    )}
                    {/* ETA */}
                    {enrichPct > 5 && enrichElapsed > 10 && (
                      <span style={{ color: "var(--accent)", fontSize: 11 }}>
                        ~{(() => {
                          const remaining = Math.round((enrichElapsed / enrichPct) * (100 - enrichPct));
                          return remaining >= 60
                            ? `${Math.floor(remaining / 60)}m ${remaining % 60}s left`
                            : `${remaining}s left`;
                        })()}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                  Apify is enriching each profile — this typically takes 2-5 min for ~100 profiles. Results will appear automatically.
                </div>
              </div>
            </div>
          )}

          {/* Log Output */}
          <div
            className="glass-static"
            style={{
              padding: 16,
              maxHeight: 200,
              overflowY: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              lineHeight: 1.6,
            }}
          >
            {logs.map((log, i) => (
              <div
                key={i}
                style={{
                  color: log.startsWith("──")
                    ? "var(--accent)"
                    : log.includes("FAILED") || log.includes("error") || log.includes("Error")
                    ? "var(--danger)"
                    : log.startsWith("⚡")
                    ? "var(--success)"
                    : "var(--text-secondary)",
                  fontWeight: log.startsWith("──") ? 600 : 400,
                }}
              >
                {log}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="section">
          <div
            className="glass-static"
            style={{
              padding: 16,
              borderLeft: "3px solid var(--danger)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "var(--danger)",
              fontSize: 13,
            }}
          >
            <AlertCircle size={16} />
            {error}
          </div>
        </div>
      )}

      {/* Stats Summary */}
      {stats && (
        <div className="section">
          <h2 className="section-title">
            <CheckCircle size={16} />
            Run Summary
          </h2>
          {mode === "quick" ? (
            <div className="metric-grid metric-grid-4">
              <div className="glass-static metric-card">
                <div className="metric-card-label">Profiles Scraped</div>
                <div className="metric-card-value">{stats.filtered}</div>
              </div>
              <div className="glass-static metric-card">
                <div className="metric-card-label">Enriched</div>
                <div className="metric-card-value">{stats.enriched}</div>
              </div>
              <div className="glass-static metric-card">
                <div className="metric-card-label">With Email</div>
                <div className="metric-card-value" style={{ color: "var(--success)" }}>{stats.withEmail || stats.emails}</div>
              </div>
              <div className="glass-static metric-card">
                <div className="metric-card-label">Hit Rate</div>
                <div className="metric-card-value" style={{ color: "var(--accent)" }}>
                  {stats.enriched > 0 ? Math.round(((stats.withEmail || stats.emails) / stats.enriched) * 100) : 0}%
                </div>
              </div>
            </div>
          ) : (
            <div className="metric-grid metric-grid-4">
              <div className="glass-static metric-card">
                <div className="metric-card-label">Profiles Found</div>
                <div className="metric-card-value">{stats.filtered}</div>
              </div>
              <div className="glass-static metric-card">
                <div className="metric-card-label">Qualified</div>
                <div className="metric-card-value" style={{ color: "var(--success)" }}>{stats.qualified}</div>
              </div>
              <div className="glass-static metric-card">
                <div className="metric-card-label">YouTube Found</div>
                <div className="metric-card-value">{stats.youtube}</div>
              </div>
              <div className="glass-static metric-card">
                <div className="metric-card-label">Emails</div>
                <div className="metric-card-value">{stats.emails}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results Table */}
      {leads.length > 0 && (
        <div className="section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              <Users size={16} />
              {mode === "quick" ? `Email Leads (${filteredLeads.length})` : `Leads (${filteredLeads.length})`}
            </h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ position: "relative" }}>
                <Search
                  size={14}
                  style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
                />
                <input
                  className="form-input"
                  placeholder="Search leads..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  style={{ paddingLeft: 32, width: 200, fontSize: 12 }}
                />
              </div>
              {mode === "full" && (
                <select
                  className="form-input"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  style={{ width: 140, fontSize: 12 }}
                >
                  <option value="score">Sort: Score</option>
                  <option value="followers">Sort: Followers</option>
                </select>
              )}
            </div>
          </div>

          <div className="glass-static" style={{ overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              {mode === "quick" ? (
                /* ── Quick Scan Table ── */
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Followers</th>
                      <th>Bio</th>
                      <th>Brand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.map((lead) => (
                      <tr key={lead.username}>
                        <td>
                          <a
                            href={lead.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontWeight: 600,
                              color: "var(--text-primary)",
                              textDecoration: "none",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 13,
                            }}
                          >
                            @{lead.username}
                            <ExternalLink size={10} style={{ color: "var(--text-muted)" }} />
                          </a>
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                            {lead.fullName || "—"}
                          </span>
                        </td>
                        <td>
                          <a
                            href={`mailto:${lead.igEmail}`}
                            style={{
                              fontSize: 12,
                              color: "var(--accent)",
                              textDecoration: "none",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <Mail size={12} />
                            {lead.igEmail}
                          </a>
                        </td>
                        <td style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
                          {lead.followers >= 1000000
                            ? `${(lead.followers / 1000000).toFixed(1)}M`
                            : lead.followers >= 1000
                            ? `${(lead.followers / 1000).toFixed(0)}K`
                            : lead.followers || "—"}
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted)",
                              maxWidth: 240,
                              display: "inline-block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={lead.biography}
                          >
                            {lead.biography || "—"}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            @{lead.brandSource}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                /* ── Full Pipeline Table ── */
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Score</th>
                      <th>Username</th>
                      <th>Followers</th>
                      <th>Engagement</th>
                      <th>Monetization</th>
                      <th>Channels</th>
                      <th>Brand Source</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.map((lead) => (
                      <tr key={lead.username}>
                        <td>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 36,
                              height: 24,
                              borderRadius: 12,
                              fontSize: 11,
                              fontWeight: 700,
                              background: scoreBg(lead.score),
                              color: scoreColor(lead.score),
                            }}
                          >
                            {lead.score}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <a
                              href={lead.profileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontWeight: 600,
                                color: "var(--text-primary)",
                                textDecoration: "none",
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 13,
                              }}
                            >
                              @{lead.username}
                              <ExternalLink size={10} style={{ color: "var(--text-muted)" }} />
                            </a>
                            {lead.fullName && (
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{lead.fullName}</span>
                            )}
                          </div>
                        </td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>
                          {lead.followers >= 1000000
                            ? `${(lead.followers / 1000000).toFixed(1)}M`
                            : `${(lead.followers / 1000).toFixed(0)}K`}
                        </td>
                        <td>
                          {lead.engagementRate != null ? (
                            <span style={{ color: lead.engagementRate >= 3 ? "var(--success)" : "var(--text-secondary)" }}>
                              {lead.engagementRate}%
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>N/A</span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                            {lead.monetization || "unknown"}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <a
                              href={lead.profileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Instagram"
                            >
                              <Instagram
                                size={14}
                                style={{ color: "var(--text-muted)", cursor: "pointer" }}
                              />
                            </a>
                            {lead.youtubeChannel && (
                              <a
                                href={lead.youtubeChannel}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="YouTube"
                              >
                                <Youtube
                                  size={14}
                                  style={{ color: "#ff4444" }}
                                />
                              </a>
                            )}
                            {lead.igEmail && (
                              <a
                                href={`mailto:${lead.igEmail}`}
                                title={lead.igEmail}
                              >
                                <Mail
                                  size={14}
                                  style={{ color: "var(--accent)" }}
                                />
                              </a>
                            )}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            @{lead.brandSource}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted)",
                              maxWidth: 200,
                              display: "inline-block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={lead.reason}
                          >
                            {lead.reason}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!running && !polling && leads.length === 0 && !error && (
        <div className="section">
          <div
            className="glass-static"
            style={{
              padding: 48,
              textAlign: "center",
            }}
          >
            {mode === "quick" ? (
              <Zap
                size={32}
                style={{ color: "var(--accent)", margin: "0 auto 16px" }}
              />
            ) : (
              <Crosshair
                size={32}
                style={{ color: "var(--text-muted)", margin: "0 auto 16px" }}
              />
            )}
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: 8,
              }}
            >
              {mode === "quick" ? "Ready to scan for emails" : "Ready to find leads"}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                maxWidth: 440,
                margin: "0 auto 24px",
                lineHeight: 1.6,
              }}
            >
              {mode === "quick"
                ? "Scan brand following lists, enrich profiles, and export every account with an email in their bio. No AI scoring or YouTube lookup — just fast email extraction."
                : "This tool scrapes who major fitness brands follow on Instagram, qualifies them using engagement + AI scoring, and finds their YouTube channels. Start with a test run to verify your API keys work."}
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              {mode === "quick" ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    <Instagram size={12} />
                    Apify Scraping
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    <Users size={12} />
                    Profile Enrichment
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    <Mail size={12} />
                    Email Extraction
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    <Instagram size={12} />
                    Apify Scraping
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    <Brain size={12} />
                    Claude AI Scoring
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    <Youtube size={12} />
                    YouTube Discovery
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
