// Slack mrkdwn for the daily call-outcomes recap.
//
// Mobile-first. Numbers are STACKED one per line, never joined side by side on
// a single line — a `·`-joined stats line wraps badly on a phone and is what
// this format replaced. Facts only: this report reports, it does not coach.

import { ET } from "@/lib/daily-report/time";
import type { CallOutcome, CallOutcomesReport, OfferBlock, Stats } from "./data";

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function longDay(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** The five stacked metric lines, used for both the totals and each offer. */
function metricLines(s: Stats): string[] {
  return [
    `Calls scheduled: ${s.scheduled}`,
    `Calls Taken: ${s.taken}`,
    `Rescheduled: ${s.rescheduled}`,
    `Sales: ${s.closed}`,
    `Cash Collected: ${money(s.cash)}`,
  ];
}

/** Short type tag; Strategy Sessions are the default and stay unlabelled. */
function typeTag(call: CallOutcome): string | null {
  if (call.callType === "Rep Onboarding") return "rep onboarding";
  if (call.callType === "Client Onboarding") return "client onboarding";
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
  const type = tag ? ` _${tag}_` : "";
  return `• ${call.etTime} ${call.prospect}${who}${type} — ${statusOf(call)}`;
}

function blockText(block: OfferBlock): string {
  const lines = [`*${block.label}*`, ...metricLines(block.all)];
  if (block.all.unlogged > 0) {
    lines.push(`_${block.all.unlogged} not in the tracker yet_`);
  }
  lines.push("", ...block.calls.map(callLine));
  return lines.join("\n");
}

export function formatCallOutcomes(report: CallOutcomesReport): string {
  const header = `*Call Outcomes — ${longDay(report.day)}*`;

  if (report.totals.all.scheduled === 0) {
    return `${header}\nNo calls were on the calendar.`;
  }

  const parts = [
    [header, ...metricLines(report.totals.all)].join("\n"),
    ...report.blocks.map(blockText),
  ];

  // Surface a broken source rather than letting it read as a quiet zero.
  if (report.warnings.length > 0) {
    parts.push(`_Source issues: ${report.warnings.join("; ")}_`);
  }

  return parts.join("\n\n");
}
