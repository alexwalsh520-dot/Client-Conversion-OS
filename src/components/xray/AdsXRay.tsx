"use client";

import { useState } from "react";
import {
  adPerformance,
  monthlyAdsRollupByMonth,
  adSpendTrend,
} from "@/lib/mock-data";
import { modelAdSpendScenario } from "@/lib/intelligence-engine";
import {
  AreaChart,
  Area,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

export default function AdsXRay() {
  const totalSpend = adPerformance.keith.spend + adPerformance.tyson.spend;
  const totalRevenue =
    adPerformance.keith.revenue + adPerformance.tyson.revenue;
  const roi = Math.round((totalRevenue / totalSpend) * 100);
  const totalLeads = adPerformance.keith.leads + adPerformance.tyson.leads;
  const blendedCPL = (totalSpend / totalLeads).toFixed(2);

  // Scenario modeler state
  const [scenarioSpend, setScenarioSpend] = useState(totalSpend);
  const scenario = modelAdSpendScenario(scenarioSpend);

  // ROI trend data from monthly rollups
  const roiTrend = monthlyAdsRollupByMonth.map((m) => ({
    month: m.month.replace("2026-", ""),
    roi: m.collectedROI,
    spend: m.adSpend,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Monthly Summary */}
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
          February Ad Performance
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Total Spend
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--text-primary)",
                marginTop: 2,
              }}
            >
              ${totalSpend.toLocaleString()}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Revenue
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--success)",
                marginTop: 2,
              }}
            >
              ${(totalRevenue / 1000).toFixed(1)}K
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Blended ROI
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--accent)",
                marginTop: 2,
              }}
            >
              {roi}%
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Cost/Lead
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "var(--text-primary)",
                marginTop: 2,
              }}
            >
              ${blendedCPL}
            </div>
          </div>
        </div>

        {/* Keith vs Tyson split */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginTop: 20,
          }}
        >
          {(["keith", "tyson"] as const).map((client) => {
            const data = adPerformance[client];
            return (
              <div
                key={client}
                className="glass-subtle"
                style={{ padding: 16, borderRadius: 10 }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color:
                      client === "keith"
                        ? "var(--keith)"
                        : "var(--tyson)",
                    marginBottom: 8,
                    textTransform: "capitalize",
                  }}
                >
                  {client}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <div>
                    <span style={{ color: "var(--text-muted)" }}>Spend: </span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      ${data.spend.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-muted)" }}>Rev: </span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      ${(data.revenue / 1000).toFixed(1)}K
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-muted)" }}>CPL: </span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      ${data.cpl.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-muted)" }}>ROAS: </span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {data.roas.toFixed(1)}x
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Spend Trend Chart */}
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
          Spend Trend (Monthly)
        </div>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={adSpendTrend}>
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number | undefined) => [
                  `$${(value ?? 0).toLocaleString()}`,
                  "",
                ]}
              />
              <Bar
                dataKey="keith"
                fill="var(--keith)"
                radius={[4, 4, 0, 0]}
                stackId="a"
              />
              <Bar
                dataKey="tyson"
                fill="var(--tyson)"
                radius={[4, 4, 0, 0]}
                stackId="a"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Scenario Modeler */}
      <div className="glass glow-accent" style={{ padding: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: "var(--accent)",
            marginBottom: 16,
          }}
        >
          Ad Spend Scenario Modeler
        </div>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            marginBottom: 20,
            lineHeight: 1.5,
          }}
        >
          Drag the slider to model what happens if you increase or decrease ad
          spend. Accounts for diminishing returns at higher spend levels.
        </p>

        {/* Slider */}
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              $1,000
            </span>
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "var(--accent)",
              }}
            >
              ${scenarioSpend.toLocaleString()}/mo
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              $15,000
            </span>
          </div>
          <input
            type="range"
            min={1000}
            max={15000}
            step={250}
            value={scenarioSpend}
            onChange={(e) => setScenarioSpend(Number(e.target.value))}
            style={{
              width: "100%",
              accentColor: "var(--accent)",
              cursor: "pointer",
            }}
          />
        </div>

        {/* Projections */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
          }}
        >
          <div className="glass-subtle" style={{ padding: 16, borderRadius: 10 }}>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Projected Revenue
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--success)",
                marginTop: 4,
              }}
            >
              ${(scenario.projectedRevenue / 1000).toFixed(1)}K
            </div>
            {scenario.revenueIncrease > 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--success)",
                  marginTop: 2,
                }}
              >
                +${(scenario.revenueIncrease / 1000).toFixed(1)}K vs current
              </div>
            )}
            {scenario.revenueIncrease < 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--danger)",
                  marginTop: 2,
                }}
              >
                -${(Math.abs(scenario.revenueIncrease) / 1000).toFixed(1)}K vs
                current
              </div>
            )}
          </div>
          <div className="glass-subtle" style={{ padding: 16, borderRadius: 10 }}>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              Projected ROI
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color:
                  scenario.currentROI > 300
                    ? "var(--accent)"
                    : "var(--warning)",
                marginTop: 4,
              }}
            >
              {Math.round(
                (scenario.projectedRevenue / scenario.newSpend) * 100
              )}
              %
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginTop: 2,
              }}
            >
              Currently {scenario.currentROI}%
            </div>
          </div>
          <div className="glass-subtle" style={{ padding: 16, borderRadius: 10 }}>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-muted)",
                fontWeight: 600,
              }}
            >
              New Clients
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--text-primary)",
                marginTop: 4,
              }}
            >
              ~{scenario.projectedNewClients}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginTop: 2,
              }}
            >
              per month
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
