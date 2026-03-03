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
  engagementPassed: number;
  qualified: number;
  youtube: number;
  emails: number;
}

type PipelineStep = 1 | 2 | 3 | 4 | 5 | null;

const STEP_LABELS: Record<number, string> = {
  1: "Scraping Brands",
  2: "Enriching Profiles",
  3: "Engagement Filter",
  4: "AI Scoring",
  5: "YouTube Discovery",
};

const DEFAULT_BRANDS = [
  "gymshark", "1stphorm", "youngla", "darcsport", "alphaleteathletics",
  "nvgtn", "ghostlifestyle", "rawgear", "gymreapers", "gorillawear",
  "musclenation", "buffbunnyco", "rabornyofficial",
];

// ─── Component ──────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  // Run state
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<PipelineStep>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const [sortBy, setSortBy] = useState<"score" | "followers">("score");

  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

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
        body: JSON.stringify({ test: testMode, config: configPayload }),
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
      setRunning(false);
    }
  }

  function stopPipeline() {
    abortRef.current?.abort();
    setRunning(false);
  }

  // ─── CSV Export ─────────────────────────────────────────────────────────────

  function downloadCSV() {
    const headers = [
      "score", "username", "full_name", "ig_email", "youtube_channel",
      "followers", "engagement_rate", "avg_views", "monetization", "reason",
      "brand_source", "biography", "website", "profile_url",
    ];

    const escapeCSV = (v: any) => {
      const str = String(v ?? "");
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

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

  // ─── Filtered + Sorted Leads ────────────────────────────────────────────────

  const filteredLeads = leads
    .filter((l) => l.score >= (parseInt(minScore) || 0))
    .filter((l) => {
      if (!searchFilter) return true;
      const q = searchFilter.toLowerCase();
      return (
        l.username.toLowerCase().includes(q) ||
        l.fullName.toLowerCase().includes(q) ||
        l.brandSource.toLowerCase().includes(q) ||
        l.monetization.toLowerCase().includes(q)
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
              Find fitness influencer leads from brand following lists, score with AI, discover YouTube channels
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {leads.length > 0 && (
              <button className="btn-secondary" onClick={downloadCSV} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <Download size={14} />
                Export CSV
              </button>
            )}
            {running ? (
              <button
                className="btn-secondary"
                onClick={stopPipeline}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
              >
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                Stop
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={runPipeline}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
              >
                <Play size={14} />
                Run Pipeline
              </button>
            )}
          </div>
        </div>
      </div>

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
                      {testMode ? "Test Mode" : "Full Pipeline"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                      {testMode ? "1 brand · 20 accounts · fast" : `All ${brands.split(",").filter(Boolean).length} brands · ${maxFollowing} per brand`}
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
                  {testMode ? "Test mode caps at 20 regardless" : `Scrape up to ${maxFollowing} accounts per brand`}
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

              {/* Score Threshold */}
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
            </div>
          </div>
        )}
      </div>

      {/* Pipeline Progress */}
      {(running || logs.length > 0) && (
        <div className="section">
          <h2 className="section-title">
            <Activity size={16} />
            Pipeline Progress
          </h2>

          {/* Step Indicators */}
          {running && (
            <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
              {[1, 2, 3, 4, 5].map((step) => (
                <div
                  key={step}
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    background:
                      currentStep && step < currentStep
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
              Step {currentStep}/5: {STEP_LABELS[currentStep]}
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
                    : log.includes("FAILED") || log.includes("error")
                    ? "var(--danger)"
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
        </div>
      )}

      {/* Results Table */}
      {leads.length > 0 && (
        <div className="section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              <Users size={16} />
              Leads ({filteredLeads.length})
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
              <select
                className="form-input"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                style={{ width: 140, fontSize: 12 }}
              >
                <option value="score">Sort: Score</option>
                <option value="followers">Sort: Followers</option>
              </select>
            </div>
          </div>

          <div className="glass-static" style={{ overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
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
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!running && leads.length === 0 && !error && (
        <div className="section">
          <div
            className="glass-static"
            style={{
              padding: 48,
              textAlign: "center",
            }}
          >
            <Crosshair
              size={32}
              style={{ color: "var(--text-muted)", margin: "0 auto 16px" }}
            />
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: 8,
              }}
            >
              Ready to find leads
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
              This tool scrapes who major fitness brands follow on Instagram,
              qualifies them using engagement + AI scoring, and finds their
              YouTube channels. Start with a test run to verify your API keys work.
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                <Instagram size={12} />
                Apify Scraping
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                <Brain size={12} />
                Claude AI Scoring
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                <Youtube size={12} />
                YouTube Discovery
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
