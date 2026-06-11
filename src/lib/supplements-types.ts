// Supplements vertical — metric data contract.
//
// The business is a high-ticket consultative funnel. The thing being measured is
// the nutrition-consult → supplement-sale funnel, fed by two acquisition paths:
//
//   Path A (warm)   — prospect buys high-ticket 1:1 coaching, then books a nutrition
//                     consult, then buys supplements.
//   Path B (rescue) — prospect does NOT buy coaching, is offered a complimentary
//                     nutrition consult, books it, then buys supplements.
//
// Every metric is reported three ways: Total, Path A, Path B.
// For Path A (and the Total), money metrics keep supplement revenue and coaching
// revenue CLEARLY SEPARATE (never blended) — that was an explicit requirement.
// Path B customers never bought coaching, so their coaching value is always null.

// ── Sources ────────────────────────────────────────────────────────────────────

export type SourceKey = "shopify" | "ghl" | "subscriptions" | "cogs";

export interface SourceStatus {
  key: SourceKey;
  label: string;
  /** true once credentials exist AND we've seen data from it */
  connected: boolean;
  /** which metrics this source powers */
  powers: string;
  /** the exact action to connect it, shown when not connected */
  whatToDo: string;
}

// ── Values ──────────────────────────────────────────────────────────────────────

export type ValueFormat = "money" | "count" | "percent" | "moneyPerCall";

/** Money is stored in integer cents (matching the Accountant tab convention). */
export type Cents = number;

/** A money value split by product line — kept separate, never summed in the UI. */
export interface SplitValue {
  /** supplement revenue/value in cents (or null if source not connected) */
  supplements: Cents | null;
  /** coaching revenue/value in cents — null for Path B (no coaching) */
  coaching: Cents | null;
}

/** A funnel metric (counts / rates) — no product split. */
export interface FunnelRow {
  key: string;
  label: string;
  format: ValueFormat;
  source: SourceKey;
  /** short clarifier shown under the label */
  hint?: string;
  /** target/benchmark for red-green coloring (null until you supply one) */
  target: number | null;
  total: number | null;
  pathA: number | null;
  pathB: number | null;
}

/** A money metric — supplements vs coaching kept separate per segment. */
export interface MoneyRow {
  key: string;
  label: string;
  format: ValueFormat;
  source: SourceKey;
  hint?: string;
  target: number | null;
  total: SplitValue;
  pathA: SplitValue;
  pathB: SplitValue; // coaching is always null
}

export type MetricSection =
  | { key: string; title: string; subtitle?: string; kind: "funnel"; rows: FunnelRow[] }
  | { key: string; title: string; subtitle?: string; kind: "money"; rows: MoneyRow[] };

export interface PeriodInfo {
  key: PeriodKey;
  label: string;
  start: string; // ISO
  end: string; // ISO
}

export type PeriodKey = "this_month" | "last_30" | "this_year" | "all_time";

export interface SupplementsDashboardData {
  generatedAt: string;
  period: PeriodInfo;
  sources: SourceStatus[];
  /** live metric sections (rendered now) */
  sections: MetricSection[];
  /** "add later" metrics that need cost data — rendered locked until COGS lands */
  future: MetricSection[];
  /** true when at least one source is live; drives the empty-state banner */
  anyConnected: boolean;
}

// ── Formatters ───────────────────────────────────────────────────────────────────

export function formatMoneyCents(cents: Cents | null): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function formatValue(value: number | null, format: ValueFormat): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (format) {
    case "money":
    case "moneyPerCall":
      return formatMoneyCents(value);
    case "count":
      return value.toLocaleString("en-US");
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
  }
}
