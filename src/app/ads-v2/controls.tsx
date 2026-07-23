"use client";

import { useEffect, useRef, useState } from "react";
import {
  PRESETS,
  rangeForPreset,
  rangeLabel,
  shiftDay,
  todayEt,
  type DayRange,
  type PresetId,
} from "@/lib/ads-v2/time";
import type { AdsV2Account, AdsV2Status } from "@/lib/ads-v2/types";

// ── Account dropdown (All / Tyson / Jake) ─────────────────────────────────
const ACCOUNT_OPTIONS: { id: AdsV2Account; label: string }[] = [
  { id: "all", label: "All accounts" },
  { id: "tyson", label: "Tyson" },
  { id: "jake", label: "Jake" },
];

export function AccountDropdown({
  value,
  onChange,
}: {
  value: AdsV2Account;
  onChange: (v: AdsV2Account) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const current = ACCOUNT_OPTIONS.find((o) => o.id === value)?.label || "All accounts";
  return (
    <div className="filter" ref={ref}>
      <button className={`filter-btn${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span className="lbl">Account</span>
        <span className="val">{current}</span>
        <span className="sort-arrow">▾</span>
      </button>
      {open && (
        <div className="pop">
          {ACCOUNT_OPTIONS.map((o) => (
            <div
              key={o.id}
              className={`pop-item${o.id === value ? " selected" : ""}`}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              <span className="check">✓</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Active / Finished / All segmented ─────────────────────────────────────
const STATUS_OPTIONS: { id: AdsV2Status; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "finished", label: "Finished" },
  { id: "all", label: "All" },
];

export function StatusSegmented({
  value,
  onChange,
}: {
  value: AdsV2Status;
  onChange: (v: AdsV2Status) => void;
}) {
  return (
    <div className="segmented">
      {STATUS_OPTIONS.map((o) => (
        <button
          key={o.id}
          className={`seg${o.id === value ? " active" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Date dropdown with preset list + two-click calendar ───────────────────
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

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
  useOutside(ref, () => setOpen(false));

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
    const r = rangeForPreset(id, todayEt());
    onApply(id, r);
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

  const monthCells = buildMonth(calMonth, draft, todayEt());

  return (
    <div className="filter" ref={ref}>
      <button className={`filter-btn${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span className="lbl">Dates</span>
        <span className="val">
          {presetLabel} · {rangeLabel(range)}
        </span>
        <span className="sort-arrow">▾</span>
      </button>
      {open && (
        <div className="pop date-pop">
          <div className="date-presets">
            {PRESETS.map((p) => (
              <div
                key={p.id}
                className={`date-preset${draftPreset === p.id ? " active" : ""}`}
                onClick={() => pickPreset(p.id)}
              >
                {p.label}
              </div>
            ))}
          </div>
          <div className="date-cal">
            <div className="cal-head">
              <span className="cal-nav" onClick={() => setCalMonth(shiftMonth(calMonth, -1))}>
                ‹
              </span>
              <span>{monthLabel(calMonth)}</span>
              <span className="cal-nav" onClick={() => setCalMonth(shiftMonth(calMonth, 1))}>
                ›
              </span>
            </div>
            <div className="cal-grid">
              {DOW.map((d, i) => (
                <div className="cal-dow" key={i}>
                  {d}
                </div>
              ))}
              {monthCells.map((c, i) =>
                c.trail ? (
                  <div className="cal-day trail" key={i} />
                ) : (
                  <div
                    key={i}
                    className={`cal-day${c.inRange ? " in-range" : ""}${c.endpoint ? " endpoint" : ""}${c.today ? " today" : ""}`}
                    onClick={() => pickDay(c.iso)}
                  >
                    {c.day}
                  </div>
                ),
              )}
            </div>
          </div>
          <div className="date-foot">
            <span>
              {draft.from} → {draft.to}
              {selectingEnd ? " · pick end date" : ""}
            </span>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="ghost-btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="apply-btn"
                onClick={() => {
                  onApply(draftPreset, draft);
                  setOpen(false);
                }}
              >
                Apply
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────
function useOutside(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, cb]);
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

interface Cell {
  trail: boolean;
  iso: string;
  day: number;
  inRange: boolean;
  endpoint: boolean;
  today: boolean;
}
function buildMonth(ym: string, range: DayRange, today: string): Cell[] {
  const [y, m] = ym.split("-").map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Cell[] = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push({ trail: true, iso: "", day: 0, inRange: false, endpoint: false, today: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${ym}-${String(d).padStart(2, "0")}`;
    cells.push({
      trail: false,
      iso,
      day: d,
      inRange: iso >= range.from && iso <= range.to,
      endpoint: iso === range.from || iso === range.to,
      today: iso === today,
    });
  }
  return cells;
}

export { shiftDay };
