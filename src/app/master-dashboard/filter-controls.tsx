"use client";

// Shared filter-bar controls in the metrics-dashboard visual language:
// a checkbox MultiSelect, a SingleSelect, and the Ads-v2-style DateDropdown
// (presets + two-click calendar). Extracted from MetricsDashboardView so the
// Sales Dashboard can reuse the exact same controls; both import the same
// metrics-dashboard.module.css so the styling stays identical.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import {
  PRESETS,
  rangeForPreset,
  rangeLabel,
  todayEt,
  type DayRange,
  type PresetId,
} from "@/lib/ads-v2/time";
import styles from "./metrics-dashboard.module.css";

// ── Shared dropdown plumbing ────────────────────────────────────────────────

export function useOutside(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, cb]);
}

/** Checkbox multi-select dropdown. `value === null` means "all selected". */
export function MultiSelect({
  label,
  icon,
  options,
  value,
  onChange,
  allLabel,
}: {
  label: string;
  icon?: React.ReactNode;
  options: Array<{ key: string; label: string }>;
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, useCallback(() => setOpen(false), []));

  const allKeys = options.map((o) => o.key);
  const selected = value === null ? allKeys : value;
  const isAll = value === null || selected.length === allKeys.length;

  const summary = isAll
    ? allLabel
    : selected.length === 0
      ? "None selected"
      : selected.length === 1
        ? (options.find((o) => o.key === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;

  const toggleAll = () => onChange(isAll ? [] : null);

  const toggleOne = (key: string) => {
    const next = selected.includes(key)
      ? selected.filter((k) => k !== key)
      : [...selected, key];
    onChange(next.length === allKeys.length ? null : next);
  };

  return (
    <div className={styles.filter} ref={ref}>
      <button
        className={`${styles.filterBtn}${open ? ` ${styles.filterBtnOpen}` : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className="lbl">{label}</span>
        <span className="val">{summary}</span>
        <span className={`${styles.caret}${open ? ` ${styles.caretOpen}` : ""}`}>
          <ChevronDown size={13} />
        </span>
      </button>
      {open && (
        <div className={styles.pop}>
          <label className={`${styles.checkRow} ${styles.checkAllRow}`}>
            <input type="checkbox" checked={isAll} onChange={toggleAll} />
            All
          </label>
          {options.map((o) => (
            <label key={o.key} className={styles.checkRow}>
              <input
                type="checkbox"
                checked={selected.includes(o.key)}
                onChange={() => toggleOne(o.key)}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Single-select dropdown in the same style (used for the Lens). */
export function SingleSelect<T extends string>({
  label,
  icon,
  options,
  value,
  onChange,
}: {
  label: string;
  icon?: React.ReactNode;
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, useCallback(() => setOpen(false), []));
  const current = options.find((o) => o.key === value)?.label ?? value;

  return (
    <div className={styles.filter} ref={ref}>
      <button
        className={`${styles.filterBtn}${open ? ` ${styles.filterBtnOpen}` : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className="lbl">{label}</span>
        <span className="val">{current}</span>
        <span className={`${styles.caret}${open ? ` ${styles.caretOpen}` : ""}`}>
          <ChevronDown size={13} />
        </span>
      </button>
      {open && (
        <div className={styles.pop}>
          {options.map((o) => (
            <div
              key={o.key}
              className={`${styles.popItem}${o.key === value ? ` ${styles.popItemSelected}` : ""}`}
              onClick={() => {
                onChange(o.key);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              <span className="check" style={{ display: "inline-flex", color: "var(--accent)", opacity: o.key === value ? 1 : 0 }}>
                <Check size={13} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Date dropdown — the Ads-v2 picker pattern (presets + two-click cal) ─────

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

interface CalCell {
  blank: boolean;
  iso: string;
  day: number;
  inRange: boolean;
  endpoint: boolean;
  today: boolean;
}

function buildMonth(ym: string, range: DayRange, today: string): CalCell[] {
  const [y, m] = ym.split("-").map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: CalCell[] = [];
  const blank = (): CalCell => ({ blank: true, iso: "", day: 0, inRange: false, endpoint: false, today: false });
  for (let i = 0; i < firstDow; i++) cells.push(blank());
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${ym}-${String(d).padStart(2, "0")}`;
    cells.push({
      blank: false,
      iso,
      day: d,
      inRange: iso >= range.from && iso <= range.to,
      endpoint: iso === range.from || iso === range.to,
      today: iso === today,
    });
  }
  while (cells.length % 7 !== 0) cells.push(blank());
  return cells;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return `${dt.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${y}`;
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(...(from.split("-").map(Number) as [number, number, number]));
  const b = Date.UTC(...(to.split("-").map(Number) as [number, number, number]));
  return Math.round((b - a) / 86_400_000) + 1;
}

export function DateDropdown({
  preset,
  range,
  onApply,
}: {
  preset: PresetId;
  range: DayRange;
  onApply: (preset: PresetId, range: DayRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, useCallback(() => setOpen(false), []));

  const [draftPreset, setDraftPreset] = useState<PresetId>(preset);
  const [draft, setDraft] = useState<DayRange>(range);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [calMonth, setCalMonth] = useState(() => range.to.slice(0, 7));

  useEffect(() => {
    if (open) {
      setDraftPreset(preset);
      setDraft(range);
      setSelectingEnd(false);
      setCalMonth(range.to.slice(0, 7));
    }
  }, [open, preset, range]);

  const presetLabel = PRESETS.find((p) => p.id === preset)?.label || "Custom";

  const pickPreset = (id: PresetId) => {
    if (id === "custom") {
      setDraftPreset("custom");
      setSelectingEnd(false);
      return;
    }
    onApply(id, rangeForPreset(id, todayEt()));
    setOpen(false);
  };

  const pickDay = (day: string) => {
    setDraftPreset("custom");
    if (!selectingEnd) {
      setDraft({ from: day, to: day });
      setSelectingEnd(true);
    } else {
      const from = day < draft.from ? day : draft.from;
      const to = day < draft.from ? draft.from : day;
      setDraft({ from, to });
      setSelectingEnd(false);
    }
  };

  const cells = buildMonth(calMonth, draft, todayEt());
  const dayCount = daysBetween(draft.from, draft.to);

  return (
    <div className={styles.filter} ref={ref}>
      <button
        className={`${styles.filterBtn}${open ? ` ${styles.filterBtnOpen}` : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <CalendarDays size={13} style={{ color: "var(--text-muted)" }} />
        <span className="val">{presetLabel}</span>
        <span className="dim">&middot; {rangeLabel(range)}</span>
        <span className={`${styles.caret}${open ? ` ${styles.caretOpen}` : ""}`}>
          <ChevronDown size={13} />
        </span>
      </button>
      {open && (
        <div className={`${styles.pop} ${styles.datePop}`}>
          <div className={styles.datePresets}>
            {PRESETS.map((p) => (
              <div
                key={p.id}
                className={`${styles.popItem}${draftPreset === p.id ? ` ${styles.popItemSelected}` : ""}`}
                onClick={() => pickPreset(p.id)}
              >
                <span>{p.label}</span>
                <span style={{ display: "inline-flex", color: "var(--accent)", opacity: draftPreset === p.id ? 1 : 0 }}>
                  <Check size={13} />
                </span>
              </div>
            ))}
          </div>
          <div className={styles.dateCal}>
            <div className={styles.calHead}>
              <button className={styles.calNav} onClick={() => setCalMonth(shiftMonth(calMonth, -1))}>
                &lsaquo;
              </button>
              <span>{monthLabel(calMonth)}</span>
              <button className={styles.calNav} onClick={() => setCalMonth(shiftMonth(calMonth, 1))}>
                &rsaquo;
              </button>
            </div>
            <div className={styles.calGrid}>
              {DOW.map((d, i) => (
                <div className={styles.calDow} key={`h${i}`}>
                  {d}
                </div>
              ))}
              {cells.map((c, i) =>
                c.blank ? (
                  <div className={`${styles.calDay} ${styles.calDayMuted}`} key={i} />
                ) : (
                  <button
                    key={i}
                    className={[
                      styles.calDay,
                      c.endpoint ? styles.calDayEndpoint : c.inRange ? styles.calDayInRange : "",
                      c.today ? styles.calDayToday : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => pickDay(c.iso)}
                  >
                    {c.day}
                  </button>
                ),
              )}
            </div>
          </div>
          <div className={styles.dateFoot}>
            <span>
              {draft.from} &rarr; {draft.to} &middot; {dayCount} day{dayCount === 1 ? "" : "s"}
              {draftPreset === "custom" && selectingEnd ? " · pick end date" : ""}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className={styles.cancelBtn} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className={styles.applyBtn}
                onClick={() => {
                  onApply(draftPreset, draft);
                  setOpen(false);
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
