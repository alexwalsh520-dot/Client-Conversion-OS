// Slack mrkdwn for the daily call-outcomes recap.
//
// Mobile-first, same house style as the other #a-sales-manager posts: no
// monospace code block (it wraps badly on a phone), bold labels, one call per
// line, `·` to join compact stats. Facts only — this report reports, it does
// not coach.

import { ET } from "@/lib/daily-report/time";
import type { CallOutcome, CallOutcomesReport, OfferBlock, Segmented, Stats } from "./data";

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function pct(numer: number, denom: number): string {
  if (!denom) return "—";
  return `${Math.round((numer / denom) * 100)}%`;
}

function longDay(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** One offer's or one segment's numbers, in the compact house style. */
function statLine(s: Stats): string {
  const bits = [
    `taken ${s.taken}/${s.scheduled} (${pct(s.taken, s.scheduled)})`,
    `closed ${s.closed} (${pct(s.closed, s.taken)} of taken)`,
  ];
  if (s.rescheduled > 0) bits.push(`rescheduled ${s.rescheduled}`);
  bits.push(`cash ${money(s.cash)}`);
  return bits.join(" · ");
}

/** "(3 sales · 10 onboarding)", omitted when the day is all one kind. */
function mix(seg: Segmented): string {
  if (seg.sales.scheduled === 0 || seg.onboarding.scheduled === 0) return "";
  return ` · ${seg.sales.scheduled} sales, ${seg.onboarding.scheduled} onboarding`;
}

/** Short type tag; Strategy Sessions are the default and stay unlabelled. */
function typeTag(call: CallOutcome): string | null {
  if (call.callType === "Onboarding") return "onboarding";
  if (call.callType === "Other") return "other";
  return null;
}

/**
 * The status half of a call line. Order matters — a rescheduled call is
 * reported as rescheduled even when a stale sheet row also exists for it.
 */
function statusOf(call: CallOutcome): string {
  const bits: string[] = [];

  if (call.rescheduled) {
    bits.push("*rescheduled*");
  } else if (!call.logged) {
    bits.push("_not logged_");
  } else if (!call.taken) {
    bits.push("not taken");
  } else {
    bits.push("taken");
  }

  if (call.closed) {
    bits.push(`*WIN* ${money(call.cash)}`);
  } else {
    if (call.outcome && call.outcome !== "WIN") bits.push(call.outcome);
    // Cash without a WIN is real (deposits, part payments) — never hide it.
    if (call.cash > 0) bits.push(money(call.cash));
  }

  return bits.join(" · ");
}

function callLine(call: CallOutcome): string {
  const tag = typeTag(call);
  const who = call.closer ? ` (${call.closer})` : "";
  const head = `• ${call.etTime} ${call.prospect}${who}`;
  const type = tag ? ` _${tag}_` : "";
  return `${head}${type} — ${statusOf(call)}`;
}

function blockText(block: OfferBlock): string {
  const lines = [`*${block.label}* — ${block.all.scheduled} scheduled${mix(block)}`];

  if (block.sales.scheduled > 0) lines.push(`Sales: ${statLine(block.sales)}`);
  if (block.onboarding.scheduled > 0) lines.push(`Onboarding: ${statLine(block.onboarding)}`);
  if (block.all.unlogged > 0) lines.push(`_${block.all.unlogged} not in the tracker yet_`);

  for (const call of block.calls) lines.push(callLine(call));
  return lines.join("\n");
}

export function formatCallOutcomes(report: CallOutcomesReport): string {
  const { totals } = report;
  const header = `*Call Outcomes — ${longDay(report.day)}*`;

  if (totals.all.scheduled === 0) {
    return `${header}\nNo calls were on the calendar.`;
  }

  const summary = [`${totals.all.scheduled} calls scheduled${mix(totals)}`];
  if (totals.sales.scheduled > 0) summary.push(`*Sales:* ${statLine(totals.sales)}`);
  if (totals.onboarding.scheduled > 0) summary.push(`*Onboarding:* ${statLine(totals.onboarding)}`);

  const parts = [[header, ...summary].join("\n"), ...report.blocks.map(blockText)];

  // Surface a broken source rather than letting it read as a quiet zero.
  if (report.warnings.length > 0) {
    parts.push(`_Source issues: ${report.warnings.join("; ")}_`);
  }

  return parts.join("\n\n");
}
