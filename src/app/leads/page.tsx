"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Mail,
  Download,
  Play,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Search,
  ExternalLink,
  X,
  Zap,
  Youtube,
  GitFork,
  Activity,
  BarChart3,
  Plus,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Lead {
  username: string;
  fullName: string;
  igEmail: string;
  ytEmail?: string;
  email?: string;
  followers: number;
  subscriberCount?: number;
  channelTitle?: string;
  channelUrl?: string;
  biography?: string;
  website?: string;
  profileUrl: string;
  brandSource: string;
  businessCategory?: string;
  isBusinessAccount?: boolean;
  source?: string;
  emailSource?: string;
}

interface ActivityLogEntry { ts: string; type: string; message: string; }

interface PollResponse {
  status: string;
  leads?: Lead[];
  emailsFound: number;
  rawEmailCount?: number;
  target: number;
  currentBrand?: string;
  currentBrandIndex?: number;
  brandsCompleted?: string[];
  brands?: string[];
  message?: string;
  error?: string;
  activityLog?: ActivityLogEntry[];
  totalScraped?: number;
  profilesWithoutEmail?: number;
  brandResults?: Record<string, { scraped: number; withEmail: number; withoutEmail: number }>;
}

interface YtPollResponse {
  status: string;
  totalProfiles: number;
  profilesProcessed: number;
  channelsFound: number;
  emailsFound: number;
  descriptionEmails?: number;
  leads?: Lead[];
  message?: string;
  error?: string;
  activityLog?: ActivityLogEntry[];
  submittedAt?: string;
  hoursElapsed?: number;
  resurrected?: boolean;
}

interface HistoryRun {
  id: string; status: string; mode: string; created_at: string;
  scraped_count: number; lead_count: number; email_count: number; config: any;
}

interface BrandStat {
  brand: string;
  scraped: number;
  igEmails: number;
  withoutEmail: number;
  ytSearched: number;
  ytChannelsFound: number;
  ytEmails: number;
  totalEmails: number;
  fullyScraped: boolean;
  lastScrapedAt: string | null;
}

interface BrandDashboardData {
  brands: BrandStat[];
  stats: {
    totalBrands: number;
    brandsScraped: number;
    brandsFullyScraped: number;
    totalProfilesScraped: number;
    totalIgEmails: number;
    totalYtEmails: number;
    totalDelivered: number;
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LeadsPage() {
  // ── Instagram scan state ──
  const [phase, setPhase] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [emailsFound, setEmailsFound] = useState(0);
  const [rawEmailCount, setRawEmailCount] = useState(0);
  const [targetEmails, setTargetEmails] = useState(100);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [currentBrand, setCurrentBrand] = useState("");
  const [currentBrandIndex, setCurrentBrandIndex] = useState(0);
  const [brandsCompleted, setBrandsCompleted] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [backendStatus, setBackendStatus] = useState<string>("pending");
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [totalScraped, setTotalScraped] = useState(0);
  const [profilesWithoutEmail, setProfilesWithoutEmail] = useState(0);

  // ── YouTube Deep Dive state ──
  const [ytPhase, setYtPhase] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [ytJobId, setYtJobId] = useState<string | null>(null);
  const [ytProfileCount, setYtProfileCount] = useState(0);
  const [ytProcessed, setYtProcessed] = useState(0);
  const [ytChannelsFound, setYtChannelsFound] = useState(0);
  const [ytEmailsFound, setYtEmailsFound] = useState(0);
  const [ytLeads, setYtLeads] = useState<Lead[]>([]);
  const [ytMessage, setYtMessage] = useState("");
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytStatus, setYtStatus] = useState<string>("pending");
  const [ytStartTime, setYtStartTime] = useState<number | null>(null);
  const [ytElapsed, setYtElapsed] = useState(0);
  const [ytSubmittedAt, setYtSubmittedAt] = useState<string | null>(null);
  const [ytHoursElapsed, setYtHoursElapsed] = useState(0);
  const [ytDescriptionEmails, setYtDescriptionEmails] = useState(0);

  // ── YouTube auto-start tracking ──
  const ytAutoStartedRef = useRef(false);

  // ── History ──
  const [showHistory, setShowHistory] = useState(false);
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  // ── Brand Dashboard ──
  const [showBrands, setShowBrands] = useState(false);
  const [brandDashboard, setBrandDashboard] = useState<BrandDashboardData | null>(null);
  const [brandDashboardLoading, setBrandDashboardLoading] = useState(false);
  const [customBrandInput, setCustomBrandInput] = useState("");
  const [customBrands, setCustomBrands] = useState<string[]>([]);

  // ── Refs ──
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ytPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Elapsed timers ──
  useEffect(() => {
    if (!startTime || phase === "idle" || phase === "complete" || phase === "error") return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startTime, phase]);

  useEffect(() => {
    if (!ytStartTime || ytPhase === "idle" || ytPhase === "complete" || ytPhase === "error") return;
    const t = setInterval(() => setYtElapsed(Math.floor((Date.now() - ytStartTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [ytStartTime, ytPhase]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (ytPollTimerRef.current) clearInterval(ytPollTimerRef.current);
    };
  }, []);

  function formatElapsed(s: number) {
    const m = Math.floor(s / 60), sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  BRAND DASHBOARD
  // ════════════════════════════════════════════════════════════════════════════

  async function fetchBrandDashboard() {
    setBrandDashboardLoading(true);
    try {
      const r = await fetch("/api/lead-gen/brands");
      const d = await r.json();
      setBrandDashboard(d);
    } catch { /* silent */ }
    finally { setBrandDashboardLoading(false); }
  }

  function addCustomBrand() {
    const brand = customBrandInput.trim().toLowerCase().replace(/^@/, "");
    if (brand && !customBrands.includes(brand)) {
      setCustomBrands([...customBrands, brand]);
    }
    setCustomBrandInput("");
  }

  function removeCustomBrand(brand: string) {
    setCustomBrands(customBrands.filter(b => b !== brand));
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  INSTAGRAM SCAN LOGIC
  // ════════════════════════════════════════════════════════════════════════════

  const pollOnce = useCallback(async (jId: string) => {
    try {
      const res = await fetch(`/api/lead-gen/poll?jobId=${jId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PollResponse = await res.json();
      setEmailsFound(data.emailsFound || 0);
      if (data.rawEmailCount !== undefined) setRawEmailCount(data.rawEmailCount);
      setBackendStatus(data.status);
      if (data.message) setStatusMessage(data.message);
      if (data.currentBrand !== undefined) setCurrentBrand(data.currentBrand);
      if (data.currentBrandIndex !== undefined) setCurrentBrandIndex(data.currentBrandIndex);
      if (data.brandsCompleted) setBrandsCompleted(data.brandsCompleted);
      if (data.brands) setBrands(data.brands);
      if (data.activityLog) setActivityLog(data.activityLog);
      if (data.totalScraped !== undefined) setTotalScraped(data.totalScraped);
      if (data.profilesWithoutEmail !== undefined) setProfilesWithoutEmail(data.profilesWithoutEmail);
      // Always update leads if available (for live download)
      if (data.leads && data.leads.length > 0) setLeads(data.leads);

      // AUTO-START YouTube when we have profiles without email
      if (
        !ytAutoStartedRef.current &&
        data.profilesWithoutEmail &&
        data.profilesWithoutEmail >= 10 &&
        (data.status === "enriching" || data.status === "pending" || data.status === "scraping")
      ) {
        ytAutoStartedRef.current = true;
        autoStartYouTube(jId);
      }

      if (data.status === "complete" || data.status === "stopped") {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        if (data.leads) { setLeads(data.leads); setEmailsFound(data.leads.length); }
        if (data.rawEmailCount !== undefined) setRawEmailCount(data.rawEmailCount);
        if (data.totalScraped) setTotalScraped(data.totalScraped);
        if (data.profilesWithoutEmail) setProfilesWithoutEmail(data.profilesWithoutEmail);
        setPhase("complete");
        fetchBrandDashboard();
      } else if (data.status === "failed") {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        setError(data.error || "Job failed"); setPhase("error");
        if (data.leads?.length) { setLeads(data.leads); setEmailsFound(data.leads.length); }
      }
    } catch { setStatusMessage("Checking status..."); }
  }, []);

  function startPolling(jId: string) {
    setJobId(jId); setPhase("running");
    pollOnce(jId);
    pollTimerRef.current = setInterval(() => pollOnce(jId), 4000);
  }

  async function runScan() {
    setPhase("running"); setLeads([]); setError(null); setEmailsFound(0); setRawEmailCount(0);
    setStatusMessage("Initializing..."); setStartTime(Date.now()); setElapsed(0);
    setCurrentBrand(""); setCurrentBrandIndex(0); setBrandsCompleted([]); setBrands([]);
    setBackendStatus("pending"); setActivityLog([]);
    setTotalScraped(0); setProfilesWithoutEmail(0);
    setYtPhase("idle"); setYtLeads([]); setYtEmailsFound(0);
    setYtProcessed(0); setYtChannelsFound(0); setYtProfileCount(0);
    ytAutoStartedRef.current = false;
    try {
      const res = await fetch("/api/lead-gen", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetEmails, customBrands }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({ error: "Unknown" })); throw new Error(d.error); }
      const data = await res.json();
      if (data.brands) setBrands(data.brands);
      if (data.jobId) startPolling(data.jobId);
      else throw new Error("No job ID returned");
    } catch (err: any) { setError(err.message); setPhase("error"); }
  }

  async function stopScan() {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    if (!jobId) { setPhase("idle"); return; }
    setStatusMessage("Saving progress...");
    try {
      const res = await fetch("/api/lead-gen/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (data.leads?.length > 0) {
        setLeads(data.leads);
        setEmailsFound(data.leads.length);
        if (data.totalScraped) setTotalScraped(data.totalScraped);
        if (data.profilesWithoutEmail) setProfilesWithoutEmail(data.profilesWithoutEmail);
        if (data.brandsCompleted) setBrandsCompleted(data.brandsCompleted);
        setPhase("complete");
      } else {
        setLeads([]);
        setEmailsFound(0);
        setPhase("complete");
      }
      fetchBrandDashboard();
    } catch {
      setPhase("idle");
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  YOUTUBE DEEP DIVE LOGIC (auto-started from IG poll)
  // ════════════════════════════════════════════════════════════════════════════

  const ytPollOnce = useCallback(async (jId: string) => {
    try {
      const res = await fetch(`/api/lead-gen/youtube/poll?jobId=${jId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: YtPollResponse = await res.json();
      setYtProcessed(data.profilesProcessed || 0);
      setYtChannelsFound(data.channelsFound || 0);
      setYtEmailsFound(data.emailsFound || 0);
      setYtStatus(data.status);
      if (data.totalProfiles) setYtProfileCount(data.totalProfiles);
      if (data.message) setYtMessage(data.message);
      if (data.submittedAt) setYtSubmittedAt(data.submittedAt);
      if (data.hoursElapsed !== undefined) setYtHoursElapsed(data.hoursElapsed);
      if (data.descriptionEmails !== undefined) setYtDescriptionEmails(data.descriptionEmails);

      // Slow down polling when in yt_processing (checking every 60s instead of 5s)
      if (data.status === "yt_processing" || data.status === "yt_scraping") {
        if (ytPollTimerRef.current) clearInterval(ytPollTimerRef.current);
        ytPollTimerRef.current = setInterval(() => ytPollOnce(jId), 60000);
      }

      if (data.status === "complete" || data.status === "stopped") {
        if (ytPollTimerRef.current) clearInterval(ytPollTimerRef.current);
        ytPollTimerRef.current = null;
        if (data.leads) { setYtLeads(data.leads); setYtEmailsFound(data.leads.length); }
        setYtPhase("complete");
        fetchBrandDashboard();
      } else if (data.status === "failed") {
        if (ytPollTimerRef.current) clearInterval(ytPollTimerRef.current);
        ytPollTimerRef.current = null;
        setYtError(data.error || "Failed"); setYtPhase("error");
        if (data.leads?.length) { setYtLeads(data.leads); setYtEmailsFound(data.leads.length); }
      }
    } catch { setYtMessage("Checking YouTube status..."); }
  }, []);

  async function autoStartYouTube(sourceJobId: string) {
    setYtPhase("running"); setYtLeads([]); setYtError(null); setYtEmailsFound(0);
    setYtProcessed(0); setYtChannelsFound(0); setYtMessage("YouTube fork starting...");
    setYtStartTime(Date.now()); setYtElapsed(0); setYtStatus("pending");
    try {
      const res = await fetch("/api/lead-gen/youtube", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceJobId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Unknown" }));
        throw new Error(d.error);
      }
      const data = await res.json();
      setYtProfileCount(data.profileCount || 0);
      if (data.jobId) {
        setYtJobId(data.jobId);
        ytPollOnce(data.jobId);
        ytPollTimerRef.current = setInterval(() => ytPollOnce(data.jobId), 5000);
      }
    } catch (err: any) { setYtError(err.message); setYtPhase("error"); }
  }

  async function startYouTubeManual() {
    if (!jobId) return;
    ytAutoStartedRef.current = true;
    autoStartYouTube(jobId);
  }

  // ── Resume active jobs on page load (survives browser close) ──
  useEffect(() => {
    async function checkActiveJobs() {
      try {
        const res = await fetch("/api/lead-gen/active");
        if (!res.ok) return;
        const data = await res.json();

        if (data.igJob && data.igJob.id) {
          setJobId(data.igJob.id);
          setPhase("running");
          setStartTime(Date.now());
          setBackendStatus(data.igJob.status);
          setStatusMessage("Resuming scan...");
          pollOnce(data.igJob.id);
          pollTimerRef.current = setInterval(() => pollOnce(data.igJob.id), 4000);
        }

        if (data.ytJob && data.ytJob.id) {
          setYtJobId(data.ytJob.id);
          setYtPhase("running");
          setYtStartTime(Date.now());
          setYtStatus(data.ytJob.status);
          ytAutoStartedRef.current = true;
          if (data.ytJob.submittedAt) setYtSubmittedAt(data.ytJob.submittedAt);
          const interval = (data.ytJob.status === "yt_processing" || data.ytJob.status === "yt_scraping") ? 60000 : 5000;
          setYtMessage("Resuming YouTube search...");
          ytPollOnce(data.ytJob.id);
          ytPollTimerRef.current = setInterval(() => ytPollOnce(data.ytJob.id), interval);
        }
      } catch { /* silent */ }
    }
    checkActiveJobs();
  }, [pollOnce, ytPollOnce]);

  // ════════════════════════════════════════════════════════════════════════════
  //  CSV EXPORT
  // ════════════════════════════════════════════════════════════════════════════

  function downloadCSV(data: Lead[], label: string) {
    if (data.length === 0) return;
    const esc = (v: any) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const isYt = label.includes("youtube");
    const headers = isYt
      ? ["username", "full_name", "email", "email_source", "ig_followers", "yt_subscribers", "yt_channel", "yt_channel_url", "ig_profile", "brand_source"]
      : ["username", "full_name", "email", "followers", "biography", "website", "profile_url", "brand_source"];
    const rows = data.map((l) =>
      isYt
        ? [l.username, l.fullName, l.email || l.ytEmail || "", l.emailSource || "youtube_description", l.followers, l.subscriberCount || "", l.channelTitle || "", l.channelUrl || "", l.profileUrl, l.brandSource]
        : [l.username, l.fullName, l.igEmail || l.email || "", l.followers, l.biography || "", l.website || "", l.profileUrl, l.brandSource]
    );
    const csv = [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `${label}_${data.length}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  // ── History ──
  async function fetchHistory() {
    setHistoryLoading(true);
    try { const r = await fetch("/api/lead-gen/history"); const d = await r.json(); setHistoryRuns(d.runs || []); }
    catch { setHistoryRuns([]); } finally { setHistoryLoading(false); }
  }
  async function downloadHistoryCSV(hId: string) {
    setDownloadingJobId(hId);
    try {
      const r = await fetch(`/api/lead-gen/history/${hId}`); const { job } = await r.json();
      if (!job?.results?.length) { alert("No results."); return; }
      const isYt = job.mode === "youtube";
      downloadCSV(job.results, isYt ? "youtube_leads" : "ig_leads");
    } catch (e: any) { alert(e.message); } finally { setDownloadingJobId(null); }
  }

  const filteredLeads = searchFilter
    ? leads.filter((l) => l.username?.toLowerCase().includes(searchFilter.toLowerCase()) || l.fullName?.toLowerCase().includes(searchFilter.toLowerCase()) || (l.igEmail || "").toLowerCase().includes(searchFilter.toLowerCase()))
    : leads;

  const isRunning = phase === "running";
  const progressPct = targetEmails > 0 ? Math.min(100, Math.round((emailsFound / targetEmails) * 100)) : 0;
  const emailsInBios = rawEmailCount || Math.max(0, totalScraped - profilesWithoutEmail);
  const noEmailCount = profilesWithoutEmail || Math.max(0, totalScraped - emailsInBios);
  const ytProgressPct = ytProfileCount > 0 ? Math.round((ytProcessed / ytProfileCount) * 100) : 0;
  const isAnyRunning = isRunning || ytPhase === "running";

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Zap size={28} style={{ color: "#c9a96e" }} /> Lead Machine
          </h1>
          <p style={{ color: "#666", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            Scrape fitness brand followers for emails — IG bios + YouTube channels
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => { setShowBrands(!showBrands); if (!showBrands && !brandDashboard) fetchBrandDashboard(); }}
            style={{
              background: showBrands ? "rgba(201,169,110,0.12)" : "rgba(255,255,255,0.04)",
              border: showBrands ? "1px solid rgba(201,169,110,0.25)" : "1px solid rgba(255,255,255,0.08)",
              color: showBrands ? "#c9a96e" : "#777", padding: "0.5rem 1rem", borderRadius: "0.5rem",
              cursor: "pointer", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.375rem",
            }}
          >
            <BarChart3 size={14} /> Brands
          </button>
          <button onClick={() => { setShowHistory(!showHistory); if (!showHistory) fetchHistory(); }}
            style={{
              background: showHistory ? "rgba(201,169,110,0.12)" : "rgba(255,255,255,0.04)",
              border: showHistory ? "1px solid rgba(201,169,110,0.25)" : "1px solid rgba(255,255,255,0.08)",
              color: showHistory ? "#c9a96e" : "#777", padding: "0.5rem 1rem", borderRadius: "0.5rem",
              cursor: "pointer", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.375rem",
            }}
          >
            <Clock size={14} /> History
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          BRAND DASHBOARD (toggled by button)
         ══════════════════════════════════════════════════════════════════════ */}
      {showBrands && (
        <div style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "1rem", padding: "1.5rem", marginBottom: "1.5rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <BarChart3 size={16} style={{ color: "#c9a96e" }} />
              <h3 style={{ color: "#fff", fontSize: "0.9375rem", fontWeight: 600, margin: 0 }}>Brand Coverage</h3>
            </div>
            <button onClick={fetchBrandDashboard} style={{
              background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "0.6875rem",
              display: "flex", alignItems: "center", gap: "0.25rem",
            }}>
              {brandDashboardLoading ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> : <Activity size={10} />}
              Refresh
            </button>
          </div>

          {/* Add custom brand */}
          <div style={{ display: "flex", gap: "0.375rem", marginBottom: "1rem" }}>
            <input
              type="text"
              value={customBrandInput}
              onChange={(e) => setCustomBrandInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomBrand()}
              placeholder="Add Instagram account to scrape..."
              style={{
                flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "0.375rem", padding: "0.5rem 0.75rem", color: "#ccc", fontSize: "0.8125rem", outline: "none",
              }}
            />
            <button onClick={addCustomBrand} style={{
              background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.2)",
              color: "#c9a96e", padding: "0.5rem 0.75rem", borderRadius: "0.375rem", cursor: "pointer",
              fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem",
            }}>
              <Plus size={12} /> Add
            </button>
          </div>

          {customBrands.length > 0 && (
            <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              {customBrands.map(b => (
                <span key={b} style={{
                  background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.15)",
                  color: "#c9a96e", padding: "0.25rem 0.5rem", borderRadius: "0.25rem", fontSize: "0.6875rem",
                  display: "flex", alignItems: "center", gap: "0.25rem",
                }}>
                  @{b}
                  <button onClick={() => removeCustomBrand(b)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", padding: 0, lineHeight: 1 }}><X size={10} /></button>
                </span>
              ))}
            </div>
          )}

          {brandDashboardLoading && !brandDashboard && (
            <div style={{ textAlign: "center", padding: "1rem", color: "#555" }}>
              <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            </div>
          )}

          {brandDashboard && (
            <>
              {/* Summary stats */}
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                <StatBox label="Profiles Scraped" value={brandDashboard.stats.totalProfilesScraped.toLocaleString()} color="#888" />
                <StatBox label="IG Emails" value={brandDashboard.stats.totalIgEmails} color="#c9a96e" />
                <StatBox label="YT Emails" value={brandDashboard.stats.totalYtEmails} color="#ff4444" />
                <StatBox label="Total Delivered" value={brandDashboard.stats.totalDelivered} color="#22c55e" />
              </div>

              {/* Brand table */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", color: "#666", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Brand</th>
                      <th style={{ textAlign: "right", padding: "0.5rem 0.75rem", color: "#666", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Followers Scraped</th>
                      <th style={{ textAlign: "right", padding: "0.5rem 0.75rem", color: "#666", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Bio Emails</th>
                      <th style={{ textAlign: "right", padding: "0.5rem 0.75rem", color: "#666", fontWeight: 500, fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>YT Emails</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brandDashboard.brands.map((b) => (
                      <tr key={b.brand} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                        <td style={{ padding: "0.5rem 0.75rem", color: b.scraped > 0 ? "#bbb" : "#444" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                            @{b.brand}
                            {b.fullyScraped && <CheckCircle size={10} style={{ color: "rgba(34,197,94,0.6)" }} />}
                          </span>
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", color: b.scraped > 0 ? "#999" : "#333", fontVariantNumeric: "tabular-nums" }}>
                          {b.scraped > 0 ? b.scraped.toLocaleString() : "—"}
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", color: b.igEmails > 0 ? "#c9a96e" : "#333", fontVariantNumeric: "tabular-nums" }}>
                          {b.igEmails > 0 ? b.igEmails : "—"}
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", color: b.ytEmails > 0 ? "#ff4444" : "#333", fontVariantNumeric: "tabular-nums" }}>
                          {b.ytEmails > 0 ? b.ytEmails : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          IDLE STATE — Start scan
         ══════════════════════════════════════════════════════════════════════ */}
      {phase === "idle" && (
        <div style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "1rem", padding: "2.5rem", marginBottom: "1.5rem", textAlign: "center",
        }}>
          <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "rgba(201,169,110,0.08)", border: "2px solid rgba(201,169,110,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem" }}>
            <Mail size={28} style={{ color: "#c9a96e" }} />
          </div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#fff", margin: "0 0 0.5rem" }}>Get {targetEmails} New Emails</h2>
          <p style={{ color: "#666", fontSize: "0.875rem", maxWidth: "560px", margin: "0 auto", lineHeight: 1.6 }}>
            Scrapes followers from fitness brands, extracts emails from
            <span style={{ color: "#c9a96e" }}> Instagram bios</span>, then searches
            <span style={{ color: "#ff4444" }}> YouTube</span> for profiles without emails.
          </p>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", margin: "1.25rem 0" }}>
            <span style={{ color: "#666", fontSize: "0.8125rem" }}>Target:</span>
            {[50, 100, 200].map((n) => (
              <button key={n} onClick={() => setTargetEmails(n)} style={{
                padding: "0.375rem 0.75rem", borderRadius: "0.375rem", fontSize: "0.8125rem", fontWeight: 500, cursor: "pointer",
                border: targetEmails === n ? "1px solid rgba(201,169,110,0.4)" : "1px solid rgba(255,255,255,0.08)",
                background: targetEmails === n ? "rgba(201,169,110,0.1)" : "rgba(255,255,255,0.03)",
                color: targetEmails === n ? "#c9a96e" : "#777",
              }}>{n}</button>
            ))}
          </div>
          <button onClick={runScan} style={{
            background: "linear-gradient(135deg, #c9a96e 0%, #b08d4f 100%)", color: "#000", border: "none",
            padding: "0.875rem 2.5rem", borderRadius: "0.625rem", fontSize: "1rem", fontWeight: 600, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: "0.5rem", boxShadow: "0 4px 24px rgba(201,169,110,0.25)",
          }}><Play size={18} /> Start Scan</button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          RUNNING STATE
         ══════════════════════════════════════════════════════════════════════ */}
      {isAnyRunning && (
        <div style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "1rem", padding: "1.75rem", marginBottom: "1.5rem",
        }}>
          {/* Top bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#c9a96e", animation: "nodePulse 2s ease-in-out infinite", boxShadow: "0 0 6px rgba(201,169,110,0.4)" }} />
              <span style={{ color: "#aaa", fontSize: "0.875rem", fontWeight: 600 }}>
                {currentBrand ? `@${currentBrand}` : "Initializing"}
              </span>
              <span style={{ color: "#555", fontSize: "0.75rem" }}>{formatElapsed(elapsed)}</span>
              {brandsCompleted.length > 0 && (
                <span style={{ fontSize: "0.625rem", color: "#555", background: "rgba(255,255,255,0.04)", padding: "0.125rem 0.5rem", borderRadius: "0.25rem" }}>
                  {brandsCompleted.length}/{brands.length} brands
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {/* Download now button (during running) */}
              {leads.length > 0 && (
                <button onClick={() => downloadCSV(leads, "ig_leads")} style={{
                  background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.2)",
                  color: "#c9a96e", padding: "0.375rem 0.75rem", borderRadius: "0.375rem", cursor: "pointer",
                  fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem",
                }}>
                  <Download size={11} /> CSV ({leads.length})
                </button>
              )}
              <button onClick={stopScan} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#666", padding: "0.375rem 0.75rem", borderRadius: "0.375rem", cursor: "pointer", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <X size={11} /> Stop
              </button>
            </div>
          </div>

          {/* Fork visualization */}
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1.25rem" }}>
            {/* LEFT FORK: Bio Email Extraction */}
            <div style={{
              flex: 1, background: "rgba(201,169,110,0.03)", border: "1px solid rgba(201,169,110,0.1)",
              borderRadius: "0.75rem", padding: "1.25rem", position: "relative",
            }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: "linear-gradient(90deg, #c9a96e, transparent)", borderRadius: "0.75rem 0.75rem 0 0" }} />
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                <Mail size={14} style={{ color: "#c9a96e" }} />
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#c9a96e", textTransform: "uppercase", letterSpacing: "0.05em" }}>Bio Emails</span>
              </div>

              {/* Primary number: emails found in bios */}
              <div style={{ textAlign: "center", marginBottom: "0.75rem" }}>
                <div style={{ fontSize: "2.5rem", fontWeight: 700, color: "#c9a96e", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {emailsFound}<span style={{ fontSize: "1rem", color: "#555", fontWeight: 400 }}>/{targetEmails}</span>
                </div>
                <div style={{ color: "#888", fontSize: "0.6875rem", marginTop: "0.25rem" }}>new unique emails</div>
                {rawEmailCount > 0 && rawEmailCount !== emailsFound && (
                  <div style={{ color: "#555", fontSize: "0.5625rem", marginTop: "0.125rem" }}>
                    {rawEmailCount} found in bios ({rawEmailCount - emailsFound} already delivered)
                  </div>
                )}
              </div>

              {/* Progress bar */}
              <div style={{ height: "3px", background: "rgba(255,255,255,0.04)", borderRadius: "2px", overflow: "hidden", marginBottom: "0.75rem" }}>
                <div style={{ height: "100%", background: "linear-gradient(90deg, #c9a96e, #dbb978)", borderRadius: "2px", width: `${progressPct}%`, transition: "width 0.6s ease" }} />
              </div>

              {/* Pipeline steps */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "center" }}>
                {(["scraping", "enriching"] as const).map((stage) => {
                  const isActive = backendStatus === stage && phase === "running";
                  const isDone = phase === "complete";
                  return (
                    <div key={stage} style={{
                      display: "flex", alignItems: "center", gap: "0.25rem",
                      fontSize: "0.625rem", color: isDone ? "#22c55e" : isActive ? "#c9a96e" : "#444",
                    }}>
                      {isDone ? <CheckCircle size={9} /> : isActive ? <Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} /> : <div style={{ width: 9, height: 9, borderRadius: "50%", border: "1px solid #333" }} />}
                      {stage === "scraping" ? "Scrape" : "Enrich"}
                    </div>
                  );
                })}
              </div>

              {/* Stats */}
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem", justifyContent: "center", fontSize: "0.625rem", color: "#555" }}>
                <span>{totalScraped} profiles</span>
                <span>{emailsInBios} with email</span>
                <span>{noEmailCount} no email</span>
              </div>
            </div>

            {/* CENTER: Fork indicator */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "40px", flexShrink: 0 }}>
              <GitFork size={20} style={{ color: "#444", transform: "rotate(180deg)" }} />
              <div style={{ fontSize: "0.5rem", color: "#333", marginTop: "0.25rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>Fork</div>
            </div>

            {/* RIGHT FORK: YouTube Channel Search */}
            <div style={{
              flex: 1, background: ytPhase !== "idle" ? "rgba(255,0,0,0.02)" : "rgba(255,255,255,0.01)",
              border: `1px solid ${ytPhase !== "idle" ? "rgba(255,0,0,0.08)" : "rgba(255,255,255,0.04)"}`,
              borderRadius: "0.75rem", padding: "1.25rem", position: "relative",
            }}>
              {ytPhase !== "idle" && (
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: "linear-gradient(90deg, #ff4444, transparent)", borderRadius: "0.75rem 0.75rem 0 0" }} />
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                <Youtube size={14} style={{ color: ytPhase !== "idle" ? "#ff4444" : "#333" }} />
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: ytPhase !== "idle" ? "#ff4444" : "#444", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  YouTube
                </span>
                {ytPhase === "running" && <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ff4444", animation: "nodePulse 2s ease-in-out infinite" }} />}
              </div>

              {ytPhase === "idle" && (
                <div style={{ textAlign: "center", padding: "1rem 0" }}>
                  <div style={{ fontSize: "0.75rem", color: "#444", lineHeight: 1.6 }}>
                    Waiting for no-email profiles...
                  </div>
                  <div style={{ fontSize: "0.625rem", color: "#333", marginTop: "0.5rem" }}>
                    Auto-starts when 10+ profiles have no bio email
                  </div>
                </div>
              )}

              {ytPhase === "running" && (ytStatus === "yt_processing" || ytStatus === "yt_scraping") && (
                <>
                  <div style={{ textAlign: "center", marginBottom: "0.75rem" }}>
                    <Loader2 size={20} style={{ color: "#ff4444", margin: "0 auto 0.5rem", animation: "spin 3s linear infinite" }} />
                    <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#ff4444", lineHeight: 1.3 }}>
                      {ytStatus === "yt_scraping" ? "Submitting channels..." : "Extracting business emails"}
                    </div>
                    <div style={{ fontSize: "0.625rem", color: "#555", marginTop: "0.375rem", lineHeight: 1.5 }}>
                      {ytStatus === "yt_processing"
                        ? `Google accounts solving reCAPTCHA... ${ytHoursElapsed > 0 ? `${ytHoursElapsed}h elapsed` : "just started"}`
                        : "Submitting to reCAPTCHA solver..."}
                    </div>
                  </div>
                  {ytDescriptionEmails > 0 && (
                    <div style={{ fontSize: "0.5625rem", color: "#666", textAlign: "center", marginBottom: "0.5rem" }}>
                      {ytDescriptionEmails} description emails found during channel search
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.625rem", color: "#555", alignItems: "center" }}>
                    <span>{ytChannelsFound} channels submitted</span>
                    <span style={{ color: "#888" }}>~3-48 hours processing time</span>
                  </div>
                  <div style={{
                    marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "rgba(34,197,94,0.04)",
                    border: "1px solid rgba(34,197,94,0.1)", borderRadius: "0.375rem", textAlign: "center",
                  }}>
                    <span style={{ fontSize: "0.625rem", color: "#22c55e" }}>
                      ✓ Safe to close your browser — this runs on our servers
                    </span>
                  </div>
                  {ytStatus === "yt_processing" && (
                    <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
                      <button
                        onClick={() => { if (ytJobId) ytPollOnce(ytJobId); }}
                        style={{ fontSize: "0.5625rem", color: "#c9a96e", background: "none", border: "1px solid rgba(201,169,110,0.2)", borderRadius: "0.25rem", padding: "0.25rem 0.5rem", cursor: "pointer" }}
                      >
                        Check Now
                      </button>
                    </div>
                  )}
                </>
              )}

              {ytPhase === "running" && ytStatus !== "yt_processing" && ytStatus !== "yt_scraping" && (
                <>
                  <div style={{ textAlign: "center", marginBottom: "0.75rem" }}>
                    <div style={{ fontSize: "2.5rem", fontWeight: 700, color: "#ff4444", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                      {ytEmailsFound}
                    </div>
                    <div style={{ color: "#888", fontSize: "0.6875rem", marginTop: "0.25rem" }}>description emails found</div>
                  </div>
                  <div style={{ height: "3px", background: "rgba(255,255,255,0.04)", borderRadius: "2px", overflow: "hidden", marginBottom: "0.75rem" }}>
                    <div style={{ height: "100%", background: "linear-gradient(90deg, #ff4444, #ff6666)", borderRadius: "2px", width: `${ytProgressPct}%`, transition: "width 0.6s ease" }} />
                  </div>
                  {/* YouTube pipeline breakdown */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.625rem", color: "#555", alignItems: "center" }}>
                    <span>{ytProcessed}/{ytProfileCount} profiles searched</span>
                    <span>{ytChannelsFound} channels found</span>
                    <span style={{ color: "#ff4444" }}>{ytEmailsFound} emails from descriptions</span>
                  </div>
                  <div style={{ fontSize: "0.5625rem", color: "#444", textAlign: "center", marginTop: "0.5rem" }}>
                    {formatElapsed(ytElapsed)}
                  </div>
                </>
              )}

              {ytPhase === "complete" && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "2rem", fontWeight: 700, color: "#22c55e", lineHeight: 1 }}>{ytLeads.length}</div>
                  <div style={{ color: "#888", fontSize: "0.6875rem", marginTop: "0.25rem" }}>YT emails found</div>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "0.375rem", fontSize: "0.5625rem" }}>
                    <span style={{ color: "#ff4444" }}>{ytLeads.filter(l => l.emailSource === "youtube_recaptcha").length} reCAPTCHA</span>
                    <span style={{ color: "#c9a96e" }}>{ytLeads.filter(l => l.emailSource !== "youtube_recaptcha").length} description</span>
                  </div>
                  <div style={{ fontSize: "0.5625rem", color: "#555", marginTop: "0.25rem" }}>
                    {ytChannelsFound} channels found · {ytProcessed} searched
                  </div>
                </div>
              )}

              {ytPhase === "error" && (
                <div style={{ textAlign: "center" }}>
                  <AlertCircle size={16} style={{ color: "#ef4444", margin: "0 auto 0.25rem" }} />
                  <div style={{ fontSize: "0.6875rem", color: "#888" }}>{ytError}</div>
                  {ytLeads.length > 0 && <div style={{ fontSize: "0.625rem", color: "#c9a96e", marginTop: "0.25rem" }}>{ytLeads.length} emails found</div>}
                </div>
              )}
            </div>
          </div>

          {/* Activity log */}
          <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: "0.5rem", padding: "0.75rem 1rem", maxHeight: "120px", overflow: "auto" }}>
            <div style={{ fontSize: "0.5625rem", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>Activity</div>
            {activityLog.slice(-8).reverse().map((log, i) => (
              <div key={i} style={{ fontSize: "0.6875rem", color: log.type.includes("error") || log.type.includes("fail") ? "#ef4444" : log.type.includes("done") || log.type.includes("complete") ? "#22c55e" : "#666", marginBottom: "0.25rem", lineHeight: 1.4 }}>
                {log.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          COMPLETE STATE — Results
         ══════════════════════════════════════════════════════════════════════ */}
      {phase === "complete" && !isRunning && (
        <div style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "1rem", padding: "2rem", marginBottom: "1.5rem",
        }}>
          {/* Summary */}
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "rgba(34,197,94,0.08)", border: "2px solid rgba(34,197,94,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 0.75rem" }}>
              <CheckCircle size={24} style={{ color: "#22c55e" }} />
            </div>
            <h3 style={{ color: "#fff", fontSize: "1.125rem", fontWeight: 600, margin: "0 0 0.25rem" }}>
              Scan Complete
            </h3>
            <p style={{ color: "#666", fontSize: "0.8125rem" }}>
              {formatElapsed(elapsed)} · {brandsCompleted.length} brands · {totalScraped} profiles checked
            </p>
          </div>

          {/* Stats row */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap", justifyContent: "center" }}>
            <StatBox label="Profiles" value={totalScraped} color="#888" />
            <StatBox label="Had Email in Bio" value={emailsInBios} color="#c9a96e" />
            <StatBox label="No Bio Email" value={noEmailCount} color="#555" />
            <StatBox label="New Unique" value={emailsFound} color="#22c55e" sub={rawEmailCount > emailsFound ? `${rawEmailCount - emailsFound} already delivered` : undefined} />
          </div>

          {/* Download cards */}
          <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
            {/* IG CSV */}
            <div style={{
              flex: "1 1 300px", background: "rgba(201,169,110,0.03)", border: "1px solid rgba(201,169,110,0.1)",
              borderRadius: "0.75rem", padding: "1.25rem", textAlign: "center",
            }}>
              <Mail size={18} style={{ color: "#c9a96e", margin: "0 auto 0.5rem" }} />
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "#c9a96e" }}>{leads.length}</div>
              <div style={{ color: "#888", fontSize: "0.75rem", marginBottom: "0.75rem" }}>Instagram Bio Emails</div>
              <button onClick={() => downloadCSV(leads, "ig_leads")} disabled={leads.length === 0} style={{
                background: leads.length > 0 ? "linear-gradient(135deg, #c9a96e 0%, #b08d4f 100%)" : "rgba(255,255,255,0.04)",
                color: leads.length > 0 ? "#000" : "#555", border: "none",
                padding: "0.5rem 1.25rem", borderRadius: "0.375rem", fontSize: "0.8125rem", fontWeight: 600,
                cursor: leads.length > 0 ? "pointer" : "default",
                display: "inline-flex", alignItems: "center", gap: "0.375rem",
              }}>
                <Download size={14} /> IG CSV ({leads.length})
              </button>
            </div>

            {/* YT CSV */}
            <div style={{
              flex: "1 1 300px",
              background: ytPhase === "complete" ? "rgba(255,0,0,0.02)" : "rgba(255,255,255,0.01)",
              border: `1px solid ${ytPhase === "complete" ? "rgba(255,0,0,0.08)" : "rgba(255,255,255,0.04)"}`,
              borderRadius: "0.75rem", padding: "1.25rem", textAlign: "center",
            }}>
              <Youtube size={18} style={{ color: ytPhase === "complete" ? "#ff4444" : "#444", margin: "0 auto 0.5rem" }} />
              <div style={{ fontSize: "2rem", fontWeight: 700, color: ytPhase === "complete" ? "#ff4444" : "#555" }}>
                {ytPhase === "complete" ? ytLeads.length : ytPhase === "running" ? ytEmailsFound : "—"}
              </div>
              <div style={{ color: "#888", fontSize: "0.75rem", marginBottom: "0.75rem" }}>YouTube Emails</div>

              {ytPhase === "complete" && ytLeads.length > 0 && (
                <>
                  <div style={{ fontSize: "0.625rem", color: "#555", marginBottom: "0.25rem" }}>
                    {ytChannelsFound} channels · {ytProcessed} profiles searched
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginBottom: "0.5rem", fontSize: "0.5625rem" }}>
                    <span style={{ color: "#ff4444" }}>{ytLeads.filter(l => l.emailSource === "youtube_recaptcha").length} reCAPTCHA</span>
                    <span style={{ color: "#c9a96e" }}>{ytLeads.filter(l => l.emailSource !== "youtube_recaptcha").length} description</span>
                  </div>
                  <button onClick={() => downloadCSV(ytLeads, "youtube_leads")} style={{
                    background: "linear-gradient(135deg, #ff4444 0%, #cc0000 100%)", color: "#fff", border: "none",
                    padding: "0.5rem 1.25rem", borderRadius: "0.375rem", fontSize: "0.8125rem", fontWeight: 600,
                    cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "0.375rem",
                  }}>
                    <Download size={14} /> YT CSV ({ytLeads.length})
                  </button>
                </>
              )}
              {ytPhase === "running" && (
                <div style={{ fontSize: "0.6875rem", color: "#888" }}>
                  <Loader2 size={12} style={{ animation: "spin 1s linear infinite", display: "inline" }} /> Searching... {ytProcessed}/{ytProfileCount} profiles · {ytChannelsFound} channels
                </div>
              )}
              {ytPhase === "idle" && noEmailCount > 0 && (
                <button onClick={startYouTubeManual} style={{
                  background: "rgba(255,0,0,0.06)", border: "1px solid rgba(255,0,0,0.15)",
                  color: "#ff4444", padding: "0.5rem 1.25rem", borderRadius: "0.375rem", fontSize: "0.8125rem",
                  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "0.375rem",
                }}>
                  <Youtube size={14} /> Search {noEmailCount} profiles
                </button>
              )}
              {ytPhase === "error" && (
                <button onClick={startYouTubeManual} style={btnSecondary}>Retry YouTube</button>
              )}
            </div>
          </div>

          {/* New Scan button */}
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <button onClick={() => { setPhase("idle"); setLeads([]); setEmailsFound(0); setRawEmailCount(0); setActivityLog([]); setBrandsCompleted([]); setYtPhase("idle"); setYtLeads([]); ytAutoStartedRef.current = false; }} style={btnSecondary}>
              <Play size={14} /> New Scan
            </button>
          </div>

          {/* Search + Table */}
          {leads.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", marginBottom: "1rem" }}>
                <Search size={14} style={{ color: "#555" }} />
                <input type="text" placeholder="Search leads..." value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)}
                  style={{ background: "transparent", border: "none", color: "#ccc", fontSize: "0.8125rem", outline: "none", width: "100%" }} />
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <th style={thStyle}>#</th><th style={thStyle}>Username</th><th style={thStyle}>Name</th>
                      <th style={thStyle}>Email</th><th style={{ ...thStyle, textAlign: "right" }}>Followers</th><th style={thStyle}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.slice(0, 200).map((l, i) => (
                      <tr key={l.username + i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                        <td style={{ ...tdStyle, color: "#444" }}>{i + 1}</td>
                        <td style={tdStyle}><a href={l.profileUrl || `https://instagram.com/${l.username}`} target="_blank" rel="noopener noreferrer" style={{ color: "#c9a96e", textDecoration: "none", display: "flex", alignItems: "center", gap: "0.25rem" }}>@{l.username} <ExternalLink size={10} /></a></td>
                        <td style={{ ...tdStyle, color: "#999" }}>{l.fullName}</td>
                        <td style={tdStyle}><span style={{ color: "#22c55e", fontFamily: "monospace", fontSize: "0.75rem" }}>{l.igEmail}</span></td>
                        <td style={{ ...tdStyle, textAlign: "right", color: "#999" }}>{l.followers ? l.followers.toLocaleString() : "—"}</td>
                        <td style={{ ...tdStyle, color: "#555" }}>@{l.brandSource}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* YouTube results table */}
          {ytLeads.length > 0 && (
            <div style={{ marginTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1.5rem" }}>
              <h4 style={{ color: "#ff4444", fontSize: "0.875rem", fontWeight: 600, margin: "0 0 1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Youtube size={16} /> YouTube Emails
              </h4>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <th style={thStyle}>#</th><th style={thStyle}>Instagram</th><th style={thStyle}>YouTube Channel</th>
                      <th style={thStyle}>Email</th><th style={thStyle}>Source</th><th style={{ ...thStyle, textAlign: "right" }}>Subscribers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ytLeads.slice(0, 200).map((l, i) => (
                      <tr key={(l.username || "") + i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                        <td style={{ ...tdStyle, color: "#444" }}>{i + 1}</td>
                        <td style={tdStyle}><a href={`https://instagram.com/${l.username}`} target="_blank" rel="noopener noreferrer" style={{ color: "#c9a96e", textDecoration: "none" }}>@{l.username}</a></td>
                        <td style={tdStyle}>
                          {l.channelUrl ? (
                            <a href={l.channelUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#ff4444", textDecoration: "none", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                              {l.channelTitle || "Channel"} <ExternalLink size={10} />
                            </a>
                          ) : <span style={{ color: "#555" }}>{l.channelTitle || "—"}</span>}
                        </td>
                        <td style={tdStyle}><span style={{ color: "#22c55e", fontFamily: "monospace", fontSize: "0.75rem" }}>{l.email || l.ytEmail || ""}</span></td>
                        <td style={tdStyle}>
                          <span style={{
                            fontSize: "0.5625rem", padding: "0.125rem 0.375rem", borderRadius: "0.25rem",
                            background: l.emailSource === "youtube_recaptcha" ? "rgba(255,0,0,0.08)" : "rgba(201,169,110,0.08)",
                            color: l.emailSource === "youtube_recaptcha" ? "#ff4444" : "#c9a96e",
                          }}>
                            {l.emailSource === "youtube_recaptcha" ? "reCAPTCHA" : "Description"}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", color: "#999" }}>{l.subscriberCount ? l.subscriberCount.toLocaleString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ERROR STATE */}
      {phase === "error" && (
        <div style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "1rem", padding: "2rem", marginBottom: "1.5rem", textAlign: "center",
        }}>
          <AlertCircle size={32} style={{ color: "#ef4444", margin: "0 auto 0.75rem" }} />
          <h3 style={{ color: "#ef4444", fontSize: "1rem", fontWeight: 600, margin: "0 0 0.5rem" }}>Scan Failed</h3>
          <p style={{ color: "#888", fontSize: "0.875rem", margin: "0 0 1rem" }}>{error}</p>
          {leads.length > 0 && <p style={{ color: "#c9a96e", fontSize: "0.8125rem", margin: "0 0 1rem" }}>{leads.length} emails found before error.</p>}
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            {leads.length > 0 && <button onClick={() => downloadCSV(leads, "ig_leads")} style={btnSecondary}><Download size={14} /> Download {leads.length}</button>}
            <button onClick={() => { setPhase("idle"); setError(null); }} style={btnSecondary}>Try Again</button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          HISTORY PANEL
         ══════════════════════════════════════════════════════════════════════ */}
      {showHistory && (
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "1rem", padding: "1.5rem" }}>
          <h3 style={{ color: "#fff", fontSize: "1rem", fontWeight: 600, margin: "0 0 1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Clock size={16} style={{ color: "#c9a96e" }} /> Past Runs
          </h3>
          {historyLoading && <div style={{ textAlign: "center", padding: "1rem", color: "#666" }}><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Loading...</div>}
          {!historyLoading && historyRuns.length === 0 && <p style={{ color: "#555", fontSize: "0.8125rem", textAlign: "center" }}>No past runs yet.</p>}
          {!historyLoading && historyRuns.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {historyRuns.map((run) => (
                <div key={run.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0.75rem 1rem", background: "rgba(255,255,255,0.015)",
                  border: "1px solid rgba(255,255,255,0.05)", borderRadius: "0.5rem", fontSize: "0.8125rem",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    {run.mode === "youtube" ? <Youtube size={14} style={{ color: "#ff4444" }} /> :
                      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: run.status === "complete" ? "#22c55e" : run.status === "stopped" ? "#c9a96e" : run.status === "failed" ? "#ef4444" : "#eab308" }} />
                    }
                    <div>
                      <div style={{ color: "#bbb", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                        {new Date(run.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {run.mode === "youtube" && <span style={{ fontSize: "0.625rem", color: "#ff4444", background: "rgba(255,0,0,0.08)", padding: "0.125rem 0.375rem", borderRadius: "0.25rem" }}>YT</span>}
                        {run.status === "stopped" && <span style={{ fontSize: "0.625rem", color: "#c9a96e", background: "rgba(201,169,110,0.08)", padding: "0.125rem 0.375rem", borderRadius: "0.25rem" }}>Stopped</span>}
                      </div>
                      <div style={{ color: "#555", fontSize: "0.75rem" }}>{run.email_count || 0} emails</div>
                    </div>
                  </div>
                  {(run.status === "complete" || run.status === "stopped") && run.email_count > 0 && (
                    <button onClick={() => downloadHistoryCSV(run.id)} disabled={downloadingJobId === run.id} style={{
                      background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.15)",
                      color: "#c9a96e", padding: "0.25rem 0.75rem", borderRadius: "0.375rem", cursor: "pointer",
                      fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem",
                    }}>
                      {downloadingJobId === run.id ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Download size={12} />} CSV
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes nodePulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px rgba(201,169,110,0.3); }
          50% { opacity: 0.6; box-shadow: 0 0 12px rgba(201,169,110,0.5); }
        }
      `}</style>
    </div>
  );
}

// ─── Shared Components ──────────────────────────────────────────────────────

function StatBox({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "0.625rem", padding: "0.75rem 1rem", textAlign: "center", flex: "1 1 0", minWidth: "100px",
    }}>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: "0.6875rem", color: "#555", marginTop: "0.25rem" }}>{label}</div>
      {sub && <div style={{ fontSize: "0.5625rem", color: "#3a3a3a", marginTop: "0.125rem" }}>{sub}</div>}
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: "left", padding: "0.625rem 0.75rem", color: "#666", fontWeight: 500, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" };
const tdStyle: React.CSSProperties = { padding: "0.5rem 0.75rem", color: "#ccc" };
const btnSecondary: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#bbb", padding: "0.625rem 1.5rem", borderRadius: "0.5rem", fontSize: "0.875rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.375rem" };
