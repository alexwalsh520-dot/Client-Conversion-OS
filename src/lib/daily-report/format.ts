// Slack message formatting for the previous-day recap.
//
// Mobile-first: plain Slack mrkdwn (no code-block panel, which wraps badly on
// phones). Bold labels (*…*), regular numbers, italic tells (_…_).

import { type EodReport, type MoneyRow } from "./metrics";
import { etFormatLong } from "./time";

function dollars(n: number | null): string {
  if (n == null) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function cost(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function int(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

// Sum a field across rows; null = skip, all-null = null (renders "—", not "$0").
function total(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

function sumMoney(rows: MoneyRow[]): MoneyRow {
  const spend = total(rows.map((r) => r.spend));
  const leads = total(rows.map((r) => r.leads)) ?? 0;
  const booked = total(rows.map((r) => r.booked));
  return {
    spend,
    leads,
    cpl: spend != null && leads > 0 ? spend / leads : null,
    booked,
    cpbc: spend != null && booked ? spend / booked : null,
  };
}

// One compact line of money metrics, e.g. "$422 · 31 leads · $13.61/lead · 2 booked · $211/call".
function compactMoney(m: MoneyRow): string {
  const parts = [dollars(m.spend), `${int(m.leads)} leads`];
  if (m.cpl != null) parts.push(`${cost(m.cpl)}/lead`);
  parts.push(`${int(m.booked)} booked`);
  if (m.cpbc != null) parts.push(`${cost(m.cpbc)}/call`);
  return parts.join(" · ");
}

export function formatEod(r: EodReport): string {
  const L: string[] = [];
  const dayTotal = sumMoney(r.clients.map((c) => c.money.day));
  const wtdTotal = sumMoney(r.clients.map((c) => c.money.wtd));
  const mtdTotal = sumMoney(r.clients.map((c) => c.money.mtd));

  L.push(`🌙 *Daily Recap — ${etFormatLong(r.recapDay)}*`);
  L.push("");

  // Headline: yesterday's totals, one metric per line (bold label, plain number).
  L.push("*Yesterday*");
  L.push(`*Spend* ${dollars(dayTotal.spend)}`);
  L.push(`*Leads* ${int(dayTotal.leads)}`);
  L.push(`*Cost / lead* ${cost(dayTotal.cpl)}`);
  L.push(`*Booked calls* ${int(dayTotal.booked)}`);
  L.push(`*Cost / booked call* ${cost(dayTotal.cpbc)}`);
  L.push("");

  // Per-client (yesterday).
  for (const c of r.clients) {
    L.push(`*${c.label}* — ${compactMoney(c.money.day)}`);
  }
  L.push("");

  // Week / month to date (totals).
  L.push(`*Week to date* — ${compactMoney(wtdTotal)}`);
  L.push(`*Month to date* — ${compactMoney(mtdTotal)}`);
  L.push("");

  // Sales for the day.
  L.push("*Sales*");
  L.push(`*Calls taken* ${int(total(r.clients.map((c) => c.sales.taken)) ?? 0)}`);
  L.push(`*Sales* ${int(total(r.clients.map((c) => c.sales.sales)) ?? 0)}`);
  L.push(`*Cash collected* ${dollars(total(r.clients.map((c) => c.sales.cash)))}`);
  L.push(
    "_" +
      r.clients.map((c) => `${c.label}: ${c.sales.sales} sale${c.sales.sales === 1 ? "" : "s"}, ${dollars(c.sales.cash)}`).join(" · ") +
      "_",
  );
  L.push("");

  // Calls scheduled for the new day.
  L.push(`*Calls scheduled today (${etFormatLong(r.upcomingDay)})*`);
  L.push(
    r.clients.map((c) => `${c.label} ${int(c.upcoming)}`).join(" · ") +
      ` · Total ${int(total(r.clients.map((c) => c.upcoming)))}`,
  );
  L.push("");

  L.push("_Sales, cash & calls-taken are logged by hand — they lag until closers fill in the sheet._");
  if (r.warnings.length) {
    L.push(`_⚠️ ${r.warnings.length} source(s) degraded: ${r.warnings.join("; ")}_`);
  }
  return L.join("\n");
}
