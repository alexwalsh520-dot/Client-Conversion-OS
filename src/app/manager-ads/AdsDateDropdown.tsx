"use client";

// AdsDateDropdown — a faithful React port of the /ads tab's Meta-style date
// dropdown (public/ads-tracker-export.html). Same preset list (incl. Yesterday),
// same mini-calendar range picker, same footer. Emits { preset, dateFrom, dateTo }.

import { useEffect, useRef, useState } from "react";
import styles from "./date-dropdown.module.css";

export interface DateRange {
  preset: string;
  dateFrom: string; // YYYY-MM-DD (ET)
  dateTo: string; // YYYY-MM-DD (ET)
}

const PRESETS: { id: string; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last3", label: "Last 3 days" },
  { id: "last7", label: "Last 7 days" },
  { id: "last14", label: "Last 14 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "mtd", label: "This month" },
  { id: "lmtd", label: "Last month" },
  { id: "custom", label: "Custom" },
];

// ── ET date helpers (ported verbatim from the ads tab) ──────────────────────

export function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function shiftIso(date: string, days: number): string {
  const d = new Date(date + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
function monthStartIso(date: string): string {
  return (date || todayEt()).slice(0, 7) + "-01";
}
function shiftMonth(monthIso: string, delta: number): string {
  const d = new Date(monthIso + "T00:00:00");
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthTitle(monthIso: string): string {
  const d = new Date(monthIso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function daysInMonth(monthIso: string): number {
  const d = new Date(monthIso + "T00:00:00");
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function isoForMonthDay(monthIso: string, day: number): string {
  return `${monthIso.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

export function rangeForPreset(id: string, anchor: string = todayEt()): DateRange {
  if (id === "today") return { preset: id, dateFrom: anchor, dateTo: anchor };
  if (id === "yesterday") {
    const y = shiftIso(anchor, -1);
    return { preset: id, dateFrom: y, dateTo: y };
  }
  if (id === "last3") return { preset: id, dateFrom: shiftIso(anchor, -2), dateTo: anchor };
  if (id === "last7") return { preset: id, dateFrom: shiftIso(anchor, -6), dateTo: anchor };
  if (id === "last14") return { preset: id, dateFrom: shiftIso(anchor, -13), dateTo: anchor };
  if (id === "last30") return { preset: id, dateFrom: shiftIso(anchor, -29), dateTo: anchor };
  if (id === "mtd") return { preset: id, dateFrom: anchor.slice(0, 8) + "01", dateTo: anchor };
  if (id === "lmtd") {
    const start = shiftMonth(monthStartIso(anchor), -1);
    return { preset: id, dateFrom: start, dateTo: isoForMonthDay(start, daysInMonth(start)) };
  }
  return { preset: id, dateFrom: shiftIso(anchor, -6), dateTo: anchor };
}

function dateLabelFromIso(value: string): string {
  if (!value) return "";
  const d = new Date(value + "T00:00:00");
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function rangeLabel(range: DateRange): string {
  const from = dateLabelFromIso(range.dateFrom);
  const to = dateLabelFromIso(range.dateTo);
  const year = (range.dateTo || "").slice(0, 4);
  return from === to ? `${from}, ${year}` : `${from} – ${to}, ${year}`;
}
function labelForPreset(id: string): string {
  return PRESETS.find((p) => p.id === id)?.label || "Custom";
}

// ── Icons (ported from the ads tab) ─────────────────────────────────────────

function IcCal() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IcCaret() {
  return (
    <svg width={9} height={6} viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round">
      <path d="M1 1l4 4 4-4" />
    </svg>
  );
}
function IcCheck() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

// ── Mini calendar ───────────────────────────────────────────────────────────

function MiniCalendar({
  monthIso,
  rangeStart,
  rangeEnd,
  onPick,
  onShift,
}: {
  monthIso: string;
  rangeStart: string;
  rangeEnd: string;
  onPick: (iso: string) => void;
  onShift: (delta: number) => void;
}) {
  const days: { blank?: boolean; trail?: boolean; d?: number; iso?: string }[] = [];
  const monthDate = new Date(monthIso + "T00:00:00");
  const startBlank = monthDate.getDay();
  for (let i = 0; i < startBlank; i++) days.push({ blank: true });
  for (let d = 1; d <= daysInMonth(monthIso); d++) days.push({ d, iso: isoForMonthDay(monthIso, d) });
  while (days.length % 7 !== 0) days.push({ blank: true, trail: true });
  const dow = ["S", "M", "T", "W", "T", "F", "S"];
  const today = todayEt();

  return (
    <div>
      <div className={styles.calHead}>
        <button className={styles.calNav} onClick={() => onShift(-1)} aria-label="Previous month">
          {"‹"}
        </button>
        <span>{monthTitle(monthIso)}</span>
        <button className={styles.calNav} onClick={() => onShift(1)} aria-label="Next month">
          {"›"}
        </button>
      </div>
      <div className={styles.calGrid}>
        {dow.map((d, i) => (
          <div key={"h" + i} className={styles.calDow}>
            {d}
          </div>
        ))}
        {days.map((x, i) => {
          if (x.blank) {
            return <div key={i} className={`${styles.calDay} ${styles.muted} ${x.trail ? styles.trail : ""}`} />;
          }
          const iso = x.iso!;
          const inRange = iso >= rangeStart && iso <= rangeEnd;
          const endpoint = iso === rangeStart || iso === rangeEnd;
          const cls = [
            styles.calDay,
            endpoint ? styles.endpoint : inRange ? styles.inRange : "",
            iso === today ? styles.today : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button key={i} className={cls} onClick={() => onPick(iso)}>
              {x.d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Date dropdown ────────────────────────────────────────────────────────────

export default function AdsDateDropdown({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const [monthIso, setMonthIso] = useState(monthStartIso(value.dateTo));
  const [selectingEnd, setSelectingEnd] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Seed the draft from the committed value each time the popover opens.
  // (Committing a value always closes it, so no while-open resync is needed.)
  const openPopover = () => {
    setDraft(value);
    setMonthIso(monthStartIso(value.dateTo));
    setSelectingEnd(false);
    setOpen(true);
  };

  const label = labelForPreset(value.preset);
  const days = Math.max(
    1,
    Math.round((+new Date(draft.dateTo) - +new Date(draft.dateFrom)) / 86400000) + 1,
  );

  const pickDate = (iso: string) => {
    setDraft((prev) => {
      if (!selectingEnd) {
        setSelectingEnd(true);
        return { preset: "custom", dateFrom: iso, dateTo: iso };
      }
      setSelectingEnd(false);
      const dateFrom = iso < prev.dateFrom ? iso : prev.dateFrom;
      const dateTo = iso < prev.dateFrom ? prev.dateFrom : iso;
      return { preset: "custom", dateFrom, dateTo };
    });
  };

  return (
    <div className={styles.filter} ref={ref}>
      <button className={`${styles.filterBtn} ${open ? styles.filterBtnOpen : ""}`} onClick={() => (open ? setOpen(false) : openPopover())}>
        <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>
          <IcCal />
        </span>
        <span className={styles.val}>{label}</span>
        <span className={styles.dim} style={{ fontSize: 11 }}>
          {"· "}
          {rangeLabel(value)}
        </span>
        <span className={styles.caret}>
          <IcCaret />
        </span>
      </button>

      {open && (
        <div className={`${styles.pop} ${styles.datePop}`}>
          <div className={styles.datePresets}>
            {PRESETS.map((p) => (
              <div
                key={p.id}
                className={`${styles.popItem} ${draft.preset === p.id ? styles.popItemSelected : ""}`}
                onClick={() => {
                  if (p.id !== "custom") {
                    onChange(rangeForPreset(p.id));
                    setOpen(false);
                  } else {
                    setDraft({ ...draft, preset: "custom" });
                    setSelectingEnd(false);
                  }
                }}
              >
                <span>{p.label}</span>
                <span className={styles.check}>
                  <IcCheck />
                </span>
              </div>
            ))}
          </div>

          <div className={styles.dateCal}>
            <MiniCalendar
              monthIso={monthIso}
              rangeStart={draft.dateFrom}
              rangeEnd={draft.dateTo}
              onPick={pickDate}
              onShift={(delta) => setMonthIso((m) => shiftMonth(m, delta))}
            />
          </div>

          <div className={styles.dateFoot}>
            <span className={styles.mono}>
              {draft.dateFrom} {"→"} {draft.dateTo} {"·"} {days} day{days === 1 ? "" : "s"}
              {draft.preset === "custom" && selectingEnd ? " · pick end date" : ""}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className={styles.cancelBtn} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className={styles.applyBtn}
                onClick={() => {
                  onChange(draft);
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
