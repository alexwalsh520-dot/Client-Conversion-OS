"use client";

import { ChangelogEntry } from "@/lib/mock-data";
import CategoryTag from "./CategoryTag";
import MetricDelta from "./MetricDelta";

const dotColors: Record<string, string> = {
  ad_creative: "var(--accent)",
  dm_script: "var(--tyson)",
  pricing: "var(--success)",
  team: "var(--warning)",
  process: "var(--keith)",
  offer: "var(--danger)",
};

interface TimelineEntryProps {
  entry: ChangelogEntry;
  isLast?: boolean;
}

export default function TimelineEntry({ entry, isLast }: TimelineEntryProps) {
  const dotColor = dotColors[entry.category] || "var(--text-muted)";

  const formattedDate = new Date(entry.date + "T00:00:00").toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    }
  );

  return (
    <div style={{ display: "flex", gap: 20 }}>
      {/* Timeline connector */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: 20,
          flexShrink: 0,
        }}
      >
        {/* Dot */}
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: `0 0 8px ${dotColor}`,
            marginTop: 24,
            flexShrink: 0,
          }}
        />
        {/* Line */}
        {!isLast && (
          <div
            style={{
              width: 2,
              flex: 1,
              background: "var(--border-primary)",
              marginTop: 4,
            }}
          />
        )}
      </div>

      {/* Card content */}
      <div className="glass" style={{ flex: 1, padding: 20, marginBottom: 0 }}>
        {/* Top row: date, category, added by */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              fontWeight: 500,
            }}
          >
            {formattedDate}
          </span>
          <CategoryTag category={entry.category} />
          <span
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              marginLeft: "auto",
            }}
          >
            Added by {entry.addedBy}
          </span>
        </div>

        {/* Description */}
        <p
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: "var(--text-primary)",
            marginTop: 8,
            lineHeight: 1.5,
          }}
        >
          {entry.description}
        </p>

        {/* Metric delta */}
        <div style={{ marginTop: 12 }}>
          <MetricDelta
            before={entry.metricBefore}
            after={entry.metricAfter}
            impactLabel={entry.impactLabel}
          />
        </div>
      </div>
    </div>
  );
}
