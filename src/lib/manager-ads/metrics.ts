// Manager Ads View — per-influencer ad performance over an arbitrary ET date
// range. Same sources as the daily recap (nothing new is integrated here):
//   • Ad spend    → ads_meta_insights_daily (synced, ET-bucketed)
//   • Messages    → ManyChat `new_lead` tag events (getLeadHours)
//   • Calls booked→ ghl_appointments (Strategy Session calendars, created_at)
//   • Taken/wins/cash → sales tracker sheet (Call Taken / outcome=WIN / Cash Collected)
//
// ROAS is labelled "potential" because unattributed cash is counted toward ads —
// per-client cash is everything on the tracker, not just keyword-tied sales.

import { getLeadHours } from "@/lib/sales-hub/lead-hours";
import { CREATORS_BY_KEY, creatorKeyFromText, type CreatorKey } from "@/lib/creators";
import { type SheetRow } from "@/lib/google-sheets";
import { getServiceSupabase } from "@/lib/supabase";
import {
  REPORT_CLIENTS,
  countAppointmentsForDays,
  fetchDailySpend,
} from "@/lib/daily-report/metrics";

export interface ManagerAdsRow {
  client: string; // creator key, or "total"
  label: string;
  spend: number | null;
  messages: number | null;
  costPerMessage: number | null;
  callsBooked: number | null;
  costPerBooked: number | null;
  callsTaken: number | null;
  costPerTaken: number | null;
  newClients: number | null;
  costPerClient: number | null;
  cashCollected: number | null;
  potentialRoas: number | null;
}

export interface ManagerAdsReport {
  from: string;
  to: string;
  generatedAt: string;
  rows: ManagerAdsRow[]; // one per influencer
  total: ManagerAdsRow;
  warnings: string[];
}

async function safe<T>(
  label: string,
  warnings: string[],
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    warnings.push(`${label}: ${msg}`);
    console.error(`[manager-ads] ${label} failed:`, e);
    return fallback;
  }
}

function ratio(numer: number | null, denom: number | null): number | null {
  if (numer == null || !denom) return null;
  return numer / denom;
}

function derive(row: Omit<ManagerAdsRow, "costPerMessage" | "costPerBooked" | "costPerTaken" | "costPerClient" | "potentialRoas">): ManagerAdsRow {
  return {
    ...row,
    costPerMessage: ratio(row.spend, row.messages),
    costPerBooked: ratio(row.spend, row.callsBooked),
    costPerTaken: ratio(row.spend, row.callsTaken),
    costPerClient: ratio(row.spend, row.newClients),
    potentialRoas: ratio(row.cashCollected, row.spend),
  };
}

function sheetForClient(rows: SheetRow[], client: CreatorKey) {
  const crows = rows.filter((r) => creatorKeyFromText(r.offer) === client);
  return {
    taken: crows.filter((r) => r.callTaken).length,
    wins: crows.filter((r) => (r.outcome || "").toUpperCase() === "WIN").length,
    cash: crows.reduce((s, r) => s + (r.cashCollected || 0), 0),
  };
}

// Read the SAME synced sales copy the canonical Ads tab uses (sales_tracker_rows), NOT the live
// Google Sheet. This is the fix for the Manager view disagreeing with the Ads tab: before, one read
// the live sheet and the other a cached snapshot, so they drifted. Now both read one synced source,
// so they agree to the same sync. Only the source changes; the metrics are computed exactly as before.
async function fetchSyncedSales(from: string, to: string): Promise<SheetRow[]> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("sales_tracker_rows")
    .select("offer, call_taken, outcome, collected_revenue_cents, date")
    .gte("date", from)
    .lte("date", to);
  return (data || []).map((r) => {
    const row = r as { offer: string; call_taken: boolean; outcome: string; collected_revenue_cents: number };
    return {
      offer: row.offer,
      callTaken: !!row.call_taken,
      outcome: row.outcome,
      cashCollected: (Number(row.collected_revenue_cents) || 0) / 100,
    } as unknown as SheetRow;
  });
}

export async function buildManagerAdsReport(from: string, to: string): Promise<ManagerAdsReport> {
  const warnings: string[] = [];

  const [dailySpend, leadHours, sheet] = await Promise.all([
    safe("spend", warnings, () => fetchDailySpend(from, to), {} as Record<string, Record<string, number>>),
    safe("messages", warnings, () => getLeadHours({ client: "all", dateFrom: from, dateTo: to }), null),
    safe("sheet", warnings, () => fetchSyncedSales(from, to), [] as SheetRow[]),
  ]);

  const messagesByClient: Record<string, number> = {};
  for (const offer of leadHours?.offers ?? []) {
    messagesByClient[offer.id] = offer.counts.reduce((a, b) => a + b, 0);
  }

  const rows: ManagerAdsRow[] = [];
  for (const client of REPORT_CLIENTS) {
    const byDay = dailySpend[client];
    const spend = byDay ? Object.values(byDay).reduce((s, n) => s + n, 0) : null;
    const booked = await safe(`booked:${client}`, warnings, () => countAppointmentsForDays(client, "created_at", from, to), null);
    const sales = sheetForClient(sheet, client);

    rows.push(
      derive({
        client,
        label: CREATORS_BY_KEY[client].name,
        spend,
        messages: leadHours ? (messagesByClient[client] ?? 0) : null,
        callsBooked: booked,
        callsTaken: sales.taken,
        newClients: sales.wins,
        cashCollected: sales.cash,
      }),
    );
  }

  const sum = (pick: (r: ManagerAdsRow) => number | null): number | null => {
    const vals = rows.map(pick).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  const total = derive({
    client: "total",
    label: "All Influencers",
    spend: sum((r) => r.spend),
    messages: sum((r) => r.messages),
    callsBooked: sum((r) => r.callsBooked),
    callsTaken: sum((r) => r.callsTaken),
    newClients: sum((r) => r.newClients),
    cashCollected: sum((r) => r.cashCollected),
  });

  return {
    from,
    to,
    generatedAt: new Date().toISOString(),
    rows,
    total,
    warnings,
  };
}
