"use client";

import { useMemo } from "react";
import {
  Pill,
  RefreshCw,
  Plug,
  CheckCircle2,
  Lock,
  ArrowRight,
  Dumbbell,
} from "lucide-react";
import {
  formatMoneyCents,
  formatValue,
  type FunnelRow,
  type MetricSection,
  type MoneyRow,
  type PeriodKey,
  type SourceKey,
  type SourceStatus,
  type SplitValue,
  type SupplementsDashboardData,
} from "@/lib/supplements-types";

type Props = {
  data: SupplementsDashboardData;
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
  onRefresh: () => void;
};

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "this_month", label: "This Month" },
  { key: "last_30", label: "Last 30 Days" },
  { key: "this_year", label: "YTD" },
  { key: "all_time", label: "All Time" },
];

const COL_GRID = "minmax(190px, 1.5fr) 1fr 1.2fr 1fr";

export default function SupplementsDashboard({ data, period, onPeriodChange, onRefresh }: Props) {
  const connected = useMemo(() => {
    const m = {} as Record<SourceKey, boolean>;
    data.sources.forEach((s) => (m[s.key] = s.connected));
    return m;
  }, [data.sources]);

  return (
    <div style={{ padding: "28px 32px 80px", maxWidth: 1180, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "var(--accent-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Pill size={22} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.5px" }}>
              Supplements
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "2px 0 0" }}>
              Nutrition-consult funnel · supplement + coaching revenue · by customer path
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", background: "var(--bg-secondary)", borderRadius: 10, padding: 3 }}>
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => onPeriodChange(p.key)}
                style={{
                  border: "none",
                  background: period === p.key ? "var(--bg-card)" : "transparent",
                  color: period === p.key ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: "7px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={onRefresh}
            title="Refresh"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              color: "var(--text-secondary)",
              fontSize: 12.5,
              fontWeight: 600,
              padding: "8px 12px",
              borderRadius: 10,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Connection status */}
      <ConnectionBanner sources={data.sources} period={data.period.label} />

      {/* Path legend */}
      <PathLegend />

      {/* Live sections */}
      {data.sections.map((section) => (
        <SectionBlock key={section.key} section={section} connected={connected} />
      ))}

      {/* Future / locked sections */}
      {data.future.map((section) => (
        <SectionBlock key={section.key} section={section} connected={connected} locked />
      ))}

      <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 28, textAlign: "center" }}>
        Generated {new Date(data.generatedAt).toLocaleString("en-US")} · all figures auto-pulled, zero manual entry once connected
      </p>
    </div>
  );
}

// ── Connection banner ────────────────────────────────────────────────────────────

function ConnectionBanner({ sources, period }: { sources: SourceStatus[]; period: string }) {
  const liveCount = sources.filter((s) => s.connected).length;
  return (
    <div
      style={{
        marginTop: 22,
        border: "1px solid var(--border)",
        borderRadius: 14,
        background: "var(--bg-card)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 13,
        }}
      >
        <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>
          Data Connections · {period}
        </span>
        <span style={{ color: liveCount > 0 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
          {liveCount}/{sources.length} live
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
        {sources.map((s) => (
          <div
            key={s.key}
            style={{
              padding: "13px 16px",
              borderRight: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              {s.connected ? (
                <CheckCircle2 size={15} style={{ color: "var(--success)" }} />
              ) : (
                <Plug size={15} style={{ color: "var(--danger)" }} />
              )}
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{s.label}</span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  color: s.connected ? "var(--success)" : "var(--danger)",
                }}
              >
                {s.connected ? "Live" : "Not connected"}
              </span>
            </div>
            <span style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              Powers: {s.powers}
            </span>
            {!s.connected && (
              <span style={{ fontSize: 11.5, color: "var(--accent)", lineHeight: 1.45, display: "flex", gap: 5 }}>
                <ArrowRight size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {s.whatToDo}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Path legend ──────────────────────────────────────────────────────────────────

function PathLegend() {
  const cell = (tag: string, color: string, title: string, desc: string) => (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1, minWidth: 240 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          color,
          border: `1px solid ${color}`,
          borderRadius: 6,
          padding: "2px 7px",
          flexShrink: 0,
        }}
      >
        {tag}
      </span>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4 }}>{desc}</div>
      </div>
    </div>
  );
  return (
    <div
      style={{
        marginTop: 16,
        display: "flex",
        gap: 20,
        flexWrap: "wrap",
        padding: "13px 16px",
        border: "1px solid var(--border)",
        borderRadius: 14,
        background: "var(--bg-glass)",
      }}
    >
      {cell("A", "var(--tyson, #82c5c5)", "Path A — Warm", "Bought 1:1 coaching, then booked a nutrition consult. Tracks supplements + coaching separately.")}
      {cell("B", "var(--keith, #b8a4d9)", "Path B — Rescue", "Didn't close on coaching, offered a free consult, then booked. Supplements only.")}
    </div>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────────

function SectionBlock({
  section,
  connected,
  locked = false,
}: {
  section: MetricSection;
  connected: Record<SourceKey, boolean>;
  locked?: boolean;
}) {
  return (
    <div style={{ marginTop: 26, opacity: locked ? 0.62 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          {section.title}
        </h2>
        {locked && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "2px 7px",
            }}
          >
            <Lock size={11} /> Add later
          </span>
        )}
      </div>
      {section.subtitle && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>{section.subtitle}</p>
      )}

      <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--bg-card)" }}>
        {/* header row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: COL_GRID,
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: "var(--text-muted)",
          }}
        >
          <span>Metric</span>
          <span style={{ textAlign: "right" }}>Total</span>
          <span style={{ textAlign: "right", color: "var(--tyson, #82c5c5)" }}>Path A</span>
          <span style={{ textAlign: "right", color: "var(--keith, #b8a4d9)" }}>Path B</span>
        </div>

        {section.kind === "funnel"
          ? section.rows.map((row, i) => (
              <FunnelRowView key={row.key} row={row} live={connected[row.source]} last={i === section.rows.length - 1} />
            ))
          : section.rows.map((row, i) => (
              <MoneyRowView key={row.key} row={row} live={connected[row.source]} last={i === section.rows.length - 1} />
            ))}
      </div>
    </div>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────────

function RowShell({ children, last }: { children: React.ReactNode; last: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: COL_GRID,
        padding: "13px 16px",
        borderBottom: last ? "none" : "1px solid var(--border)",
        alignItems: "center",
      }}
    >
      {children}
    </div>
  );
}

function MetricLabel({ label, hint, live }: { label: string; hint?: string; live: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingRight: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>{label}</span>
        {!live && (
          <Plug size={12} style={{ color: "var(--danger)", opacity: 0.7 }} aria-label="Source not connected" />
        )}
      </div>
      {hint && <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.35 }}>{hint}</span>}
    </div>
  );
}

function FunnelRowView({ row, live, last }: { row: FunnelRow; live: boolean; last: boolean }) {
  const cell = (v: number | null, color?: string) => (
    <span style={{ textAlign: "right", fontSize: 14.5, fontWeight: 600, color: v === null ? "var(--text-muted)" : color ?? "var(--text-primary)" }}>
      {formatValue(v, row.format)}
    </span>
  );
  return (
    <RowShell last={last}>
      <MetricLabel label={row.label} hint={row.hint} live={live} />
      {cell(row.total)}
      {cell(row.pathA, "var(--tyson, #82c5c5)")}
      {cell(row.pathB, "var(--keith, #b8a4d9)")}
    </RowShell>
  );
}

function MoneyRowView({ row, live, last }: { row: MoneyRow; live: boolean; last: boolean }) {
  return (
    <RowShell last={last}>
      <MetricLabel label={row.label} hint={row.hint} live={live} />
      <SplitCell value={row.total} />
      <SplitCell value={row.pathA} accent="var(--tyson, #82c5c5)" />
      <SplitCell value={row.pathB} accent="var(--keith, #b8a4d9)" pathB />
    </RowShell>
  );
}

/** Renders a money cell with supplement + coaching kept visibly separate. */
function SplitCell({ value, accent, pathB = false }: { value: SplitValue; accent?: string; pathB?: boolean }) {
  const supColor = value.supplements === null ? "var(--text-muted)" : accent ?? "var(--text-primary)";
  return (
    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 14.5, fontWeight: 600, color: supColor }}>
        {formatMoneyCents(value.supplements)}
      </span>
      {pathB ? (
        <span style={{ fontSize: 10.5, color: "var(--text-muted)", fontStyle: "italic" }}>no coaching</span>
      ) : (
        <span style={{ fontSize: 11, color: "var(--text-muted)", display: "inline-flex", gap: 4, justifyContent: "flex-end", alignItems: "center" }}>
          <Dumbbell size={11} /> coaching {formatMoneyCents(value.coaching)}
        </span>
      )}
    </div>
  );
}
