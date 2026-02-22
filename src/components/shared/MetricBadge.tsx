"use client";

import TrendIndicator from "./TrendIndicator";

interface MetricBadgeProps {
  label: string;
  value: string;
  trend?: { value: string; trend: "up" | "down" | "flat"; isGood: boolean };
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: { label: 10, value: 18 },
  md: { label: 11, value: 24 },
  lg: { label: 12, value: 32 },
};

export default function MetricBadge({
  label,
  value,
  trend,
  size = "md",
}: MetricBadgeProps) {
  const s = sizes[size];

  return (
    <div>
      <div
        style={{
          fontSize: s.label,
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: s.value,
          fontWeight: 700,
          color: "var(--text-primary)",
        }}
      >
        {value}
      </div>
      {trend && (
        <div style={{ marginTop: 4 }}>
          <TrendIndicator {...trend} />
        </div>
      )}
    </div>
  );
}
