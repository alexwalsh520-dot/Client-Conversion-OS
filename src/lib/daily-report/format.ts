// Slack message formatting for the daily metrics reports.
//
// Tables are rendered inside a ``` code block so columns stay aligned in
// Slack's monospace font. Money/cost values round to whole dollars for spend &
// cash (fast scan) and 2dp for per-unit costs.

import {
  type MiddayReport,
  type EodReport,
  type AdsBlock,
  type MoneyRow,
} from "./metrics";
import { etFormatLong } from "./time";

function dollars(n: number | null): string {
  if (n == null) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function dollars2(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function int(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function padL(s: string, w: number): string {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}
function padR(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

// Sum a numeric field across rows, treating null as "skip" but tracking whether
// anything was present (so an all-null total renders "—", not "$0").
function total(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// Midday
// ---------------------------------------------------------------------------

const LABEL_W = 8;
const SPEND_W = 9;
const LEADS_W = 7;
const COST_W = 9;

function adsHeader(): string {
  return (
    padR("", LABEL_W) +
    padL("spend", SPEND_W) +
    padL("leads", LEADS_W) +
    padL("$/lead", COST_W) +
    padL("$/call", COST_W)
  );
}

function adsLine(label: string, a: AdsBlock): string {
  return (
    padR(label, LABEL_W) +
    padL(dollars(a.spend), SPEND_W) +
    padL(int(a.leads), LEADS_W) +
    padL(dollars2(a.cpl), COST_W) +
    padL(dollars2(a.cpbc), COST_W)
  );
}

export function formatMidday(r: MiddayReport): string {
  const lines: string[] = [];
  lines.push(`:sunny: *Daily Update — Midday*  ·  ${etFormatLong(r.dateStr)}, 5:00 PM ET`);
  lines.push("_Window: 5:00a–5:00p ET_");
  lines.push("");

  // ADS table
  const ads: string[] = ["ADS", adsHeader()];
  for (const c of r.clients) ads.push(adsLine(c.label, c.ads));
  const totSpend = total(r.clients.map((c) => c.ads.spend));
  const totLeads = total(r.clients.map((c) => c.ads.leads)) ?? 0;
  const totBooked = total(r.clients.map((c) => c.ads.booked));
  ads.push(
    adsLine("Total", {
      spend: totSpend,
      leads: totLeads,
      cpl: totSpend != null && totLeads > 0 ? totSpend / totLeads : null,
      booked: totBooked,
      cpbc: totSpend != null && totBooked ? totSpend / totBooked : null,
    }),
  );

  // SALES table
  const sales: string[] = [
    "",
    "SALES — today so far" +
      "  (sched · taken · sales · cash)",
  ];
  const sHeader =
    padR("", LABEL_W) + padL("sched", 7) + padL("taken", 7) + padL("sales", 7) + padL("cash", SPEND_W);
  sales.push(sHeader);
  for (const c of r.clients) {
    sales.push(
      padR(c.label, LABEL_W) +
        padL(int(c.sched), 7) +
        padL(int(c.taken), 7) +
        padL(int(c.sales), 7) +
        padL(dollars(c.cash), SPEND_W),
    );
  }
  sales.push(
    padR("Total", LABEL_W) +
      padL(int(total(r.clients.map((c) => c.sched))), 7) +
      padL(int(total(r.clients.map((c) => c.taken)) ?? 0), 7) +
      padL(int(total(r.clients.map((c) => c.sales)) ?? 0), 7) +
      padL(dollars(total(r.clients.map((c) => c.cash))), SPEND_W),
  );

  // REST OF DAY
  const restLines: string[] = ["", "REST OF DAY"];
  const leftParts = r.clients.map((c) => `${c.label} ${int(c.callsLeft)}`).join(" · ");
  const bookedParts = r.clients.map((c) => `${c.label} ${int(c.ads.booked)}`).join(" · ");
  restLines.push(`Calls left on calendar (5p–mid):  ${leftParts} · Total ${int(total(r.clients.map((c) => c.callsLeft)))}`);
  restLines.push(`New calls booked today (5a–5p):   ${bookedParts} · Total ${int(totBooked)}`);

  const body = [...ads, ...sales, ...restLines].join("\n");
  lines.push("```" + body + "```");
  lines.push("_taken · sales · cash come from the sales sheet — they lag until closers log._");
  if (r.warnings.length) lines.push(`:warning: _${r.warnings.length} source(s) degraded: ${r.warnings.join("; ")}_`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// End of day
// ---------------------------------------------------------------------------

const PERIOD_W = 11;

function moneyHeader(): string {
  return (
    padR("", PERIOD_W) +
    padL("spend", SPEND_W) +
    padL("leads", LEADS_W) +
    padL("$/lead", COST_W) +
    padL("booked", 8) +
    padL("$/call", COST_W)
  );
}

function moneyLine(label: string, m: MoneyRow): string {
  return (
    padR(label, PERIOD_W) +
    padL(dollars(m.spend), SPEND_W) +
    padL(int(m.leads), LEADS_W) +
    padL(dollars2(m.cpl), COST_W) +
    padL(int(m.booked), 8) +
    padL(dollars2(m.cpbc), COST_W)
  );
}

function moneyBlock(title: string, day: MoneyRow, wtd: MoneyRow, mtd: MoneyRow): string[] {
  return [
    title,
    moneyHeader(),
    moneyLine("Yesterday", day),
    moneyLine("Week-to-dt", wtd),
    moneyLine("Month-to-dt", mtd),
    "",
  ];
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

export function formatEod(r: EodReport): string {
  const lines: string[] = [];
  lines.push(`:crescent_moon: *Daily Recap — ${etFormatLong(r.recapDay)}*  ·  _sent 1:00 AM ET_`);
  lines.push(`_Upcoming calls = ${etFormatLong(r.upcomingDay)}_`);
  lines.push("");

  const body: string[] = [];
  for (const c of r.clients) {
    body.push(...moneyBlock(`MONEY — ${c.label}`, c.money.day, c.money.wtd, c.money.mtd));
  }
  // Combined totals across clients.
  body.push(
    ...moneyBlock(
      "MONEY — Total",
      sumMoney(r.clients.map((c) => c.money.day)),
      sumMoney(r.clients.map((c) => c.money.wtd)),
      sumMoney(r.clients.map((c) => c.money.mtd)),
    ),
  );

  // Sales recap for the day.
  body.push(`SALES — ${etFormatLong(r.recapDay)}`);
  for (const c of r.clients) {
    body.push(`  ${padR(c.label + ":", LABEL_W)} taken ${c.sales.taken} · sales ${c.sales.sales} · cash ${dollars(c.sales.cash)}`);
  }
  body.push(
    `  ${padR("Total:", LABEL_W)} taken ${r.clients.reduce((s, c) => s + c.sales.taken, 0)} · ` +
      `sales ${r.clients.reduce((s, c) => s + c.sales.sales, 0)} · ` +
      `cash ${dollars(r.clients.reduce((s, c) => s + c.sales.cash, 0))}`,
  );
  body.push("");

  // Tomorrow's scheduled calls.
  body.push(`TOMORROW — ${etFormatLong(r.upcomingDay)} (calls scheduled)`);
  const upParts = r.clients.map((c) => `${c.label} ${int(c.upcoming)}`).join(" · ");
  body.push(`  ${upParts} · Total ${int(total(r.clients.map((c) => c.upcoming)))}`);

  lines.push("```" + body.join("\n") + "```");
  lines.push("_taken · sales · cash from the sales sheet. Spend/leads/calls are final for the day._");
  if (r.warnings.length) lines.push(`:warning: _${r.warnings.length} source(s) degraded: ${r.warnings.join("; ")}_`);
  return lines.join("\n");
}
