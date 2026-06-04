"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquareReply,
  Users,
} from "lucide-react";
import { fmtNumber } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import type { Filters } from "../types";

interface ResponseTimeGroup {
  id: string;
  label: string;
  averageMinutes: number | null;
  sampleCount: number;
  fastestMinutes: number | null;
  slowestMinutes: number | null;
}

interface ResponseTimeMetrics {
  summary: ResponseTimeGroup & {
    latestMessageAt: string | null;
    leadAssignments: number;
    matchedLeads: number;
    unmatchedInboundMessages: number;
    openInboundMessages: number;
    staleMessageFeed: boolean;
  };
  clients: ResponseTimeGroup[];
  setters: ResponseTimeGroup[];
  slowestGaps: Array<{
    client: "tyson" | "keith" | "lucy";
    clientLabel: string;
    setterLabel: string;
    leadName: string | null;
    inboundAt: string;
    outboundAt: string;
    activeMinutes: number;
  }>;
  setup: {
    businessHours: string;
    sourceOfTruth: {
      leads: string;
      messages: string;
      attribution: string;
    };
    needs: string[];
  };
}

interface ResponseTimesProps {
  filters: Filters;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
  return res.json();
}

function formatDuration(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}m`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
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

function responseColor(minutes: number | null) {
  if (minutes === null) return "var(--text-secondary)";
  if (minutes <= 15) return "var(--success)";
  if (minutes <= 45) return "var(--warning)";
  return "var(--danger)";
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

  return (
    <div>
      <div className="section" style={{ marginBottom: 20 }}>
        <h2 className="section-title">
          <Clock3 size={16} />
          Response Time Tracking
        </h2>

        <div className="metric-grid metric-grid-3" style={{ marginBottom: 12 }}>
          <MetricCard
            icon={<Clock3 size={12} style={{ color: responseColor(data.summary.averageMinutes) }} />}
            label="Team Avg"
            value={formatDuration(data.summary.averageMinutes)}
            color={responseColor(data.summary.averageMinutes)}
          />
          <MetricCard
            icon={<MessageSquareReply size={12} style={{ color: "var(--accent)" }} />}
            label="Samples"
            value={fmtNumber(data.summary.sampleCount)}
          />
          <MetricCard
            icon={<Users size={12} style={{ color: "var(--accent)" }} />}
            label="Matched Leads"
            value={fmtNumber(data.summary.matchedLeads)}
          />
        </div>

        <StatusPanel data={data} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 20 }}>
        <GroupTable title="By Offer" rows={data.clients} />
        <GroupTable title="By Setter" rows={data.setters} />
      </div>

      <SlowestGapsTable rows={data.slowestGaps} />
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

function StatusPanel({ data }: { data: ResponseTimeMetrics }) {
  const ok = !data.summary.staleMessageFeed && data.summary.sampleCount > 0;

  return (
    <div
      className="glass-static"
      style={{
        padding: 16,
        borderColor: ok ? "rgba(126, 211, 170, 0.28)" : "rgba(225, 196, 108, 0.32)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {ok ? (
          <CheckCircle2 size={15} style={{ color: "var(--success)" }} />
        ) : (
          <AlertTriangle size={15} style={{ color: "var(--warning)" }} />
        )}
        <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 700 }}>
          {ok ? "Live response samples found" : "Waiting on live response data"}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: data.setup.needs.length > 0 ? 12 : 0,
        }}
      >
        <StatusItem label="Business Hours" value={data.setup.businessHours} />
        <StatusItem label="Latest DM Seen" value={formatDateTime(data.summary.latestMessageAt)} />
        <StatusItem label="Lead Assignments" value={fmtNumber(data.summary.leadAssignments)} />
        <StatusItem label="Open Inbounds" value={fmtNumber(data.summary.openInboundMessages)} />
      </div>

      {data.setup.needs.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {data.setup.needs.map((item) => (
            <div key={item} style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.45 }}>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 650 }}>
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
              <th>Samples</th>
              <th>Fastest</th>
              <th>Slowest</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ color: "var(--text-muted)" }}>No samples yet</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                <td style={{ fontWeight: 650, color: "var(--text-primary)" }}>{row.label}</td>
                <td style={{ color: responseColor(row.averageMinutes), fontWeight: 650 }}>
                  {formatDuration(row.averageMinutes)}
                </td>
                <td>{fmtNumber(row.sampleCount)}</td>
                <td>{formatDuration(row.fastestMinutes)}</td>
                <td>{formatDuration(row.slowestMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SlowestGapsTable({ rows }: { rows: ResponseTimeMetrics["slowestGaps"] }) {
  return (
    <div>
      <TableTitle>Slowest Gaps</TableTitle>
      <div className="glass-static" style={{ overflow: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Offer</th>
              <th>Setter</th>
              <th>Inbound</th>
              <th>Reply</th>
              <th>Gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: "var(--text-muted)" }}>No response gaps yet</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={`${row.client}-${row.setterLabel}-${row.inboundAt}-${row.outboundAt}`}>
                <td style={{ fontWeight: 650, color: "var(--text-primary)" }}>{row.leadName || "Unknown"}</td>
                <td>{row.clientLabel}</td>
                <td>{row.setterLabel}</td>
                <td>{formatDateTime(row.inboundAt)}</td>
                <td>{formatDateTime(row.outboundAt)}</td>
                <td style={{ color: responseColor(row.activeMinutes), fontWeight: 650 }}>
                  {formatDuration(row.activeMinutes)}
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

