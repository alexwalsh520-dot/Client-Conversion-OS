"use client";

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Repeat } from "lucide-react";
import { fmtNumber, fmtPercent } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import type { Filters } from "../types";

/* ── Types (mirror lib/sales-hub/followup-adherence.ts) ───────────── */

interface FollowupStage {
  stage: number;
  due: number;
  inWindow: number;
  offWindow: number;
  missed: number;
  sent: number;
  replies: number;
  booked: number;
  adherenceRate: number | null;
  replyRate: number | null;
}

interface FollowupGroup {
  id: string;
  label: string;
  due: number;
  inWindow: number;
  offWindow: number;
  missed: number;
  sent: number;
  replies: number;
  booked: number;
  adherenceRate: number | null;
  replyRate: number | null;
  stages: FollowupStage[];
}

interface NeedsFollowupRow {
  client: string;
  clientLabel: string;
  setterLabel: string;
  leadName: string | null;
  subscriberId: string;
  manychatUrl: string | null;
  stage: number;
  lastFollowupAt: string;
  dueAt: string;
  closeAt: string;
  overdueMinutes: number;
}

interface FollowupAdherenceResult {
  team: FollowupGroup;
  setters: FollowupGroup[];
  needsFollowup: NeedsFollowupRow[];
  maxFollowups: number;
  asOf: string;
  cadence: string;
}

const AUTO_REFRESH_MS = 60_000;

/* ── Helpers ──────────────────────────────────────────────────────── */

function fmtRate(value: number | null): string {
  return value == null ? "—" : fmtPercent(value);
}

function rateColor(value: number | null, good: number, okay: number): string {
  if (value == null) return "var(--text-secondary)";
  if (value >= good) return "var(--success)";
  if (value >= okay) return "var(--warning)";
  return "var(--danger)";
}

const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function fmtEt(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? ET_TIME.format(d) : "—";
}

function fmtOverdue(minutes: number): string {
  if (minutes <= 0) return "due now";
  if (minutes < 60) return `${minutes}m overdue`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h ${minutes % 60}m overdue`;
  return `${Math.floor(h / 24)}d ${h % 24}h overdue`;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
  return res.json();
}

/* ── Component ────────────────────────────────────────────────────── */

export default function FollowupAdherence({ filters }: { filters: Filters }) {
  const { dateFrom, dateTo } = getEffectiveDates(filters);

  const [data, setData] = useState<FollowupAdherenceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(
    async (background = false) => {
      if (!background) setLoading(true);
      setError("");
      try {
        const result = await fetchJSON<FollowupAdherenceResult>(
          `/api/sales-hub/followup-adherence?client=${encodeURIComponent(filters.client)}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
        );
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [filters.client, dateFrom, dateTo],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    const id = window.setInterval(() => void fetchData(true), AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="glass-static" style={{ padding: 40, display: "flex", justifyContent: "center" }}>
        <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="glass-static" style={{ padding: 24, textAlign: "center", color: "var(--danger)", fontSize: 13 }}>
        Failed to load follow-up adherence: {error}
      </div>
    );
  }
  if (!data) return null;

  const t = data.team;

  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
        Cadence: {data.cadence}
      </div>

      {/* Team cards */}
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
        <Card
          icon={<Repeat size={12} style={{ color: rateColor(t.adherenceRate, 80, 60) }} />}
          label="Team Adherence"
          value={fmtRate(t.adherenceRate)}
          color={rateColor(t.adherenceRate, 80, 60)}
        />
        <Card
          icon={<CheckCircle2 size={12} style={{ color: "var(--accent)" }} />}
          label="Follow-ups Due"
          value={fmtNumber(t.due)}
        />
        <Card
          icon={<AlertTriangle size={12} style={{ color: "var(--danger)" }} />}
          label="Missed"
          value={fmtNumber(t.missed)}
          color={t.missed > 0 ? "var(--danger)" : undefined}
        />
        <Card
          icon={<Repeat size={12} style={{ color: "var(--success)" }} />}
          label="Reply Rate"
          value={fmtRate(t.replyRate)}
          color={rateColor(t.replyRate, 30, 15)}
        />
      </div>

      {/* Team by-stage strip + per-setter breakdown */}
      <GroupTable title="By Setter (click a setter for the per-follow-up breakdown)" groups={[t, ...data.setters]} />

      {/* Needs follow-up */}
      <div style={{ marginTop: 20 }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--text-muted)",
            fontWeight: 600,
            marginBottom: 10,
          }}
        >
          Needs Follow-Up ({data.needsFollowup.length})
        </div>
        <div className="glass-static" style={{ overflow: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Offer</th>
                <th>Setter</th>
                <th>Next</th>
                <th>Last Message</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.needsFollowup.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ color: "var(--text-muted)" }}>
                    Nobody is waiting on a follow-up. Clean board.
                  </td>
                </tr>
              ) : (
                data.needsFollowup.map((row) => (
                  <tr key={`${row.client}-${row.subscriberId}-${row.stage}`}>
                    <td style={{ fontWeight: 650, color: "var(--text-primary)" }}>
                      {row.leadName || row.subscriberId}
                    </td>
                    <td>{row.clientLabel}</td>
                    <td>{row.setterLabel}</td>
                    <td style={{ fontWeight: 650 }}>FU{row.stage}</td>
                    <td>{fmtEt(row.lastFollowupAt)}</td>
                    <td>{fmtEt(row.dueAt)}</td>
                    <td
                      style={{
                        fontWeight: 650,
                        color: row.overdueMinutes > 0 ? "var(--danger)" : "var(--warning)",
                      }}
                    >
                      {fmtOverdue(row.overdueMinutes)}
                    </td>
                    <td>
                      {row.manychatUrl ? (
                        <a
                          href={row.manychatUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          Chat <ExternalLink size={12} />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────── */

function Card({ icon, label, value, color }: { icon: ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="glass-static metric-card">
      <div className="metric-card-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {icon}
        {label}
      </div>
      <div className="metric-card-value" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function GroupTable({ title, groups }: { title: string; groups: FollowupGroup[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "1px",
          color: "var(--text-muted)",
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div className="glass-static" style={{ overflow: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Due</th>
              <th>Hit Window</th>
              <th>Off Cadence</th>
              <th>Missed</th>
              <th>Adherence</th>
              <th>Replies</th>
              <th>Reply Rate</th>
              <th>Booked</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = open.has(g.id);
              const stagesWithData = g.stages.filter((s) => s.due > 0 || s.booked > 0);
              return (
                <Fragment key={g.id}>
                  <tr onClick={() => toggle(g.id)} style={{ cursor: "pointer" }}>
                    <td style={{ fontWeight: 650, color: "var(--text-primary)" }}>
                      <span style={{ display: "inline-block", width: 12, color: "var(--text-muted)" }}>
                        {isOpen ? "▾" : "▸"}
                      </span>
                      {g.label}
                    </td>
                    <StatCells g={g} />
                  </tr>
                  {isOpen &&
                    (stagesWithData.length === 0 ? (
                      <tr style={{ background: "rgba(127,127,127,0.06)" }}>
                        <td colSpan={9} style={{ paddingLeft: 28, color: "var(--text-muted)", fontSize: 12 }}>
                          No follow-ups came due in this range.
                        </td>
                      </tr>
                    ) : (
                      stagesWithData.map((s) => (
                        <tr key={`${g.id}-${s.stage}`} style={{ background: "rgba(127,127,127,0.06)" }}>
                          <td style={{ paddingLeft: 28, fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>
                            Follow-up {s.stage}
                          </td>
                          <StatCells g={s} />
                        </tr>
                      ))
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCells({ g }: { g: Pick<FollowupGroup, "due" | "inWindow" | "offWindow" | "missed" | "adherenceRate" | "replies" | "replyRate" | "booked"> }) {
  return (
    <>
      <td>{fmtNumber(g.due)}</td>
      <td style={{ color: g.inWindow > 0 ? "var(--success)" : "var(--text-secondary)" }}>{fmtNumber(g.inWindow)}</td>
      <td style={{ color: g.offWindow > 0 ? "var(--warning)" : "var(--text-secondary)" }}>{fmtNumber(g.offWindow)}</td>
      <td style={{ color: g.missed > 0 ? "var(--danger)" : "var(--text-secondary)" }}>{fmtNumber(g.missed)}</td>
      <td>
        <span style={{ color: rateColor(g.adherenceRate, 80, 60), fontWeight: 650 }}>{fmtRate(g.adherenceRate)}</span>
      </td>
      <td>{fmtNumber(g.replies)}</td>
      <td>
        <span style={{ color: rateColor(g.replyRate, 30, 15), fontWeight: 650 }}>{fmtRate(g.replyRate)}</span>
      </td>
      <td style={{ color: g.booked > 0 ? "var(--accent)" : "var(--text-secondary)", fontWeight: 650 }}>
        {fmtNumber(g.booked)}
      </td>
    </>
  );
}
