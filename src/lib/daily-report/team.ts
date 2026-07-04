// Team recap — per-closer and per-setter metrics for the previous ET day.
// Reuses existing CCOS aggregators:
//   • Closers → fetchSheetData grouped by `closer` (the CloserPerformance recipe)
//   • Setters → getSetterReportData (leads / booked / booking rate)
//               + getResponseTimeMetrics (avg / median / miss, 11am–11pm ET window)
//
// Format is mobile Slack mrkdwn (bold names, plain numbers, italic tells) to
// match the daily recap.

import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
import { getSetterReportData } from "@/lib/setter-report-data";
import { getResponseTimeMetrics, type ResponseTimeGroup } from "@/lib/sales-hub/response-times";
import { addDays, etDateStr, etFormatLong } from "./time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloserRow {
  name: string;
  calls: number; // calls booked/assigned (incl. no-shows)
  showed: number; // calls taken
  closed: number; // wins
  cash: number; // cash collected on wins
}

export interface SetterRow {
  name: string;
  leads: number;
  booked: number;
  bookingRate: number; // percent
  avgSeconds: number | null;
  medianSeconds: number | null;
  missRate: number | null; // percent; null when no responses
  sampleCount: number;
}

export interface TeamReport {
  recapDay: string;
  generatedAt: string;
  closers: CloserRow[];
  setters: SetterRow[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function safe<T>(label: string, warnings: string[], fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    warnings.push(`${label}: ${e instanceof Error ? e.message : "error"}`);
    console.error(`[team-report] ${label} failed:`, e);
    return fallback;
  }
}

function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

// A call "showed" if the sheet says taken, or cash landed (covers a stale Call-Taken cell).
function isTaken(r: SheetRow): boolean {
  return r.callTakenStatus === "yes" || (r.cashCollected || 0) > 0;
}

export async function buildTeamReport(now: Date): Promise<TeamReport> {
  const warnings: string[] = [];
  const recapDay = addDays(etDateStr(now), -1);

  // --- Closers: group the day's sheet rows by closer -----------------------
  const sheet = await safe("sheet", warnings, () => fetchSheetData(recapDay, recapDay), [] as SheetRow[]);
  const byCloser = new Map<string, SheetRow[]>();
  for (const r of sheet) {
    const name = (r.closer || "").trim();
    if (!name) continue;
    const list = byCloser.get(name) ?? [];
    list.push(r);
    byCloser.set(name, list);
  }
  const closers: CloserRow[] = [];
  for (const [name, rows] of byCloser) {
    const wins = rows.filter((r) => (r.outcome || "").toUpperCase() === "WIN");
    closers.push({
      name: titleCase(name),
      calls: rows.length,
      showed: rows.filter(isTaken).length,
      closed: wins.length,
      cash: wins.reduce((s, r) => s + (r.cashCollected || 0), 0),
    });
  }
  closers.sort((a, b) => b.cash - a.cash || b.closed - a.closed || a.name.localeCompare(b.name));

  // --- Setters: funnel from setter-report-data, response from response-times
  const setterData = await safe("setters", warnings, () => getSetterReportData(recapDay), null);
  const respData = await safe(
    "response-times",
    warnings,
    () => getResponseTimeMetrics({ client: "all", dateFrom: recapDay, dateTo: recapDay }),
    null,
  );
  const respByKey = new Map<string, ResponseTimeGroup>();
  for (const g of respData?.setters ?? []) respByKey.set(g.id, g);

  // Appointments booked per setter = the setter's rows on the sales sheet (each row
  // is a booked call). The GHL→setter attribution (setter-report-data.booked) is
  // not wired — it returns 0 for everyone — so the sheet is the reliable source,
  // and it's consistent with the closer metrics above.
  const bookedBySetter = new Map<string, number>();
  for (const r of sheet) {
    const st = (r.setter || "").trim().toLowerCase();
    if (!st) continue;
    bookedBySetter.set(st, (bookedBySetter.get(st) ?? 0) + 1);
  }

  const setters: SetterRow[] = [];
  for (const s of setterData?.setters ?? []) {
    const resp = respByKey.get(s.setterKey);
    const missRate = resp && resp.sampleCount > 0 ? (resp.missedCount / resp.sampleCount) * 100 : null;
    const leads = s.daily.newLeads;
    const booked = bookedBySetter.get(s.setterName.toLowerCase()) ?? 0;
    setters.push({
      name: s.setterName,
      leads,
      booked,
      bookingRate: leads > 0 ? (booked / leads) * 100 : 0,
      avgSeconds: resp?.averageSeconds ?? null,
      medianSeconds: resp?.medianSeconds ?? null,
      missRate,
      sampleCount: resp?.sampleCount ?? 0,
    });
  }
  setters.sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));

  return { recapDay, generatedAt: now.toISOString(), closers, setters, warnings };
}

// ---------------------------------------------------------------------------
// Format (mobile Slack mrkdwn)
// ---------------------------------------------------------------------------

function dollars(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n)}%`;
}

function dur(s: number | null): string {
  if (s == null) return "—";
  const sec = Math.round(s);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

export function formatTeam(r: TeamReport): string {
  const L: string[] = [];
  L.push(`👥 *Team Recap — ${etFormatLong(r.recapDay)}*`);
  L.push("");

  L.push("*Closers*  _calls · showed · closed · cash_");
  if (r.closers.length === 0) {
    L.push("_No closer activity logged yet._");
  } else {
    for (const c of r.closers) {
      L.push(`*${c.name}* — ${c.calls} · ${c.showed} · ${c.closed} · ${dollars(c.cash)}`);
    }
  }
  L.push("");

  L.push("*Setters*");
  if (r.setters.length === 0) {
    L.push("_No setter data._");
  } else {
    for (const s of r.setters) {
      L.push(`*${s.name}*`);
      L.push(`Leads ${s.leads} · Booked ${s.booked} · Book rate ${pct(s.bookingRate)}`);
      L.push(`Avg ${dur(s.avgSeconds)} · Median ${dur(s.medianSeconds)} · Miss ${pct(s.missRate)}`);
    }
  }
  L.push("");

  L.push("_Closer stats and setter booked come from the sales sheet (they firm up as the team logs). Response times use the 11am–11pm ET window; “—” = no tracked replies that day._");
  if (r.warnings.length) {
    L.push(`_⚠️ ${r.warnings.length} source(s) degraded: ${r.warnings.join("; ")}_`);
  }
  return L.join("\n");
}
