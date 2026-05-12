"use client";

/**
 * Daily Coacher — per-client usage score, surfaced as a tight row between
 * the persistent summary and the topic selector.
 *
 * Mirrors the score formula on the Coach Performance tab:
 *   events = (Copy clicks) + (client_notes rows) + (coach_meetings with non-empty notes)
 *   score  = min(10, events * 0.5)
 *
 * Display goal: scannable at a glance, with the breakdown one-glance away
 * so the coach can see which input is driving (or stalling) the score.
 */

import { Sparkles } from "lucide-react";

interface Props {
  scoreRounded: number;
  totalEvents: number;
  capped: boolean;
  tipUses: number;
  notes: number;
  meetingsWithNotes: number;
}

export default function ClientScoreRow({
  scoreRounded,
  totalEvents,
  capped,
  tipUses,
  notes,
  meetingsWithNotes,
}: Props) {
  const scoreColor = scoreRounded >= 7
    ? "var(--success)"
    : scoreRounded >= 4
      ? "var(--accent)"
      : scoreRounded >= 1
        ? "var(--warning)"
        : "var(--text-muted)";

  return (
    <div
      className="glass-static"
      style={{
        marginTop: 16,
        padding: "12px 16px",
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Sparkles size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          Daily Coacher Score
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: scoreColor }}>
          {scoreRounded}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>/ 10</span>
        {capped && (
          <span
            style={{
              marginLeft: 6,
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 4,
              background: "var(--success-soft)",
              color: "var(--success)",
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Maxed
          </span>
        )}
      </div>

      {/* Breakdown — sits to the right, wraps below on narrow screens */}
      <div
        style={{
          display: "flex",
          gap: 14,
          fontSize: 12,
          color: "var(--text-muted)",
          marginLeft: "auto",
          flexWrap: "wrap",
        }}
      >
        <BreakdownItem label="Tips copied" value={tipUses} />
        <BreakdownItem label="Notes" value={notes} />
        <BreakdownItem label="Meetings" value={meetingsWithNotes} />
        <BreakdownItem label="Total events" value={totalEvents} muted />
      </div>
    </div>
  );
}

function BreakdownItem({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      <strong
        style={{
          color: muted
            ? "var(--text-muted)"
            : value > 0
              ? "var(--text-secondary)"
              : "var(--text-muted)",
          fontWeight: 600,
        }}
      >
        {value}
      </strong>
      <span>{label}</span>
    </span>
  );
}
