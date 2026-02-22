"use client";

import { useState } from "react";
import {
  Brain,
  AlertTriangle,
  Lightbulb,
  TrendingUp,
  Sliders,
} from "lucide-react";
import { businessHealth } from "@/lib/mock-data";
import { modelAdSpendScenario } from "@/lib/intelligence-engine";
import { fmtDollars, fmtNumber } from "@/lib/formatters";

export default function IntelligencePage() {
  const [adSpend, setAdSpend] = useState(5000);
  const scenario = modelAdSpendScenario(adSpend);

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">AI Brain</h1>
        <p className="page-subtitle">
          Business health analysis, constraints, and scenario modeling
        </p>
      </div>

      {/* Business Health Score */}
      <div className="section">
        <div
          className="glass-static"
          style={{
            padding: 32,
            textAlign: "center",
          }}
        >
          <div className="metric-card-label">Business Health Score</div>
          <div
            className="gradient-text"
            style={{
              fontSize: 72,
              fontWeight: 800,
              lineHeight: 1,
              marginTop: 8,
            }}
          >
            {businessHealth.score}
          </div>
          <div
            className="metric-card-trend metric-card-trend-up"
            style={{ marginTop: 12 }}
          >
            <TrendingUp
              size={14}
              style={{ display: "inline", verticalAlign: "middle" }}
            />{" "}
            Trending up
          </div>
        </div>
      </div>

      {/* Constraints & Opportunities */}
      <div className="metric-grid metric-grid-2 section">
        {/* Constraints */}
        <div>
          <h2 className="section-title">
            <AlertTriangle size={16} />
            Constraints
          </h2>
          {businessHealth.constraints.map((constraint, i) => (
            <div
              key={i}
              className="glass-static"
              style={{
                padding: 14,
                marginBottom: 10,
                borderLeft: "3px solid var(--danger)",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                {constraint}
              </div>
            </div>
          ))}
        </div>

        {/* Opportunities */}
        <div>
          <h2 className="section-title">
            <Lightbulb size={16} />
            Opportunities
          </h2>
          {businessHealth.opportunities.map((opportunity, i) => (
            <div
              key={i}
              className="glass-static"
              style={{
                padding: 14,
                marginBottom: 10,
                borderLeft: "3px solid var(--success)",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                {opportunity}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scenario Modeler */}
      <div className="section">
        <h2 className="section-title">
          <Sliders size={16} />
          Ad Spend Scenario Modeler
        </h2>
        <div className="glass-static" style={{ padding: 24 }}>
          <div style={{ marginBottom: 20 }}>
            <div className="form-label">
              Monthly Ad Spend: {fmtDollars(adSpend)}
            </div>
            <input
              type="range"
              min={1000}
              max={15000}
              step={500}
              value={adSpend}
              onChange={(e) => setAdSpend(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--accent)" }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--text-muted)",
                marginTop: 4,
              }}
            >
              <span>$1,000</span>
              <span>$15,000</span>
            </div>
          </div>

          <div className="metric-grid metric-grid-3">
            <div
              className="glass-subtle"
              style={{ padding: 16, textAlign: "center" }}
            >
              <div className="metric-card-label">Projected Revenue</div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: "var(--success)",
                  marginTop: 4,
                }}
              >
                {fmtDollars(scenario.projectedRevenue)}
              </div>
            </div>
            <div
              className="glass-subtle"
              style={{ padding: 16, textAlign: "center" }}
            >
              <div className="metric-card-label">Projected New Clients</div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: "var(--accent)",
                  marginTop: 4,
                }}
              >
                {fmtNumber(scenario.projectedNewClients)}
              </div>
            </div>
            <div
              className="glass-subtle"
              style={{ padding: 16, textAlign: "center" }}
            >
              <div className="metric-card-label">Revenue Increase</div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color:
                    scenario.revenueIncrease >= 0
                      ? "var(--success)"
                      : "var(--danger)",
                  marginTop: 4,
                }}
              >
                {scenario.revenueIncrease >= 0 ? "+" : ""}
                {fmtDollars(scenario.revenueIncrease)}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 16,
              fontSize: 12,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            Current spend: {fmtDollars(scenario.currentSpend)} | Current ROI:{" "}
            {scenario.currentROI}% | Model includes diminishing returns
          </div>
        </div>
      </div>
    </div>
  );
}
