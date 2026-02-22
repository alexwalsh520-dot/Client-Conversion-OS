"use client";

import { funnelStages } from "@/lib/mock-data";

const FUNNEL_COLORS = [
  "var(--accent)",
  "#818cf8",
  "var(--tyson)",
  "var(--success)",
  "#fbbf24",
];

export default function FunnelXRay() {
  const stages = funnelStages.map((s) => ({
    ...s,
    total: s.keith + s.tyson,
  }));
  const maxVal = stages[0]?.total || 1;

  // Find worst conversion
  let worstIdx = -1;
  let worstRate = 100;
  for (let i = 1; i < stages.length; i++) {
    const rate = (stages[i].total / stages[i - 1].total) * 100;
    if (rate < worstRate) {
      worstRate = rate;
      worstIdx = i;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Funnel Visualization */}
      <div className="glass" style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--text-muted)",
            marginBottom: 20,
          }}
        >
          Funnel Breakdown
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {stages.map((stage, i) => {
            const width = Math.max((stage.total / maxVal) * 100, 8);
            const convRate =
              i > 0
                ? ((stage.total / stages[i - 1].total) * 100).toFixed(1)
                : null;
            const isBottleneck = i === worstIdx;

            return (
              <div key={stage.stage}>
                {convRate && (
                  <div
                    style={{
                      fontSize: 11,
                      color: isBottleneck
                        ? "var(--danger)"
                        : "var(--text-muted)",
                      fontWeight: isBottleneck ? 700 : 400,
                      marginBottom: 4,
                      paddingLeft: 4,
                    }}
                  >
                    {convRate}% conversion
                    {isBottleneck && " ← BOTTLENECK"}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: `${width}%`,
                      height: 36,
                      borderRadius: 8,
                      background: FUNNEL_COLORS[i],
                      opacity: isBottleneck ? 1 : 0.7,
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: 12,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "white",
                      border: isBottleneck
                        ? "2px solid var(--danger)"
                        : "none",
                      transition: "all 0.2s ease",
                      minWidth: 80,
                    }}
                  >
                    {stage.stage}
                  </div>
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      minWidth: 50,
                    }}
                  >
                    {stage.total.toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottleneck Analysis */}
      {worstIdx > 0 && (
        <div className="glass card-bottleneck" style={{ padding: 24 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "var(--warning)",
              marginBottom: 8,
            }}
          >
            Biggest Funnel Leak
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {stages[worstIdx - 1].stage} → {stages[worstIdx].stage}
          </div>
          <div
            style={{
              fontSize: 14,
              color: "var(--text-secondary)",
              marginTop: 8,
              lineHeight: 1.6,
            }}
          >
            Only {worstRate.toFixed(1)}% of{" "}
            {stages[worstIdx - 1].stage.toLowerCase()} convert to{" "}
            {stages[worstIdx].stage.toLowerCase()}.{" "}
            {stages[worstIdx - 1].total - stages[worstIdx].total} drop off at
            this stage. At ~$1,100 avg deal value, each lost conversion costs
            ~$700.
          </div>
        </div>
      )}

      {/* Keith vs Tyson Split */}
      <div className="glass" style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--text-muted)",
            marginBottom: 16,
          }}
        >
          Client Split
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          {stages.map((stage) => (
            <div key={stage.stage} style={{ display: "flex", gap: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  minWidth: 100,
                }}
              >
                {stage.stage}
              </span>
              <span style={{ fontSize: 13, color: "var(--keith)" }}>
                K: {stage.keith}
              </span>
              <span style={{ fontSize: 13, color: "var(--tyson)" }}>
                T: {stage.tyson}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
