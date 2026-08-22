"use client";

// Metrics-engine dashboards — the shared client view behind /master-dashboard,
// /marketing-dashboard and /sales-dashboard (thin server pages pass `scope`).
//
// Layout, in Sales-Hub visual language: one glass filter bar (checkbox
// multi-select Client + Rep dropdowns, a Lens dropdown, and the Ads-v2-style
// date picker) → a stat-card grid per section. Each metric card shows ONE
// primary number; the other view sits under it in plain words ("$9,900 from
// leads acquired in this window"). Clicking a card expands an inline
// accordion panel with that metric's breakdowns (lead type / client / rep /
// channel) as compact tables — nothing else renders at the top level.
//
// Data: GET /api/metrics-engine/summary (session-authed; the tab itself is
// admin-only via sidebar/AccessGate). client= and rep= accept comma-separated
// lists. Ranges are ET calendar days via @/lib/ads-v2/time presets.

import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  Eye,
  Gauge,
  Loader2,
  Megaphone,
  Users,
} from "lucide-react";
import {
  PRESETS,
  rangeForPreset,
  rangeLabel,
  todayEt,
  type DayRange,
  type PresetId,
} from "@/lib/ads-v2/time";
import type {
  Channel,
  LeadType,
  MetricBlock,
  MetricCell,
  MetricsSummary,
  MetricUnit,
} from "@/lib/metrics-engine/types";
import styles from "./metrics-dashboard.module.css";

export type DashboardScope = "master" | "marketing" | "sales";

// ── Scope config ────────────────────────────────────────────────────────────

const MARKETING_KEYS = [
  "leads",
  "cash_collected",
  "ad_spend",
  "roas",
  "roas_blended",
  "roi",
  "cpm",
  "lctr",
] as const;

const SALES_KEYS = [
  "calls_booked",
  "booking_rate_new_leads",
  "show_rate",
  "close_rate",
  "aov",
  "reschedules",
  // Not yet live — the API marks these defined:false; they render as dashes
  // with a "no data source yet" chip.
  "pickup_rate_lm_lt60",
  "pickup_rate_lm_gt60",
  "pickup_rate_outbound",
  "script_adherence_set",
  "script_adherence_close",
  "pre_call_message_adherence",
] as const;

const SCOPE_META: Record<
  DashboardScope,
  { title: string; blurb: string; icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }> }
> = {
  master: {
    title: "Master Dashboard",
    blurb: "Marketing and sales, one page. Click any metric for its breakdowns.",
    icon: Gauge,
  },
  marketing: {
    title: "Marketing Dashboard",
    blurb: "Leads, cash, spend and returns. Click any metric for its breakdowns.",
    icon: Megaphone,
  },
  sales: {
    title: "Sales Dashboard",
    blurb: "Bookings, shows, closes and AOV. Click any metric for its breakdowns.",
    icon: BarChart3,
  },
};

const CLIENT_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "tyson", label: "Tyson" },
  { key: "jake", label: "Jake" },
];

const LEAD_TYPE_LABELS: Record<LeadType, string> = {
  ad: "Ad",
  organic: "Organic",
  follower: "Follower",
  misc: "Misc",
};
const LEAD_TYPE_ORDER: readonly LeadType[] = ["ad", "organic", "follower", "misc"];

const CHANNEL_LABELS: Record<Channel, string> = {
  dm: "DM",
  lm_outbound_lt60: "LM Outbound <60s",
  lm_outbound_gt60: "LM Outbound >60s",
  outbound: "Outbound",
};
const CHANNEL_ORDER: readonly Channel[] = ["dm", "lm_outbound_lt60", "lm_outbound_gt60", "outbound"];

// ── Metric view config: ONE primary number per metric ───────────────────────
// primary = the metric's natural definition. The other view (when it exists)
// renders as a muted plain-words line — never "Act"/"Coh".

type ViewKind = "activity" | "cohort";

const VIEW_LABELS: Record<ViewKind, string> = {
  activity: "In this window",
  cohort: "From leads acquired in this window",
};

interface MetricViewCfg {
  primary: ViewKind;
  /** Plain-words line for the other view; omitted when it doesn't exist. */
  otherLine?: (formatted: string) => string;
}

const METRIC_VIEWS: Record<string, MetricViewCfg> = {
  leads: { primary: "activity" }, // acquisition: both views are the same count
  cash_collected: {
    primary: "activity",
    otherLine: (v) => `${v} from leads acquired in this window`,
  },
  ad_spend: { primary: "activity" },
  cpm: { primary: "activity" },
  lctr: { primary: "activity" },
  roi: { primary: "activity" },
  roas: { primary: "cohort" },
  roas_blended: { primary: "cohort" },
  calls_booked: {
    primary: "activity",
    otherLine: (v) => `${v} from this window's new leads`,
  },
  booking_rate_new_leads: { primary: "cohort" },
  show_rate: {
    primary: "activity",
    otherLine: (v) => `${v} for this window's new leads`,
  },
  close_rate: {
    primary: "activity",
    otherLine: (v) => `${v} for this window's new leads`,
  },
  aov: {
    primary: "activity",
    otherLine: (v) => `${v} on this window's new leads`,
  },
  reschedules: {
    primary: "activity",
    otherLine: (v) => `${v} from this window's new leads`,
  },
};

const DEFAULT_VIEW: MetricViewCfg = { primary: "activity" };

function viewCfg(key: string): MetricViewCfg {
  return METRIC_VIEWS[key] ?? DEFAULT_VIEW;
}

/** The view columns a metric's breakdown tables carry. */
function viewCols(b: MetricBlock): ViewKind[] {
  const cfg = viewCfg(b.key);
  if (b.key === "leads") return ["activity"]; // identical views — one column
  return cfg.otherLine
    ? cfg.primary === "activity"
      ? ["activity", "cohort"]
      : ["cohort", "activity"]
    : [cfg.primary];
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** Format one value for its unit. null = em-dash, never 0. */
function fmtValue(v: number | null, unit: MetricUnit): string {
  if (v === null || !Number.isFinite(v)) return "—";
  switch (unit) {
    case "count":
      return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    case "usd_cents": {
      const dollars = v / 100;
      // $X,XXX — no cents unless the amount is under $100.
      const cents = Math.abs(dollars) < 100 && dollars !== 0;
      return dollars.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
      });
    }
    case "ratio":
      return `${(v * 100).toFixed(1)}%`;
    case "multiple":
      return `${v.toFixed(2)}x`;
    default:
      return String(v);
  }
}

function fmtStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function Val({ v, unit }: { v: number | null | undefined; unit: MetricUnit }) {
  const s = fmtValue(v ?? null, unit);
  return s === "—" ? <span className={styles.dash}>—</span> : <>{s}</>;
}

function PendingTag() {
  return <span className={styles.pendingTag}>no data source yet</span>;
}

// ── Shared dropdown plumbing ────────────────────────────────────────────────

function useOutside(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, cb]);
}

/** Checkbox multi-select dropdown. `value === null` means "all selected". */
function MultiSelect({
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
function SingleSelect<T extends string>({
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

function DateDropdown({
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

// ── Expansion panel tables ──────────────────────────────────────────────────

interface DimRow {
  key: string;
  label: string;
  cell: MetricCell | null | undefined;
}

function DimTable({
  title,
  rows,
  cols,
  unit,
  firstColLabel,
}: {
  title: string;
  rows: DimRow[];
  cols: ViewKind[];
  unit: MetricUnit;
  firstColLabel: string;
}) {
  return (
    <div className={styles.miniCard}>
      <div className={styles.miniTitle}>{title}</div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{firstColLabel}</th>
              {cols.map((c) => (
                <th key={c}>{VIEW_LABELS[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className={styles.rowLabel}>{r.label}</td>
                {cols.map((c) => (
                  <td key={c}>
                    <Val v={r.cell?.[c]} unit={unit} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Rep × lead-type matrix, primary view only, inside the expansion. */
function RepMatrixTable({
  block,
  reps,
  primary,
}: {
  block: MetricBlock;
  reps: Array<{ key: string; name: string }>;
  primary: ViewKind;
}) {
  const matrix = block.by_rep_x_lead_type;
  if (!matrix) return null;
  return (
    <div className={styles.miniCard}>
      <div className={styles.miniTitle}>
        Rep &times; lead type — {VIEW_LABELS[primary].toLowerCase()}
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Rep</th>
              {LEAD_TYPE_ORDER.map((t) => (
                <th key={t}>{LEAD_TYPE_LABELS[t]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reps.map((rep) => (
              <tr key={rep.key}>
                <td className={styles.rowLabel}>{rep.name.split(" ")[0]}</td>
                {LEAD_TYPE_ORDER.map((t) => (
                  <td key={t}>
                    <Val v={matrix[rep.key]?.[t]?.[primary]} unit={block.unit} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricExpansion({
  block,
  clients,
  clientLabels,
  reps,
  showByClient,
}: {
  block: MetricBlock;
  clients: string[];
  clientLabels: Record<string, string>;
  reps: Array<{ key: string; name: string }>;
  showByClient: boolean;
}) {
  const cols = viewCols(block);
  const cfg = viewCfg(block.key);

  const tables: React.ReactNode[] = [];

  if (block.by_lead_type) {
    tables.push(
      <DimTable
        key="type"
        title="By lead type"
        firstColLabel="Lead type"
        rows={LEAD_TYPE_ORDER.map((t) => ({
          key: t,
          label: LEAD_TYPE_LABELS[t],
          cell: block.by_lead_type?.[t],
        }))}
        cols={cols}
        unit={block.unit}
      />,
    );
  }

  if (block.by_client && showByClient) {
    tables.push(
      <DimTable
        key="client"
        title="By client"
        firstColLabel="Client"
        rows={clients.map((k) => ({
          key: k,
          label: clientLabels[k] ?? k,
          cell: block.by_client?.[k],
        }))}
        cols={cols}
        unit={block.unit}
      />,
    );
  }

  if (block.by_rep && reps.length > 0) {
    tables.push(
      <DimTable
        key="rep"
        title="By rep"
        firstColLabel="Rep"
        rows={reps.map((r) => ({
          key: r.key,
          label: r.name.split(" ")[0],
          cell: block.by_rep?.[r.key],
        }))}
        cols={cols}
        unit={block.unit}
      />,
    );
  }

  if (block.by_channel) {
    tables.push(
      <DimTable
        key="channel"
        title="By channel"
        firstColLabel="Channel"
        rows={CHANNEL_ORDER.map((c) => ({
          key: c,
          label: CHANNEL_LABELS[c],
          cell: block.by_channel?.[c],
        }))}
        cols={cols}
        unit={block.unit}
      />,
    );
  }

  if (block.by_rep_x_lead_type && reps.length > 1) {
    tables.push(<RepMatrixTable key="matrix" block={block} reps={reps} primary={cfg.primary} />);
  }

  return (
    <div className={styles.expand}>
      <div className={styles.expandHead}>
        <span className={styles.expandTitle}>{block.label}</span>
        {!block.defined ? <PendingTag /> : null}
        {block.reason ? <span className={styles.expandReason}>{block.reason}</span> : null}
      </div>
      {tables.length > 0 ? (
        <div className={styles.expandGrid}>{tables}</div>
      ) : (
        <p className={styles.expandReason} style={{ margin: 0 }}>
          {block.defined
            ? "No breakdowns available for this metric in the current view."
            : (block.reason ?? "No data source yet.")}
        </p>
      )}
    </div>
  );
}

// ── Stat card grid with click-to-expand ─────────────────────────────────────

function StatGrid({
  blocks,
  openKey,
  onToggle,
  clients,
  clientLabels,
  reps,
  showByClient,
}: {
  blocks: MetricBlock[];
  openKey: string | null;
  onToggle: (key: string) => void;
  clients: string[];
  clientLabels: Record<string, string>;
  reps: Array<{ key: string; name: string }>;
  showByClient: boolean;
}) {
  return (
    <div className={styles.statGrid}>
      {blocks.map((b) => {
        const cfg = viewCfg(b.key);
        const isOpen = openKey === b.key;
        const primaryVal = b.total?.[cfg.primary] ?? null;
        const otherKind: ViewKind = cfg.primary === "activity" ? "cohort" : "activity";
        const otherVal = b.total?.[otherKind] ?? null;
        const subLine =
          b.defined && cfg.otherLine && otherVal !== null
            ? cfg.otherLine(fmtValue(otherVal, b.unit))
            : null;
        return (
          <Fragment key={b.key}>
            <button
              className={`${styles.statCard}${isOpen ? ` ${styles.statCardOpen}` : ""}`}
              onClick={() => onToggle(b.key)}
              aria-expanded={isOpen}
            >
              <span className={styles.statLabel}>{b.label}</span>
              <span className={styles.statValue}>
                <Val v={primaryVal} unit={b.unit} />
              </span>
              {subLine ? (
                <span className={styles.statSub}>{subLine}</span>
              ) : !b.defined ? (
                <span className={styles.statSub}>
                  <PendingTag />
                </span>
              ) : null}
              <span className={`${styles.chev}${isOpen ? ` ${styles.chevOpen}` : ""}`}>
                <ChevronDown size={14} />
              </span>
            </button>
            {isOpen ? (
              <MetricExpansion
                block={b}
                clients={clients}
                clientLabels={clientLabels}
                reps={reps}
                showByClient={showByClient}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────────────────────

const REFRESH_MS = 5 * 60_000;

const LENS_OPTIONS: Array<{ key: "origin" | "conversion"; label: string }> = [
  { key: "origin", label: "Origin source" },
  { key: "conversion", label: "Conversion source" },
];

export default function MetricsDashboardView({ scope }: { scope: DashboardScope }) {
  const meta = SCOPE_META[scope];
  const showRepFilter = scope !== "marketing";

  const [preset, setPreset] = useState<PresetId>("mtd");
  const [range, setRange] = useState<DayRange>(() => rangeForPreset("mtd", todayEt()));
  // null = all selected (no filter sent).
  const [clientSel, setClientSel] = useState<string[] | null>(null);
  const [repSel, setRepSel] = useState<string[] | null>(null);
  const [lens, setLens] = useState<"origin" | "conversion">("origin");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);

  const repOptions = useMemo(
    () => (data?.reps ?? []).map((r) => ({ key: r.key, label: r.name })),
    [data],
  );

  const clientPartial = clientSel !== null && clientSel.length < CLIENT_OPTIONS.length;
  const repPartial =
    showRepFilter &&
    repSel !== null &&
    repOptions.length > 0 &&
    repSel.length < repOptions.length;

  const nothingSelected =
    (clientSel !== null && clientSel.length === 0) ||
    (showRepFilter && repSel !== null && repSel.length === 0);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!range.from || !range.to || range.from > range.to) return;
      if (nothingSelected) return;
      const params = new URLSearchParams({ from: range.from, to: range.to, lens });
      if (clientPartial && clientSel) params.set("client", clientSel.join(","));
      if (repPartial && repSel) params.set("rep", repSel.join(","));
      const url = `/api/metrics-engine/summary?${params.toString()}`;
      if (inFlight.current === url) return;
      inFlight.current = url;
      if (!opts?.silent) setLoading(true);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (inFlight.current !== url) return; // superseded
        if (!res.ok) throw new Error(body?.error || "Failed to load metrics");
        setData(body as MetricsSummary);
        setError(null);
      } catch (err) {
        if (inFlight.current !== url) return;
        setError((err as Error).message);
      } finally {
        if (inFlight.current === url) {
          inFlight.current = null;
          setLoading(false);
        }
      }
    },
    [range.from, range.to, lens, clientPartial, clientSel, repPartial, repSel, nothingSelected],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Background refresh while the window includes today.
  useEffect(() => {
    if (range.to < todayEt()) return;
    const id = window.setInterval(() => void load({ silent: true }), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, range.to]);

  const blocksByKey = useMemo(() => {
    const map = new Map<string, MetricBlock>();
    for (const b of data?.metrics ?? []) map.set(b.key, b);
    return map;
  }, [data]);

  const pick = useCallback(
    (keys: readonly string[]) =>
      keys.map((k) => blocksByKey.get(k)).filter((b): b is MetricBlock => Boolean(b)),
    [blocksByKey],
  );

  const marketingBlocks = pick(MARKETING_KEYS);
  const salesBlocks = pick(SALES_KEYS);

  const reps = useMemo(() => {
    const all = data?.reps ?? [];
    if (repSel === null) return all;
    return all.filter((r) => repSel.includes(r.key));
  }, [data, repSel]);

  const clients = data?.clients ?? [];
  const clientLabels: Record<string, string> = Object.fromEntries(
    CLIENT_OPTIONS.map((c) => [c.key, c.label]),
  );
  const showByClient = clients.length > 1;

  const toggleMetric = useCallback(
    (key: string) => setOpenKey((cur) => (cur === key ? null : key)),
    [],
  );

  const Icon = meta.icon;

  const marketingSection = (
    <div className="section">
      <h2 className="section-title">
        <Megaphone size={16} />
        Marketing
      </h2>
      {repPartial ? (
        <p className={styles.sectionNote}>
          Marketing metrics are blank under a rep selection — they are not attributable to
          individual reps.
        </p>
      ) : null}
      <StatGrid
        blocks={marketingBlocks}
        openKey={openKey}
        onToggle={toggleMetric}
        clients={clients}
        clientLabels={clientLabels}
        reps={reps}
        showByClient={showByClient}
      />
    </div>
  );

  const salesSection = (
    <div className="section">
      <h2 className="section-title">
        <BarChart3 size={16} />
        Sales
      </h2>
      <StatGrid
        blocks={salesBlocks}
        openKey={openKey}
        onToggle={toggleMetric}
        clients={clients}
        clientLabels={clientLabels}
        reps={reps}
        showByClient={showByClient}
      />
    </div>
  );

  return (
    <div className="fade-up" style={{ maxWidth: 1240 }}>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon size={22} style={{ color: "var(--accent)" }} />
          {meta.title}
        </h1>
        <p className="page-subtitle">{meta.blurb}</p>
      </div>

      {/* ── Filter bar ── */}
      <div className={`glass-static ${styles.filterBar}`}>
        <MultiSelect
          label="Client"
          icon={<Users size={13} style={{ color: "var(--text-muted)" }} />}
          options={CLIENT_OPTIONS}
          value={clientSel}
          onChange={setClientSel}
          allLabel="All clients"
        />
        {showRepFilter ? (
          <MultiSelect
            label="Rep"
            options={repOptions}
            value={repSel}
            onChange={setRepSel}
            allLabel="All reps"
          />
        ) : null}
        <SingleSelect
          label="Lens"
          icon={<Eye size={13} style={{ color: "var(--text-muted)" }} />}
          options={LENS_OPTIONS}
          value={lens}
          onChange={setLens}
        />
        <div className={styles.filterDivider} />
        <DateDropdown
          preset={preset}
          range={range}
          onApply={(p, r) => {
            setPreset(p);
            setRange(r);
          }}
        />
        <button
          className={styles.filterBtn}
          onClick={() => void load()}
          disabled={loading}
          style={{ marginLeft: "auto", opacity: loading ? 0.5 : 1 }}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {data?.migration_pending ? (
        <div className={styles.banner}>
          <AlertTriangle size={14} />
          Data engine awaiting database migration — numbers will appear once it runs.
        </div>
      ) : null}

      {nothingSelected ? (
        <div className={`glass-static ${styles.emptyPanel}`}>
          {clientSel !== null && clientSel.length === 0
            ? "No clients selected — pick at least one client to see metrics."
            : "No reps selected — pick at least one rep to see metrics."}
        </div>
      ) : loading && !data ? (
        <div
          className="glass-static"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}
        >
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
          <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 14 }}>Loading metrics…</span>
        </div>
      ) : error && !data ? (
        <div className="glass-static" style={{ padding: 18, fontSize: 13, color: "var(--warning)" }}>
          {error}
        </div>
      ) : data ? (
        <>
          {scope !== "sales" ? marketingSection : null}
          {scope !== "marketing" ? salesSection : null}

          <p className={styles.freshness}>
            {data.range.from} &rarr; {data.range.to} (ET) &middot; ledger built{" "}
            {data.freshness.ledger_built_at ? fmtStamp(data.freshness.ledger_built_at) : "—"} &middot; sheet synced{" "}
            {data.freshness.sheet_synced_at ? fmtStamp(data.freshness.sheet_synced_at) : "—"} &middot; spend synced{" "}
            {data.freshness.spend_synced_at ? fmtStamp(data.freshness.spend_synced_at) : "—"}
          </p>
          {error ? (
            <p style={{ fontSize: 12, color: "var(--warning)", marginTop: 8 }}>Last refresh failed: {error}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
