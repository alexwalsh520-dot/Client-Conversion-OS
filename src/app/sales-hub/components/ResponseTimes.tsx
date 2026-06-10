"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Clock3, ExternalLink, Loader2 } from "lucide-react";
import { fmtNumber } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import HourlyStripTable, { type StripRow } from "./HourlyStripTable";
import type { Filters } from "../types";

interface HourlyBucket {
  hour: number;
  count: number;
  avgSeconds: number | null;
  missedCount: number;
}

interface ResponseTimeGroup {
  id: string;
  label: string;
  averageSeconds: number | null;
  sampleCount: number;
  fastestSeconds: number | null;
  slowestSeconds: number | null;
  missedCount: number;
  hourly: HourlyBucket[];
}

interface Conversation {
  client: "tyson" | "antwan";
  clientLabel: string;
  setterLabel: string;
  leadName: string | null;
  subscriberId: string;
  manychatUrl: string | null;
  inboundAt: string;
  outboundAt: string;
  activeSeconds: number;
  missed: boolean;
}

interface ResponseTimeMetrics {
  summary: ResponseTimeGroup;
  clients: ResponseTimeGroup[];
  setters: ResponseTimeGroup[];
  missThresholdSeconds: number;
  conversations: Conversation[];
}

interface ResponseTimesProps {
  filters: Filters;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
  return res.json();
}

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function responseColor(seconds: number | null) {
  if (seconds === null) return "var(--text-secondary)";
  if (seconds <= 15 * 60) return "var(--success)";
  if (seconds <= 45 * 60) return "var(--warning)";
  return "var(--danger)";
}

function missRate(missed: number, total: number) {
  if (!total) return "—";
  return `${Math.round((missed / total) * 100)}%`;
}

function thresholdLabel(seconds: number) {
  return `${Math.round(seconds / 60)} min`;
}

function fmtHour(hour: number) {
  const period = hour < 12 ? "a" : "p";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${period}`;
}

// Compact m:ss for the hour-strip cells (e.g. 0:52, 2:56, 5:30).
function fmtMmSs(seconds: number) {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const BUSINESS_HOUR_LABELS = Array.from({ length: 12 }, (_, i) => fmtHour(11 + i));

function hourlyStripRow(group: ResponseTimeGroup): StripRow {
  return {
    id: group.id,
    label: group.label,
    cells: group.hourly.map((h) => ({
      value: h.avgSeconds != null ? fmtMmSs(h.avgSeconds) : null,
      danger: h.missedCount > 0,
      tooltip: `${fmtHour(h.hour)} — ${h.avgSeconds != null ? formatDuration(h.avgSeconds) : "no data"} · ${h.count} replies · ${h.missedCount} missed`,
    })),
  };
}

export default function ResponseTimes({ filters }: ResponseTimesProps) {
  const { dateFrom, dateTo } = getEffectiveDates(filters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<ResponseTimeMetrics | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchJSON<ResponseTimeMetrics>(
        `/api/sales-hub/response-times?client=${filters.client}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load response time data");
    } finally {
      setLoading(false);
    }
  }, [filters.client, dateFrom, dateTo]);

  useEffect(() => {
    void Promise.resolve().then(fetchData);
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
      <div className="glass-static" style={{ padding: 24, color: "var(--danger)", fontSize: 13 }}>
        Failed to load response time data: {error}
      </div>
    );
  }

  if (!data) return null;

  const threshold = thresholdLabel(data.missThresholdSeconds);

  return (
    <div>
      <div className="section" style={{ marginBottom: 20 }}>
        <h2 className="section-title">
          <Clock3 size={16} />
          Response Time Tracking
        </h2>

        <div className="metric-grid metric-grid-3" style={{ marginBottom: 12 }}>
          <MetricCard
            icon={<Clock3 size={12} style={{ color: responseColor(data.summary.averageSeconds) }} />}
            label="Team Avg"
            value={formatDuration(data.summary.averageSeconds)}
            color={responseColor(data.summary.averageSeconds)}
          />
          <MetricCard
            icon={<AlertTriangle size={12} style={{ color: "var(--danger)" }} />}
            label={`Missed (>${threshold})`}
            value={fmtNumber(data.summary.missedCount)}
            color={data.summary.missedCount > 0 ? "var(--danger)" : undefined}
          />
          <MetricCard
            icon={<AlertTriangle size={12} style={{ color: "var(--warning)" }} />}
            label="Miss Rate"
            value={missRate(data.summary.missedCount, data.summary.sampleCount)}
          />
        </div>

        <HourlyStripTable
          title="Team — avg response by hour (11am–11pm ET)"
          hourLabels={BUSINESS_HOUR_LABELS}
          rows={[hourlyStripRow(data.summary)]}
          collapsible
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <GroupTable title="By Offer" rows={data.clients} />
        <HourlyStripTable
          title="Avg response by hour"
          hourLabels={BUSINESS_HOUR_LABELS}
          rows={data.clients.map(hourlyStripRow)}
          collapsible
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <GroupTable title="By Setter" rows={data.setters} />
        <HourlyStripTable
          title="Avg response by hour"
          hourLabels={BUSINESS_HOUR_LABELS}
          rows={data.setters.map(hourlyStripRow)}
          collapsible
        />
      </div>

      <div className="section" style={{ marginBottom: 20 }}>
        <h2 className="section-title">
          <AlertTriangle size={16} />
          Missed Response Time (over {threshold})
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <MissedTable title="By Offer" rows={data.clients} />
          <MissedTable title="By Setter" rows={data.setters} />
        </div>
      </div>

      <ConversationsTable rows={data.conversations.filter((c) => c.missed)} />
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  color?: string;
}) {
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

function GroupTable({ title, rows }: { title: string; rows: ResponseTimeGroup[] }) {
  return (
    <div>
      <TableTitle>{title}</TableTitle>
      <div className="glass-static" style={{ overflow: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Avg</th>
              <th>Fastest</th>
              <th>Slowest</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--text-muted)" }}>No data yet</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                <td style={{ fontWeight: 650, color: "var(--text-primary)" }}>{row.label}</td>
                <td style={{ color: responseColor(row.averageSeconds), fontWeight: 650 }}>
                  {formatDuration(row.averageSeconds)}
                </td>
                <td>{formatDuration(row.fastestSeconds)}</td>
                <td>{formatDuration(row.slowestSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MissedTable({ title, rows }: { title: string; rows: ResponseTimeGroup[] }) {
  return (
    <div>
      <TableTitle>{title}</TableTitle>
      <div className="glass-static" style={{ overflow: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Missed</th>
              <th>Replies</th>
              <th>Miss %</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--text-muted)" }}>No data yet</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                <td style={{ fontWeight: 650, color: "var(--text-primary)" }}>{row.label}</td>
                <td style={{ color: row.missedCount > 0 ? "var(--danger)" : "var(--text-secondary)", fontWeight: 650 }}>
                  {fmtNumber(row.missedCount)}
                </td>
                <td>{fmtNumber(row.sampleCount)}</td>
                <td style={{ fontWeight: 650 }}>{missRate(row.missedCount, row.sampleCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConversationsTable({ rows }: { rows: Conversation[] }) {
  return (
    <div>
      <TableTitle>Missed Response Times ({fmtNumber(rows.length)})</TableTitle>
      <div className="glass-static" style={{ overflow: "auto", maxHeight: 540 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Offer</th>
              <th>Setter</th>
              <th>Messaged</th>
              <th>Replied</th>
              <th>Response</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: "var(--text-muted)" }}>No missed responses in this range 🎉</td>
              </tr>
            ) : rows.map((row, i) => (
              <tr key={`${row.client}-${row.subscriberId}-${row.inboundAt}-${i}`}>
                <td style={{ fontWeight: 650, color: "var(--text-primary)" }}>{row.leadName || "Unknown"}</td>
                <td>{row.clientLabel}</td>
                <td>{row.setterLabel}</td>
                <td>{formatDateTime(row.inboundAt)}</td>
                <td>{formatDateTime(row.outboundAt)}</td>
                <td style={{ color: "var(--danger)", fontWeight: 650 }}>
                  {formatDuration(row.activeSeconds)}
                </td>
                <td>
                  {row.manychatUrl ? (
                    <a
                      href={row.manychatUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--accent)",
                        border: "1px solid var(--accent)",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <ExternalLink size={11} /> Take me to chat
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableTitle({ children }: { children: ReactNode }) {
  return (
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
      {children}
    </div>
  );
}
