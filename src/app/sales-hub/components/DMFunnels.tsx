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

function HorizontalFunnel({
  stages,
}: {
  stages: RenderStage[];
}) {
  const firstTracked = stages.find((stage) => stage.tracked && stage.count > 0);
  const baseline = firstTracked?.count || 0;

  return (
    <div
      className="glass-static"
      style={{
        padding: 18,
        marginTop: 16,
        overflowX: "auto",
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "1px",
          color: "var(--text-muted)",
          fontWeight: 600,
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <BarChart3 size={12} />
        All Clients Funnel
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${stages.length}, minmax(110px, 1fr))`,
          gap: 10,
          minWidth: 1120,
        }}
      >
        {stages.map((stage, index) => {
          const previous = index > 0 ? stages[index - 1] : undefined;
          const retention = getRetention(stage, previous);
          const height =
            stage.tracked && baseline > 0
              ? Math.max(18, (stage.count / baseline) * 110)
              : 18;

          return (
            <div
              key={stage.id}
              style={{
                minHeight: 210,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                borderRadius: 12,
                border: stage.tracked
                  ? "1px solid var(--border-subtle)"
                  : "1px dashed rgba(255,255,255,0.12)",
                background: stage.tracked
                  ? "rgba(255,255,255,0.02)"
                  : "rgba(255,255,255,0.01)",
                padding: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                  {stage.label}
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: stage.tracked ? "var(--text-primary)" : "var(--text-muted)",
                    marginTop: 8,
                  }}
                >
                  {stage.tracked ? fmtNumber(stage.count) : "—"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                  {retention !== null
                    ? `${fmtPercent(retention, 0)} from prior`
                    : stage.tracked
                      ? index === 0
                        ? "Start"
                        : "No prior data"
                      : "Needs tag"}
                </div>
              </div>

              <div>
                <div
                  style={{
                    height,
                    borderRadius: 999,
                    background: stage.tracked
                      ? "linear-gradient(180deg, rgba(38,99,235,0.9), rgba(30,64,175,0.65))"
                      : "repeating-linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.06) 10px, rgba(255,255,255,0.02) 10px, rgba(255,255,255,0.02) 20px)",
                    border: stage.tracked ? "none" : "1px dashed rgba(255,255,255,0.12)",
                    transition: "height 0.2s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
        Gray steps still need ManyChat tags before they can show real drop-off.
      </div>
    </div>
  );
}

function VerticalClientFunnel({ funnel }: { funnel: ClientFunnel }) {
  const baseline = funnel.stages.find((stage) => stage.tracked && stage.count > 0)?.count || 0;

  return (
    <div className="glass-static" style={{ padding: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: funnel.color,
            }}
          />
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
            {funnel.label}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>
          Vertical funnel
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {funnel.stages.map((stage, index) => {
          const previous = index > 0 ? funnel.stages[index - 1] : undefined;
          const retention = getRetention(stage, previous);
          const width =
            stage.tracked && baseline > 0
              ? Math.max(14, (stage.count / baseline) * 100)
              : 100;

          return (
            <div key={stage.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  fontSize: 12,
                  marginBottom: 6,
                }}
              >
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{stage.label}</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {stage.tracked ? fmtNumber(stage.count) : "Needs tag"}
                </span>
              </div>

              <div
                style={{
                  height: 34,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.03)",
                  border: stage.tracked
                    ? "1px solid var(--border-subtle)"
                    : "1px dashed rgba(255,255,255,0.12)",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(width, 100)}%`,
                    height: "100%",
                    background: stage.tracked
                      ? `linear-gradient(90deg, ${funnel.color}, rgba(255,255,255,0.18))`
                      : "repeating-linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.06) 10px, rgba(255,255,255,0.02) 10px, rgba(255,255,255,0.02) 20px)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0 10px",
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: "white" }}>
                    {stage.tracked ? fmtNumber(stage.count) : "Tag needed"}
                  </span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.82)" }}>
                    {retention !== null ? fmtPercent(retention, 0) : stage.tracked ? "Start" : "Planned"}
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

      {selectedClient === "all" && <HorizontalFunnel stages={allClientStages} />}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            selectedClient === "all" ? "repeat(3, minmax(0, 1fr))" : "minmax(0, 1fr)",
          gap: 14,
          marginTop: 16,
        }}
      >
        {clientFunnels.map((funnel) => (
          <VerticalClientFunnel key={funnel.key} funnel={funnel} />
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
          This funnel is built from your DM script stages: new lead, engaged, journey, goal,
          current state, consequence, root problem, need labeled, money okay, link sent, and
          booked. Right now only the live tagged steps show real counts. The middle gray steps will
          fill in once you add the new ManyChat tags.
        </div>
      </div>
    </div>
  );
}
