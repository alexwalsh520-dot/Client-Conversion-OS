"use client";

import React, { useMemo, useState } from "react";
import type { JSX } from "react";

export type DateRange = { from: string; to: string }; // YYYY-MM-DD inclusive

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const PRESETS: { key: string; label: string; days: number | "all" }[] = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "12mo", label: "12mo", days: 365 },
  { key: "all", label: "All", days: "all" },
];

// Format a Date in local time as YYYY-MM-DD.
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse a YYYY-MM-DD string into a local-time Date (midnight local).
function parse(s: string): Date {
  const parts = s.split("-").map((n) => parseInt(n, 10));
  const y = parts[0] || 1970;
  const m = parts[1] || 1;
  const d = parts[2] || 1;
  return new Date(y, m - 1, d);
}

function todayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function presetRange(days: number | "all"): DateRange {
  const today = todayLocal();
  const to = fmt(today);
  if (days === "all") {
    return { from: "2000-01-01", to };
  }
  const from = fmt(addDays(today, -(days - 1)));
  return { from, to };
}

// Build the 6x7 grid of dates for a visible month (Sunday-first).
function monthGrid(viewYear: number, viewMonth: number): Date[] {
  const first = new Date(viewYear, viewMonth, 1);
  const startOffset = first.getDay(); // 0=Sun
  const gridStart = addDays(first, -startOffset);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(addDays(gridStart, i));
  }
  return cells;
}

export default function CalendarRange({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}): JSX.Element {
  const anchor = useMemo(() => parse(value.to), [value.to]);
  const [view, setView] = useState<{ y: number; m: number }>({
    y: anchor.getFullYear(),
    m: anchor.getMonth(),
  });

  // Tracks whether the next click starts a fresh range or closes the current one.
  const [selecting, setSelecting] = useState<boolean>(false);

  const today = useMemo(() => todayLocal(), []);
  const todayStr = fmt(today);

  const cells = useMemo(() => monthGrid(view.y, view.m), [view.y, view.m]);

  const fromDate = parse(value.from);
  const toDate = parse(value.to);

  function moveMonth(delta: number): void {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  function handleDayClick(d: Date): void {
    const clicked = fmt(d);
    if (!selecting) {
      // First click: start a new range at this day.
      onChange({ from: clicked, to: clicked });
      setSelecting(true);
      return;
    }
    // Second click: close the range, ordering endpoints.
    const start = value.from;
    let a = start;
    let b = clicked;
    if (parse(b).getTime() < parse(a).getTime()) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    onChange({ from: a, to: b });
    setSelecting(false);
  }

  function applyPreset(days: number | "all"): void {
    const r = presetRange(days);
    onChange(r);
    setSelecting(false);
    const t = parse(r.to);
    setView({ y: t.getFullYear(), m: t.getMonth() });
  }

  function activePresetKey(): string | null {
    for (const p of PRESETS) {
      const r = presetRange(p.days);
      if (r.from === value.from && r.to === value.to) return p.key;
    }
    return null;
  }

  const activeKey = activePresetKey();

  const fromMs = fromDate.getTime();
  const toMs = toDate.getTime();

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-primary)",
        borderRadius: 10,
        padding: 12,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.02)",
        color: "var(--text-primary)",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        .cr-nav-btn {
          background: var(--bg-glass);
          border: 1px solid var(--border-primary);
          color: var(--text-secondary);
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          transition: border-color .15s ease, color .15s ease, background .15s ease;
        }
        .cr-nav-btn:hover {
          border-color: var(--border-hover);
          color: var(--text-primary);
        }
        .cr-pill {
          background: var(--bg-glass);
          border: 1px solid var(--border-primary);
          color: var(--text-secondary);
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: border-color .15s ease, color .15s ease, background .15s ease;
        }
        .cr-pill:hover { border-color: var(--border-hover); color: var(--text-primary); }
        .cr-pill.is-active {
          background: var(--accent-soft);
          border-color: var(--accent);
          color: var(--accent);
        }
        .cr-cell {
          position: relative;
          min-height: 40px;
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: pointer;
          padding: 4px;
          box-sizing: border-box;
          transition: background .12s ease, border-color .12s ease;
          overflow: hidden;
        }
        .cr-cell:hover { border-color: var(--border-hover); }
        .cr-daynum {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          line-height: 1;
          color: var(--text-secondary);
        }
        .cr-cell.cr-out .cr-daynum { color: var(--text-muted); }
        .cr-cell.cr-in { background: var(--accent-soft); }
        .cr-cell.cr-end {
          background: var(--accent);
        }
        .cr-cell.cr-end .cr-daynum { color: var(--bg); font-weight: 700; }
        .cr-cell.cr-today {
          box-shadow: inset 0 0 0 1px rgba(201,169,110,.42);
        }
        @media (max-width: 560px) {
          .cr-cell { min-height: 34px; padding: 3px; }
          .cr-daynum { font-size: 10px; }
        }
      `}</style>

      {/* Header: month nav */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          className="cr-nav-btn"
          aria-label="Previous month"
          onClick={() => moveMonth(-1)}
        >
          {"‹"}
        </button>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            letterSpacing: ".01em",
          }}
        >
          {MONTHS[view.m]} {view.y}
        </div>
        <button
          type="button"
          className="cr-nav-btn"
          aria-label="Next month"
          onClick={() => moveMonth(1)}
        >
          {"›"}
        </button>
      </div>

      {/* Day-of-week header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0,1fr))",
          gap: 4,
          marginBottom: 4,
        }}
      >
        {DOW.map((d, i) => (
          <div
            key={i}
            style={{
              textAlign: "center",
              fontSize: 9,
              letterSpacing: ".13em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              padding: "2px 0",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0,1fr))",
          gap: 4,
        }}
      >
        {cells.map((d, i) => {
          const ds = fmt(d);
          const ms = d.getTime();
          const inMonth = d.getMonth() === view.m;
          const isEnd = ds === value.from || ds === value.to;
          const inRange = ms >= fromMs && ms <= toMs;
          const isToday = ds === todayStr;
          const cls = [
            "cr-cell",
            inMonth ? "" : "cr-out",
            isEnd ? "cr-end" : inRange ? "cr-in" : "",
            isToday ? "cr-today" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={i}
              className={cls}
              onClick={() => handleDayClick(d)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleDayClick(d);
                }
              }}
            >
              <span className="cr-daynum">{d.getDate()}</span>
            </div>
          );
        })}
      </div>

      {/* Preset pills */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginTop: 12,
        }}
      >
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={"cr-pill" + (activeKey === p.key ? " is-active" : "")}
            onClick={() => applyPreset(p.days)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
