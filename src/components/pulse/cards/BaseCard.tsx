"use client";

import TrendIndicator from "@/components/shared/TrendIndicator";
import { CARD_COLORS } from "@/lib/constants";

interface BaseCardProps {
  type: "alert" | "opportunity" | "win" | "experiment" | "bottleneck";
  title: string;
  body: string;
  metric: {
    label: string;
    value: string;
    trend: "up" | "down" | "flat";
    isGood: boolean;
  };
  impactLabel: string;
  actions: { label: string; type: string; payload: string }[];
}

const TYPE_LABELS: Record<string, string> = {
  alert: "ALERT",
  opportunity: "OPPORTUNITY",
  win: "WIN",
  experiment: "EXPERIMENT",
  bottleneck: "BOTTLENECK",
};

const TYPE_SOFT_COLORS: Record<string, string> = {
  alert: "var(--danger-soft)",
  opportunity: "var(--success-soft)",
  win: "var(--accent-soft)",
  experiment: "var(--tyson-soft)",
  bottleneck: "var(--warning-soft)",
};

export default function BaseCard({
  type,
  title,
  body,
  metric,
  impactLabel,
  actions,
}: BaseCardProps) {
  const borderColor = CARD_COLORS[type];

  return (
    <div
      className={`glass card-${type}`}
      style={{ padding: 24, cursor: "pointer" }}
    >
      {/* Type badge + impact */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.8px",
            padding: "3px 8px",
            borderRadius: 4,
            background: TYPE_SOFT_COLORS[type],
            color: borderColor,
          }}
        >
          {TYPE_LABELS[type]}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: borderColor,
          }}
        >
          {impactLabel}
        </span>
      </div>

      {/* Title */}
      <h3
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--text-primary)",
          marginTop: 12,
          lineHeight: 1.3,
        }}
      >
        {title}
      </h3>

      {/* Body */}
      <p
        style={{
          fontSize: 14,
          color: "var(--text-secondary)",
          lineHeight: 1.6,
          marginTop: 8,
        }}
      >
        {body}
      </p>

      {/* Metric */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 16,
          padding: "10px 14px",
          borderRadius: 8,
          background: "var(--bg-glass)",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.3px",
          }}
        >
          {metric.label}
        </span>
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          {metric.value}
        </span>
        <TrendIndicator
          value=""
          trend={metric.trend}
          isGood={metric.isGood}
        />
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {actions.map((action, i) => (
          <button
            key={i}
            style={{
              fontSize: 12,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background:
                i === 0 ? "var(--accent-soft)" : "var(--bg-glass)",
              color:
                i === 0 ? "var(--accent)" : "var(--text-secondary)",
              transition: "all 0.15s ease",
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
