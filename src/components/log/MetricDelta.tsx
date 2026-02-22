"use client";

import { ArrowRight } from "lucide-react";

interface MetricDeltaProps {
  before: { label: string; value: string };
  after: { label: string; value: string } | null;
  impactLabel: string | null;
}

export default function MetricDelta({
  before,
  after,
  impactLabel,
}: MetricDeltaProps) {
  if (!after) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.3px",
                fontWeight: 600,
              }}
            >
              Before
            </span>
            <span
              style={{
                marginLeft: 6,
                fontSize: 13,
                color: "var(--text-secondary)",
                fontWeight: 500,
              }}
            >
              {before.value}
            </span>
          </div>
          <span
            className="soft-pulse"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--warning)",
              background: "var(--warning-soft)",
              padding: "3px 10px",
              borderRadius: 4,
            }}
          >
            Measuring...
          </span>
        </div>
        {impactLabel && (
          <span
            style={{
              fontSize: 13,
              color: "var(--warning)",
              fontWeight: 500,
              fontStyle: "italic",
            }}
          >
            {impactLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.3px",
              fontWeight: 600,
            }}
          >
            Before
          </span>
          <span
            style={{
              marginLeft: 6,
              fontSize: 13,
              color: "var(--text-secondary)",
              fontWeight: 500,
            }}
          >
            {before.value}
          </span>
        </div>
        <ArrowRight
          size={14}
          style={{ color: "var(--text-muted)", flexShrink: 0 }}
        />
        <div>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.3px",
              fontWeight: 600,
            }}
          >
            After
          </span>
          <span
            style={{
              marginLeft: 6,
              fontSize: 13,
              color: "var(--success)",
              fontWeight: 600,
            }}
          >
            {after.value}
          </span>
        </div>
      </div>
      {impactLabel && (
        <span
          style={{
            fontSize: 13,
            color: "var(--success)",
            fontWeight: 600,
          }}
        >
          {impactLabel}
        </span>
      )}
    </div>
  );
}
