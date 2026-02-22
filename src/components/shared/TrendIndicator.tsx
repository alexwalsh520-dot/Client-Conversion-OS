"use client";

interface TrendIndicatorProps {
  value: string;
  trend: "up" | "down" | "flat";
  isGood: boolean;
}

export default function TrendIndicator({ value, trend, isGood }: TrendIndicatorProps) {
  const color =
    trend === "flat"
      ? "var(--text-muted)"
      : (trend === "up") === isGood
        ? "var(--success)"
        : "var(--danger)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 13,
        fontWeight: 600,
        color,
      }}
    >
      {trend !== "flat" && (
        <svg width="8" height="6" viewBox="0 0 8 6" fill="currentColor">
          {trend === "up" ? (
            <polygon points="4,0 8,6 0,6" />
          ) : (
            <polygon points="4,6 0,0 8,0" />
          )}
        </svg>
      )}
      {value}
    </span>
  );
}
