"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, ClipboardCheck, Loader2, Minus, X } from "lucide-react";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import type { Filters } from "../types";

/* ── Types (mirror lib/sales-hub/precall-adherence.ts) ────────────── */

interface LineStat {
  asked: number;
  eligible: number;
  rate: number | null;
}

interface ShowBucket {
  label: string;
  calls: number;
  shows: number;
  rate: number | null;
  cashCollected: number;
}

interface ResponseStat {
  samples: number;
  averageSeconds: number | null;
  medianSeconds: number | null;
  slowestSeconds: number | null;
}

interface CloserRow {
  closer: string;
  graded: number;
  threads: number;
  threadRate: number | null;
  intro: LineStat;
  leadReplied: LineStat;
  discovery: LineStat;
  discoveryDirect: LineStat;
  response: ResponseStat;
  shows: number;
  knownOutcomes: number;
  showRate: number | null;
  cashCollected: number;
}

interface CallRow {
  appointmentKey: string;
  leadName: string;
  closer: string;
  startIso: string;
  etDay: string;
  threadFound: boolean;
  legacy: boolean;
  intro: boolean | null;
  leadReplied: boolean | null;
  responseSeconds: number | null;
  discovery: boolean | null;
  discoveryDirect: boolean | null;
  outcome: "show" | "no_show" | "upcoming" | "unknown";
  cashCollected: number;
}

interface PrecallResult {
  team: {
    graded: number;
    threads: number;
    threadRate: number | null;
    legacyPending: number;
    intro: LineStat;
    leadReplied: LineStat;
    discovery: LineStat;
    discoveryDirect: LineStat;
    response: ResponseStat;
    showByDiscovery: ShowBucket[];
    showByIntro: ShowBucket[];
    showByLeadReply: ShowBucket[];
    showByResponse: ShowBucket[];
  };
  closers: CloserRow[];
  calls: CallRow[];
  asOf: string;
}

const CALL_LIST_LIMIT = 30;

/** Rates are null when the denominator is 0. */
const pct = (v: number | null) => (v === null ? "—" : fmtPercent(v));

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/* ── Component ────────────────────────────────────────────────────── */

export default function PrecallAdherence({ filters }: { filters: Filters }) {
  const [data, setData] = useState<PrecallResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllCalls, setShowAllCalls] = useState(false);

  const load = useCallback(async () => {
    const { dateFrom, dateTo } = getEffectiveDates(filters);
    try {
      const res = await fetch(`/api/sales-hub/precall-adherence?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="glass-static" style={{ padding: 40, display: "flex", justifyContent: "center" }}>
        <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="glass-static" style={{ padding: 24, textAlign: "center", color: "var(--danger)", fontSize: 13 }}>
        Pre-call adherence failed to load{error ? ` — ${error}` : ""}.
      </div>
    );
  }

  const { team } = data;
  const visibleCalls = showAllCalls ? data.calls : data.calls.slice(0, CALL_LIST_LIMIT);

  return (
    <div>
      {/* Team cards — the SOP: intro → prospect replies → discovery line */}
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
        <Card
          label="Graded Calls"
          value={fmtNumber(team.graded)}
          sub={
            <>
              {fmtNumber(team.threads)} with a SendBlue thread ({pct(team.threadRate)})
              {team.legacyPending > 0 && (
                <> · {fmtNumber(team.legacyPending)} still on the old rubric — re-grading every 2h</>
              )}
            </>
          }
        />
        <Card
          label="Intro Sent"
          value={pct(team.intro.rate)}
          sub={`${fmtNumber(team.intro.asked)} of ${fmtNumber(team.intro.eligible)} — “good to meet you, got you in for <time>” · prospect replied ${pct(team.leadReplied.rate)}`}
        />
        <Card
          label="Discovery Line Asked"
          value={pct(team.discovery.rate)}
          sub={`${fmtNumber(team.discovery.asked)} of ${fmtNumber(team.discovery.eligible)} threads — “what do you want out of the call” · as the direct reply ${pct(team.discoveryDirect.rate)}`}
        />
        <Card
          label="Closer Response Time"
          value={fmtDuration(team.response.averageSeconds)}
          sub={`prospect’s reply → closer’s next message · median ${fmtDuration(team.response.medianSeconds)} · slowest ${fmtDuration(team.response.slowestSeconds)} · n=${team.response.samples}`}
          color={
            team.response.averageSeconds !== null && team.response.averageSeconds > 1800
              ? "var(--danger)"
              : undefined
          }
        />
      </div>

      {/* Show rate by everything */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <ShowSplit title="Show rate · discovery line" buckets={team.showByDiscovery} />
        <ShowSplit title="Show rate · intro" buckets={team.showByIntro} />
        <ShowSplit title="Show rate · prospect replied" buckets={team.showByLeadReply} />
        <ShowSplit title="Show rate · closer response speed" buckets={team.showByResponse} />
      </div>

      {/* Per-closer table */}
      <div className="glass-static" style={{ overflow: "auto", marginBottom: 16 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Closer</th>
              <th>Graded</th>
              <th>Thread</th>
              <th>Intro Sent</th>
              <th>Prospect Replied</th>
              <th>Response (avg · median)</th>
              <th>Discovery Line</th>
              <th>Direct Reply</th>
              <th>Show Rate</th>
              <th>Cash</th>
            </tr>
          </thead>
          <tbody>
            {data.closers.map((c) => (
              <tr key={c.closer}>
                <td style={{ fontWeight: 600 }}>{c.closer}</td>
                <td>{fmtNumber(c.graded)}</td>
                <td>
                  {pct(c.threadRate)}
                  <Faint> ({c.threads}/{c.graded})</Faint>
                </td>
                <td>
                  {pct(c.intro.rate)}
                  <Faint> ({c.intro.asked}/{c.intro.eligible})</Faint>
                </td>
                <td>
                  {pct(c.leadReplied.rate)}
                  <Faint> ({c.leadReplied.asked}/{c.leadReplied.eligible})</Faint>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {fmtDuration(c.response.averageSeconds)}
                  <Faint> · {fmtDuration(c.response.medianSeconds)} · n={c.response.samples}</Faint>
                </td>
                <td>
                  {pct(c.discovery.rate)}
                  <Faint> ({c.discovery.asked}/{c.discovery.eligible})</Faint>
                </td>
                <td>
                  {pct(c.discoveryDirect.rate)}
                  <Faint> ({c.discoveryDirect.asked}/{c.discoveryDirect.eligible})</Faint>
                </td>
                <td>
                  {pct(c.showRate)}
                  <Faint> ({c.shows}/{c.knownOutcomes})</Faint>
                </td>
                <td>{fmtDollars(c.cashCollected)}</td>
              </tr>
            ))}
            {data.closers.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  No graded calls in this range yet — the grader runs every 2 hours.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Per-call log */}
      <div className="glass-static" style={{ overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 0", fontSize: 13, fontWeight: 600 }}>
          <ClipboardCheck size={15} style={{ color: "var(--text-muted)" }} />
          Graded calls
          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({fmtNumber(data.calls.length)} in range)</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date (ET)</th>
              <th>Lead</th>
              <th>Closer</th>
              <th>Thread</th>
              <th>Intro</th>
              <th>Replied</th>
              <th>Response</th>
              <th>Discovery</th>
              <th>Outcome</th>
              <th>Cash</th>
            </tr>
          </thead>
          <tbody>
            {visibleCalls.map((call) => (
              <tr key={call.appointmentKey}>
                <td style={{ whiteSpace: "nowrap" }}>{call.etDay}</td>
                <td>
                  {call.leadName}
                  {call.legacy && <Faint> · old rubric</Faint>}
                </td>
                <td>{call.closer}</td>
                <td><Mark value={call.threadFound} /></td>
                <td><Mark value={call.intro} /></td>
                <td><Mark value={call.leadReplied} /></td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDuration(call.responseSeconds)}</td>
                <td>
                  <Mark value={call.discovery} />
                  {call.discoveryDirect === true && <Faint> direct</Faint>}
                </td>
                <td><OutcomeBadge outcome={call.outcome} /></td>
                <td>{call.cashCollected > 0 ? fmtDollars(call.cashCollected) : "—"}</td>
              </tr>
            ))}
            {data.calls.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  Nothing graded in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {data.calls.length > CALL_LIST_LIMIT && (
          <button
            type="button"
            onClick={() => setShowAllCalls((v) => !v)}
            style={{
              display: "block",
              width: "100%",
              padding: "10px 0",
              background: "none",
              border: "none",
              borderTop: "1px solid var(--border)",
              color: "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {showAllCalls ? "Show fewer" : `Show all ${fmtNumber(data.calls.length)} calls`}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Bits ─────────────────────────────────────────────────────────── */

function Card({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="glass-static metric-card">
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

function ShowSplit({ title, buckets }: { title: string; buckets: ShowBucket[] }) {
  return (
    <div className="glass-static" style={{ padding: "10px 12px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>
        {title}
      </div>
      <table className="data-table" style={{ fontSize: 12 }}>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.label}>
              <td>{b.label}</td>
              <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{pct(b.rate)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <Faint>{b.shows}/{b.calls} · {fmtDollars(b.cashCollected)}</Faint>
              </td>
            </tr>
          ))}
          {buckets.length === 0 && (
            <tr>
              <td colSpan={3} style={{ color: "var(--text-muted)" }}>No data yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Faint({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{children}</span>;
}

function Mark({ value }: { value: boolean | null }) {
  if (value === null) return <Minus size={14} style={{ color: "var(--text-muted)" }} />;
  return value ? (
    <Check size={15} style={{ color: "var(--success)" }} />
  ) : (
    <X size={15} style={{ color: "var(--danger)" }} />
  );
}

function OutcomeBadge({ outcome }: { outcome: CallRow["outcome"] }) {
  const map: Record<CallRow["outcome"], { label: string; color: string }> = {
    show: { label: "Show", color: "var(--success)" },
    no_show: { label: "No-show", color: "var(--danger)" },
    upcoming: { label: "Upcoming", color: "var(--text-muted)" },
    unknown: { label: "Not logged", color: "var(--warning)" },
  };
  const { label, color } = map[outcome];
  return <span style={{ color, fontWeight: 600, fontSize: 12 }}>{label}</span>;
}
