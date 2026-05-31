"use client";

import { useEffect, useState } from "react";

// Subtle month-to-date AI spend meter against a $50 budget. Deliberately
// understated — a thin bar + one line of text. Reads from /api/ai-usage, which
// returns real totals (never a fabricated number). If the fetch fails or there
// is no data, it shows "$0.00 / $50" rather than a spinner or a guess.

type UsageResponse = {
  monthSpendUsd: number;
  budgetUsd: number;
  pct: number;
};

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Gold under budget; warms toward red as it approaches the cap. Uses the same
// palette tokens the rest of Settings uses so it never invents a new look.
function fillColor(pct: number): string {
  if (pct >= 90) return "var(--danger)";
  if (pct >= 75) return "var(--warning)";
  return "var(--accent)";
}

export default function AiUsageMeter() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai-usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d && typeof d.monthSpendUsd === "number" && typeof d.budgetUsd === "number") {
          setData(d as UsageResponse);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Until the first response (or on any failure) fall back to a trustworthy zero
  // state — never a fabricated value, never a stuck spinner.
  const budget = data?.budgetUsd ?? 50;
  const spend = done ? data?.monthSpendUsd ?? 0 : 0;
  const pct = done ? Math.max(0, Math.min(100, data?.pct ?? 0)) : 0;

  return (
    <div
      className="glass-static"
      style={{
        padding: 20,
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
          gap: 12,
        }}
      >
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>AI usage this month</span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          ${fmt(spend)} / ${fmt(budget)}
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 4,
          background: "var(--border)",
          overflow: "hidden",
        }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="AI usage this month"
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: fillColor(pct),
            borderRadius: 4,
            transition: "width 0.4s ease, background 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}
