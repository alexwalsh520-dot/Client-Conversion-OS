// ─────────────────────────────────────────────────────────────────────────
// METRIC CARD REGISTRY — the ONE place every Metrics card is defined, with its
// plain-English sentence, where the number comes from, and the exact
// computation (its consistency check). The gear panel and each card's hover
// render from this, and a coverage test fails if a card lacks a sentence or a
// source. Same Registry Currency law as the column registry.
//
// Every card's big number is a formula over the window TOTAL (the same total
// the table's TOTAL row uses), and every chart point is a formula over one ET
// day of the snapshot day series, so a card can never disagree with the table.
// ─────────────────────────────────────────────────────────────────────────

import { derive } from "./metrics";
import type { BaseMetrics, MetricsDay } from "./types";

export type CardFormat = "usd" | "usd2" | "int" | "pct" | "ratio2" | "cpm";

export interface CardDef {
  id: string;
  label: string;
  /** Short caption under the title. */
  meta: string;
  /** One-sentence rule for the gear panel + the card hover. */
  sentence: string;
  /** Where the number comes from, in plain English. */
  source: string;
  format: CardFormat;
  /** The big number over the window total (null when undefined, e.g. 0/0). */
  value: (t: BaseMetrics) => number | null;
  /** One chart point from one ET day (0 when undefined, for a clean line). */
  point: (d: MetricsDay) => number;
}

const dayBase = (d: MetricsDay): BaseMetrics => ({
  spendCents: d.spendCents,
  impressions: d.impressions,
  clicks: d.clicks,
  messages: d.messages,
  booked: d.booked,
  taken: d.taken,
  takenPeople: 0,
  showedPeople: 0,
  upcoming: 0,
  newClients: d.newClients,
  collectedCents: d.collectedCents,
  contractedCents: 0,
});

export const CARD_DEFS: readonly CardDef[] = [
  {
    id: "roas",
    label: "Collected ROAS",
    meta: "Cash collected per dollar spent",
    sentence: "The cash collected for every dollar of ad spend across the window, shown as a multiple.",
    source: "Collected revenue divided by ad spend, over the selected days.",
    format: "ratio2",
    value: (t) => derive(t).collectedRoi,
    point: (d) => derive(dayBase(d)).collectedRoi ?? 0,
  },
  {
    id: "cost_per_dm",
    label: "Cost per DM",
    meta: "Overall spend behind one DM",
    sentence: "The average ad spend behind one DM across the whole window (overall, not by keyword).",
    source: "Total ad spend divided by total DMs.",
    format: "usd2",
    value: (t) => centsOrNull(derive(t).costPerMessageCents),
    point: (d) => (derive(dayBase(d)).costPerMessageCents ?? 0) / 100,
  },
  {
    id: "cac",
    label: "CAC",
    meta: "Cost to get one client",
    sentence: "The average ad spend behind one new client across the window.",
    source: "Total ad spend divided by new clients.",
    format: "usd",
    value: (t) => centsOrNull(derive(t).costPerClientCents),
    point: (d) => (derive(dayBase(d)).costPerClientCents ?? 0) / 100,
  },
  {
    id: "spend",
    label: "Ad spend",
    meta: "What Meta charged",
    sentence: "How much Meta charged to run the ads each day.",
    source: "Meta, bucketed to Eastern-time days.",
    format: "usd",
    value: (t) => t.spendCents / 100,
    point: (d) => d.spendCents / 100,
  },
  {
    id: "impressions",
    label: "Impressions",
    meta: "Times shown",
    sentence: "How many times the ads were shown each day.",
    source: "Meta.",
    format: "int",
    value: (t) => t.impressions,
    point: (d) => d.impressions,
  },
  {
    id: "cpm",
    label: "CPM",
    meta: "Cost per 1,000 shown",
    sentence: "The cost for every one thousand times the ads were shown.",
    source: "Ad spend divided by impressions, times one thousand.",
    format: "cpm",
    value: (t) => centsOrNull(derive(t).cpmCents),
    point: (d) => (derive(dayBase(d)).cpmCents ?? 0) / 100,
  },
  {
    id: "clicks",
    label: "Link clicks",
    meta: "Clicks on the ad link",
    sentence: "How many times people clicked the ad link each day.",
    source: "Meta.",
    format: "int",
    value: (t) => t.clicks,
    point: (d) => d.clicks,
  },
  {
    id: "ctr",
    label: "CTR",
    meta: "Share of views that clicked",
    sentence: "The share of times the ads were shown that led to a link click.",
    source: "Link clicks divided by impressions.",
    format: "pct",
    value: (t) => derive(t).ctr,
    point: (d) => derive(dayBase(d)).ctr ?? 0,
  },
  {
    id: "cpc",
    label: "CPC",
    meta: "Cost of one click",
    sentence: "The average cost of one link click.",
    source: "Ad spend divided by link clicks.",
    format: "usd2",
    value: (t) => centsOrNull(derive(t).cpcCents),
    point: (d) => (derive(dayBase(d)).cpcCents ?? 0) / 100,
  },
  {
    id: "messages",
    label: "DMs",
    meta: "Different people who DMed",
    sentence: "How many different people sent an ad keyword in a DM each day.",
    source: "ManyChat keyword events, counted as distinct people per day.",
    format: "int",
    value: (t) => t.messages,
    point: (d) => d.messages,
  },
  {
    id: "calls_booked",
    label: "Calls booked",
    meta: "45-min calls booked",
    sentence: "How many different people booked a strategy call each day.",
    source: "GoHighLevel sales-calendar bookings that carry a keyword, distinct people per day.",
    format: "int",
    value: (t) => t.booked,
    point: (d) => d.booked,
  },
  {
    id: "cost_per_booked",
    label: "Cost per booked",
    meta: "Spend behind one booking",
    sentence: "The average ad spend behind one booked call across the window.",
    source: "Total ad spend divided by calls booked.",
    format: "usd2",
    value: (t) => centsOrNull(derive(t).costPerBookedCents),
    point: (d) => (derive(dayBase(d)).costPerBookedCents ?? 0) / 100,
  },
  {
    id: "calls_taken",
    label: "Calls taken",
    meta: "Calls that happened",
    sentence: "How many strategy calls took place each day.",
    source: "The sales tracker, which only lists calls that took place.",
    format: "int",
    value: (t) => t.taken,
    point: (d) => d.taken,
  },
  {
    id: "cost_per_taken",
    label: "Cost per call taken",
    meta: "Spend behind one call",
    sentence: "The average ad spend behind one call that happened across the window.",
    source: "Total ad spend divided by calls taken.",
    format: "usd2",
    value: (t) => centsOrNull(derive(t).costPerTakenCents),
    point: (d) => (derive(dayBase(d)).costPerTakenCents ?? 0) / 100,
  },
  {
    id: "new_clients",
    label: "New clients",
    meta: "Calls that became clients",
    sentence: "How many calls became a paying client each day.",
    source: "The sales tracker wins.",
    format: "int",
    value: (t) => t.newClients,
    point: (d) => d.newClients,
  },
  {
    id: "close_rate",
    label: "Close rate",
    meta: "Calls taken that closed",
    sentence: "The share of calls taken that became a client across the window.",
    source: "New clients divided by calls taken.",
    format: "pct",
    value: (t) => derive(t).closeRate,
    point: (d) => derive(dayBase(d)).closeRate ?? 0,
  },
  {
    id: "msg_to_call",
    label: "DM to call",
    meta: "DMs that booked",
    sentence: "The share of DMs that became a booked call across the window.",
    source: "Calls booked divided by DMs.",
    format: "pct",
    value: (t) => derive(t).msgToCall,
    point: (d) => derive(dayBase(d)).msgToCall ?? 0,
  },
  {
    id: "collected",
    label: "Collected revenue",
    meta: "Cash collected",
    sentence: "Cash actually collected from clients tied to an ad keyword each day.",
    source: "The sales tracker, tied to a keyword by hard key only.",
    format: "usd",
    value: (t) => t.collectedCents / 100,
    point: (d) => d.collectedCents / 100,
  },
];

function centsOrNull(cents: number | null): number | null {
  return cents == null ? null : cents / 100;
}

export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(
  CARD_DEFS.map((c) => [c.id, c]),
);

// The default board, in order. Deliberately excludes Potential ROAS (not in this
// build) and any by-keyword Cost per DM toggle (overall only).
export const DEFAULT_CARD_IDS: readonly string[] = [
  "roas",
  "cost_per_dm",
  "cac",
  "spend",
  "messages",
  "calls_booked",
  "calls_taken",
  "collected",
];
