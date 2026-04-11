"use client";

import { BarChart3, Link2, Tag } from "lucide-react";
import { fmtNumber, fmtPercent } from "@/lib/formatters";
import type { Client, ManychatFunnelStage, ManychatMetrics } from "../types";

type ClientKey = Exclude<Client, "all">;

interface DMFunnelsProps {
  selectedClient: Client;
  metricsMap: Partial<Record<ClientKey, ManychatMetrics>>;
  bookedCounts: Partial<Record<ClientKey, number>>;
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
  tyson: { label: "Tyson Sonnek", color: "var(--tyson)" },
  keith: { label: "Keith Holland", color: "var(--keith)" },
  zoeEmily: { label: "Zoe and Emily", color: "var(--accent)" },
};

function buildBookedStage(count: number): RenderStage {
  return {
    id: "booked",
    label: "Booked",
    count,
    tracked: true,
  };
}

function buildClientFunnels(
  selectedClient: Client,
  metricsMap: Partial<Record<ClientKey, ManychatMetrics>>,
  bookedCounts: Partial<Record<ClientKey, number>>,
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
        stages: [...metrics.funnel, buildBookedStage(bookedCounts[key] || 0)],
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

function stageWidth(stage: RenderStage, baseline: number) {
  if (!stage.tracked || baseline <= 0) return 100;
  return Math.max(14, (stage.count / baseline) * 100);
}

function stageFill(stage: RenderStage, color: string) {
  return stage.tracked
    ? `linear-gradient(135deg, ${color}, rgba(255,255,255,0.14))`
    : "repeating-linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.06) 10px, rgba(255,255,255,0.02) 10px, rgba(255,255,255,0.02) 20px)";
}

function FunnelStrip({
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
  const minWidth = compact ? 920 : 1120;
  const segmentHeight = compact ? 64 : 88;

  return (
    <div className="glass-static" style={{ padding: compact ? 14 : 18, overflowX: "auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: compact ? 10 : 14,
          gap: 10,
        }}
      >
        <div>
          <div style={{ fontSize: compact ? 13 : 14, fontWeight: 700, color: "var(--text-primary)" }}>
            {title}
          </div>
          {subtitle ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${stages.length}, minmax(${compact ? 82 : 96}px, 1fr))`,
          gap: compact ? 6 : 8,
          minWidth,
          alignItems: "end",
        }}
      >
        {stages.map((stage, index) => {
          const previous = index > 0 ? stages[index - 1] : undefined;
          const retention = getRetention(stage, previous);
          const width = stageWidth(stage, baseline);

          return (
            <div key={stage.id} style={{ display: "grid", gap: compact ? 6 : 8 }}>
              <div style={{ minHeight: compact ? 38 : 48 }}>
                <div
                  style={{
                    fontSize: compact ? 11 : 12,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    marginBottom: 3,
                  }}
                >
                  {stage.label}
                </div>
                <div
                  style={{
                    fontSize: compact ? 18 : 22,
                    fontWeight: 800,
                    color: stage.tracked ? "var(--text-primary)" : "var(--text-muted)",
                    lineHeight: 1,
                  }}
                >
                  {stage.tracked ? fmtNumber(stage.count) : "—"}
                </div>
              </div>

              <div
                style={{
                  height: segmentHeight,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(width, 100)}%`,
                    height: "100%",
                    background: stageFill(stage, color),
                    border: stage.tracked
                      ? "1px solid rgba(255,255,255,0.08)"
                      : "1px dashed rgba(255,255,255,0.14)",
                    clipPath:
                      index === 0
                        ? "polygon(0 0, 100% 6%, 100% 94%, 0 100%)"
                        : "polygon(6% 0, 100% 8%, 100% 92%, 6% 100%, 0 50%)",
                    borderRadius: 8,
                    boxShadow: stage.tracked
                      ? "inset 0 1px 0 rgba(255,255,255,0.12)"
                      : "none",
                    transition: "width 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 8px",
                    textAlign: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: compact ? 10 : 11,
                      fontWeight: 700,
                      color: stage.tracked ? "white" : "var(--text-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {retention !== null
                      ? fmtPercent(retention, 0)
                      : stage.tracked
                        ? index === 0
                          ? "Start"
                          : "—"
                        : "Needs tag"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DMFunnels({
  selectedClient,
  metricsMap,
  bookedCounts,
  loading,
  error,
}: DMFunnelsProps) {
  if (loading) return null;
  if (error) return null;

  const clientFunnels = buildClientFunnels(selectedClient, metricsMap, bookedCounts);
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
        <FunnelStrip
          title="All Clients"
          subtitle="Top stage is widest. Each step narrows as leads drop."
          stages={allClientStages}
          color="rgba(37, 99, 235, 0.92)"
        />
      )}

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        {clientFunnels.map((funnel) => (
          <FunnelStrip
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
          Gray funnel steps still need ManyChat tags. Once those tags are firing, these strips will
          show the real drop-off point by stage and by client.
        </div>
      </div>
    </div>
  );
}
