"use client";

/**
 * Daily Coacher — topic selector.
 *
 * 14 topics in a grid. Topics elevated for the client's program phase get
 * the gold accent border + a "Suggested" badge; the coach can still pick
 * any topic — elevation is visual only.
 *
 * Order: phase-elevated topics first (in their phase priority order), then
 * everything else in TOPICS' default order. Stable so the layout doesn't
 * thrash.
 */

import type { ProgramProgress } from "@/lib/daily-coacher/summary-inputs";
import { TOPICS, type TopicKey } from "@/lib/daily-coacher/topics";
import { elevatedTopicsForPhase } from "@/lib/daily-coacher/phase-suggestions";

interface Props {
  phase: ProgramProgress["phase"];
  selectedKey: TopicKey | null;
  onSelect: (key: TopicKey) => void;
}

export default function TopicSelector({ phase, selectedKey, onSelect }: Props) {
  const elevated = elevatedTopicsForPhase(phase);
  const elevatedSet = new Set(elevated);

  // Elevated first (in phase priority), then everything else in default order.
  const ordered: TopicKey[] = [
    ...elevated,
    ...TOPICS.map((t) => t.key).filter((k) => !elevatedSet.has(k)),
  ];

  return (
    <div className="glass-static" style={{ padding: 20, borderRadius: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          Topic
        </span>
        {elevated.length > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            <span style={{ color: "var(--accent)" }}>●</span> = suggested for this phase
          </span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 8,
        }}
      >
        {ordered.map((key) => {
          const t = TOPICS.find((x) => x.key === key)!;
          const isSelected = selectedKey === key;
          const isElevated = elevatedSet.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 8,
                border: isSelected
                  ? "1px solid var(--accent)"
                  : isElevated
                    ? "1px solid rgba(201, 169, 110, 0.3)"
                    : "1px solid var(--border-primary)",
                background: isSelected ? "var(--accent-soft)" : "var(--bg-glass)",
                color: "var(--text-primary)",
                cursor: "pointer",
                fontSize: 12,
                lineHeight: 1.4,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontWeight: 600,
                  color: isSelected || isElevated ? "var(--accent)" : "var(--text-primary)",
                }}
              >
                {isElevated && (
                  <span style={{ color: "var(--accent)", fontSize: 8 }}>●</span>
                )}
                {t.label}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {t.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
