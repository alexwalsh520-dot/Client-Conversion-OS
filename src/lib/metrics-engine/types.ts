// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — shared types. This file is the API contract the frontend
// tabs consume: /api/metrics-engine/summary returns a MetricsSummary.
//
// Definitions the whole engine holds to:
//   * Lead = someone WE messaged first. acquired_at = our first outbound
//     message / ManyChat new_lead event.
//   * Origin source = FIRST categorization ever, immutable. Conversion
//     source = MOST RECENT categorization at/before the outcome measured.
//     'unclassified' is a stored state that dashboards fold into 'misc'.
//   * Every metric has TWO views: activity (events whose ET day is in the
//     window) and cohort (leads ACQUIRED in the window, counting their
//     downstream events whenever they occur).
//   * A cell where a dimension does not apply is null (rendered as a dash),
//     never 0.
// ─────────────────────────────────────────────────────────────────────────

import type { DayRange } from "@/lib/ads-v2/time";

/** Display lead types ('unclassified' folds into 'misc'). */
export type LeadType = "ad" | "organic" | "follower" | "misc";
export const LEAD_TYPES: readonly LeadType[] = ["ad", "organic", "follower", "misc"];

/** Stored lead types (storage may hold the temporary 'unclassified'). */
export type StoredLeadType = LeadType | "unclassified";

export type Channel = "dm" | "lm_outbound_lt60" | "lm_outbound_gt60" | "outbound";
export const CHANNELS: readonly Channel[] = [
  "dm",
  "lm_outbound_lt60",
  "lm_outbound_gt60",
  "outbound",
];

/**
 * Call type — the additive booking classification stored in event
 * metadata.call_type (the channel column keeps its original semantics).
 *   dm          — strategy-session calls booked through the DM funnel
 *   onboarding  — post-sale onboarding calls (never sales metrics)
 *   lm_outbound — rep-dialed calls to leads who opted into the lead magnet
 *   outbound    — rep-dialed calls to everyone else
 * Reschedule-calendar bookings inherit the lead's prior booking's call type.
 */
export type CallType = "dm" | "onboarding" | "lm_outbound" | "outbound";
export const CALL_TYPES: readonly CallType[] = ["dm", "onboarding", "lm_outbound", "outbound"];

export type LeadEventType =
  | "lead_created"
  | "categorization"
  | "lm_optin"
  | "dial"
  | "pickup"
  | "booking"
  | "reschedule"
  | "show"
  | "no_show"
  | "close"
  | "payment";

export type Lens = "origin" | "conversion";

/** One metric's pair of views. null = not applicable / undefined (dash). */
export interface MetricCell {
  activity: number | null;
  cohort: number | null;
}

export type MetricUnit = "count" | "usd_cents" | "ratio" | "multiple";

/**
 * One metric with every breakdown table. A whole breakdown table is null
 * when the dimension does not apply to the metric (e.g. ad_spend by rep).
 */
export interface MetricBlock {
  key: string;
  label: string;
  unit: MetricUnit;
  /** false = metric exists but has no data source yet (render dashes). */
  defined: boolean;
  /** Why the metric is undefined / caveated, when it is. */
  reason: string | null;
  total: MetricCell | null;
  by_client: Record<string, MetricCell | null> | null;
  by_lead_type: Record<LeadType, MetricCell | null> | null;
  by_rep: Record<string, MetricCell | null> | null;
  by_rep_x_lead_type: Record<string, Record<LeadType, MetricCell | null>> | null;
  by_channel: Record<Channel, MetricCell | null> | null;
}

export interface MetricsSummary {
  range: DayRange;
  lens: Lens;
  /** Applied client filter as a comma-joined list, or null = all clients. */
  client: string | null;
  /** Applied rep filter as a comma-joined list, or null = all reps. */
  rep: string | null;
  clients: string[];
  reps: Array<{ key: string; name: string }>;
  lead_types: readonly LeadType[];
  channels: readonly Channel[];
  metrics: MetricBlock[];
  /** True when the 113 migration has not been pasted yet (all tables empty). */
  migration_pending: boolean;
  freshness: {
    /** Newest metrics_lead_events.created_at — when the ledger last built. */
    ledger_built_at: string | null;
    /** Newest sales_tracker_rows.synced_at — sheet mirror freshness. */
    sheet_synced_at: string | null;
    /** Newest ads_meta_insights_daily.synced_at — spend freshness. */
    spend_synced_at: string | null;
  };
  generated_at: string;
}

export interface ComputeParams {
  range: DayRange;
  /** One client key, a comma-separated list ("tyson,jake"), or an array.
      Absent / empty / "all" = every active client. */
  client?: string | readonly string[] | null;
  /** One rep key, a comma-separated list ("will,erin"), or an array.
      Absent / empty / "all" = every rep. */
  rep?: string | readonly string[] | null;
  lens: Lens;
}
