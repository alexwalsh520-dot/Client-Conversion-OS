"use client";

import { Link2, Tag } from "lucide-react";
import { fmtNumber, fmtPercent } from "@/lib/formatters";
import type { Client, ManychatFunnelStage, ManychatMetrics } from "../types";

type ClientKey = Exclude<Client, "all">;

interface DMFunnelsProps {
  selectedClient: Client;
  metricsMap: Partial<Record<ClientKey, ManychatMetrics>>;
  loading: boolean;
  error: string;
}

interface RenderStage extends ManychatFunnelStage {
  tracked: boolean;
}

interface ClientFunnel {
  key: ClientKey;
  label: string;
  color: string;
  stages: RenderStage[];
}

const CLIENT_META: Record<ClientKey, { label: string; color: string }> = {
  tyson: { label: "Tyson Sonnek", color: "#4d77ff" },
  keith: { label: "Keith Holland", color: "#b6a0ff" },
  zoeEmily: { label: "Zoe and Emily", color: "#d8b873" },
};

function buildClientFunnels(
  selectedClient: Client,
  metricsMap: Partial<Record<ClientKey, ManychatMetrics>>,
): ClientFunnel[] {
  const clientKeys: ClientKey[] =
    selectedClient === "all" ? ["tyson", "keith", "zoeEmily"] : [selectedClient];

  return clientKeys
    .map((key) => {
      const metrics = metricsMap[key];
      if (!metrics) return null;

      return {
        key,
        label: CLIENT_META[key].label,
        color: CLIENT_META[key].color,
        stages: metrics.funnel,
      };
    })
    .filter((funnel): funnel is ClientFunnel => Boolean(funnel));
}

function aggregateFunnels(clientFunnels: ClientFunnel[]): RenderStage[] {
  if (clientFunnels.length === 0) return [];

  const baseStages = clientFunnels[0].stages;

  return baseStages.map((stage, index) => ({
    id: stage.id,
    label: stage.label,
    count: clientFunnels.reduce((sum, funnel) => sum + (funnel.stages[index]?.count || 0), 0),
    tracked: clientFunnels.some((funnel) => funnel.stages[index]?.tracked),
  }));
}

function getRetention(current: RenderStage, previous?: RenderStage): number | null {
  if (!previous || !current.tracked || !previous.tracked || previous.count <= 0) return null;
  return (current.count / previous.count) * 100;
}

function getStageRatio(stage: RenderStage, baseline: number) {
  if (!stage.tracked) return 0.08;
  if (baseline <= 0) return stage.count > 0 ? 0.14 : 0.08;
  if (stage.count <= 0) return 0.08;
  return Math.max(0.12, Math.min(1, stage.count / baseline));
}

function buildPolygonPoints(
  stages: RenderStage[],
  baseline: number,
  width: number,
  height: number,
  compact: boolean,
) {
  const paddingX = compact ? 10 : 12;
  const slot = (width - paddingX * 2) / stages.length;
  const centerY = height * 0.62;
  const minHalf = compact ? 10 : 14;
  const maxHalf = compact ? 30 : 44;
  const top: string[] = [];
  const bottom: string[] = [];

  stages.forEach((stage, index) => {
    const ratio = getStageRatio(stage, baseline);
    const half = minHalf + (maxHalf - minHalf) * ratio;
    const left = paddingX + index * slot;
    const right = paddingX + (index + 1) * slot;

    top.push(`${left},${centerY - half}`, `${right},${centerY - half}`);
    bottom.unshift(`${right},${centerY + half}`, `${left},${centerY + half}`);
  });

  return top.concat(bottom).join(" ");
}

function ConnectedFunnel({
  title,
  subtitle,
  stages,
  color,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  stages: RenderStage[];
  color: string;
  compact?: boolean;
}) {
  const baseline = stages.find((stage) => stage.tracked && stage.count > 0)?.count || 0;
  const minWidth = compact ? 980 : 1220;
  const graphHeight = compact ? 118 : 150;
  const paddingX = compact ? 10 : 12;
  const slot = (minWidth - paddingX * 2) / stages.length;
  const centerY = graphHeight * 0.62;
  const polygonPoints = buildPolygonPoints(stages, baseline, minWidth, graphHeight, compact);
  const gradientId = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${compact ? "compact" : "full"}`;

  return (
    <div className="glass-static" style={{ padding: compact ? 14 : 18, overflowX: "auto" }}>
      <div style={{ marginBottom: compact ? 12 : 14 }}>
        <div style={{ fontSize: compact ? 13 : 15, fontWeight: 700, color: "var(--text-primary)" }}>
          {title}
        </div>
        {subtitle ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            {subtitle}
          </div>
        ) : null}
      </div>

      <div style={{ minWidth }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${stages.length}, minmax(${compact ? 100 : 118}px, 1fr))`,
            gap: 0,
            marginBottom: 8,
          }}
        >
          {stages.map((stage) => (
            <div key={stage.id} style={{ paddingRight: compact ? 8 : 10 }}>
              <div
                style={{
                  fontSize: compact ? 11 : 12,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: 4,
                }}
              >
                {stage.label}
              </div>
              <div
                style={{
                  fontSize: compact ? 20 : 24,
                  fontWeight: 800,
                  color: stage.tracked ? "var(--text-primary)" : "var(--text-muted)",
                  lineHeight: 1,
                }}
              >
                {stage.tracked ? fmtNumber(stage.count) : "—"}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            position: "relative",
            height: graphHeight,
            borderRadius: 14,
            overflow: "hidden",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <svg
            width={minWidth}
            height={graphHeight}
            viewBox={`0 0 ${minWidth} ${graphHeight}`}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
                <stop offset="0%" stopColor={color} stopOpacity="0.65" />
                <stop offset="55%" stopColor={color} stopOpacity="0.92" />
                <stop offset="100%" stopColor={color} stopOpacity="0.75" />
              </linearGradient>
            </defs>

            {stages.map((_, index) => {
              if (index === 0) return null;
              const x = paddingX + index * slot;
              return (
                <line
                  key={`divider-${index}`}
                  x1={x}
                  x2={x}
                  y1={8}
                  y2={graphHeight - 8}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1"
                />
              );
            })}

            <line
              x1={paddingX}
              x2={minWidth - paddingX}
              y1={centerY}
              y2={centerY}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />

            <polygon points={polygonPoints} fill={`url(#${gradientId})`} />
          </svg>

          {stages.map((stage, index) => {
            const previous = index > 0 ? stages[index - 1] : undefined;
            const retention = getRetention(stage, previous);
            const label =
              retention !== null
                ? fmtPercent(retention, 0)
                : index === 0
                  ? "Start"
                  : stage.tracked
                    ? "—"
                    : "—";

            return (
              <div
                key={`badge-${stage.id}`}
                style={{
                  position: "absolute",
                  left: paddingX + index * slot,
                  width: slot,
                  top: centerY - (compact ? 14 : 16),
                  display: "flex",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    padding: compact ? "4px 8px" : "5px 10px",
                    borderRadius: 999,
                    background: "rgba(12,12,16,0.78)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    boxShadow: "0 6px 20px rgba(0,0,0,0.22)",
                    color: "white",
                    fontSize: compact ? 10 : 11,
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  {label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function DMFunnels({
  selectedClient,
  metricsMap,
  loading,
  error,
}: DMFunnelsProps) {
  if (loading) return null;
  if (error) return null;

  const clientFunnels = buildClientFunnels(selectedClient, metricsMap);
  if (clientFunnels.length === 0) return null;

  const allClientStages = aggregateFunnels(clientFunnels);

  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "1px",
          color: "var(--text-muted)",
          fontWeight: 600,
        }}
      >
        <Tag size={12} />
        DM Funnel
      </div>

      {selectedClient === "all" && (
        <ConnectedFunnel
          title="All Clients"
          subtitle="New lead → challenge sent → replied → in discovery → call link sent → booked"
          stages={allClientStages}
          color="#2f6fff"
        />
      )}

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        {clientFunnels.map((funnel) => (
          <ConnectedFunnel
            key={funnel.key}
            title={funnel.label}
            subtitle="Compact client funnel"
            stages={funnel.stages}
            color={funnel.color}
            compact
          />
        ))}
      </div>

      <div
        className="glass-static"
        style={{
          marginTop: 14,
          padding: "12px 14px",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <Link2 size={14} style={{ color: "var(--accent)", marginTop: 1 }} />
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>
          New lead, Replied, Call link sent, and Booked come from live ManyChat and GHL events.
          Challenge sent is detected from outbound Skool links in the DM. In discovery is an AI
          read of whether the lead opened up substantively after the discovery voice note.
        </div>
      </div>
    </div>
  );
}
