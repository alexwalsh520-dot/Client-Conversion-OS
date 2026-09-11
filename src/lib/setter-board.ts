import { getActiveClients, getSetterLabelMap } from "@/lib/registry";
import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
import { getMetrics } from "@/lib/manychat";
import { creatorKeyFromText } from "@/lib/creators";
import { isExcludedSetter } from "@/lib/sales-hub/excluded-setters";
import { getSetsBooked } from "@/lib/sales-hub/sets-booked";

// ─────────────────────────────────────────────────────────────────────────
// Setter Board — the numbers behind the public setter leaderboard page
// (/p/setter-board/<token>). One row per setter across the active clients:
//
//   newLeads      ManyChat new_lead events assigned to the setter (ET days)
//   callsBooked   sets MADE in the range — counted at the moment the lead
//                 scheduled (GHL booking stream), NOT tracker rows by call day
//   bookingRate   callsBooked ÷ newLeads
//   callsTaken /  taken uses the hub's cash-override rule (cash collected
//   showRate      means the call happened); showRate = taken ÷ (taken + noShows)
//   cashCollected sum of the setter's call rows' Cash Collected
//   subsSold      rows on the tracker's SUBSCRIPTION table sold by the setter
//   subRate       subsSold ÷ newLeads — same construction as bookingRate
//
// Only rows belonging to ACTIVE clients count (creators.ts matchTokens), so
// retired clients never leak into the leaderboard.
// ─────────────────────────────────────────────────────────────────────────

export interface SetterBoardRow {
  name: string;
  newLeads: number;
  callsBooked: number;
  callsTaken: number;
  noShows: number;
  wins: number;
  cashCollected: number;
  subsSold: number;
  bookingRate: number | null;
  showRate: number | null;
  subRate: number | null;
}

export interface SetterBoardResult {
  rows: SetterBoardRow[];
  totals: SetterBoardRow;
  dateFrom: string;
  dateTo: string;
  clients: string[]; // display names of the clients included
  generatedAt: string;
}

function blankRow(name: string): SetterBoardRow {
  return {
    name,
    newLeads: 0,
    callsBooked: 0,
    callsTaken: 0,
    noShows: 0,
    wins: 0,
    cashCollected: 0,
    subsSold: 0,
    bookingRate: null,
    showRate: null,
    subRate: null,
  };
}

function finalizeRates(row: SetterBoardRow): SetterBoardRow {
  row.bookingRate = row.newLeads > 0 ? (row.callsBooked / row.newLeads) * 100 : null;
  const showDenom = row.callsTaken + row.noShows;
  row.showRate = showDenom > 0 ? (row.callsTaken / showDenom) * 100 : null;
  row.subRate = row.newLeads > 0 ? (row.subsSold / row.newLeads) * 100 : null;
  return row;
}

export async function getSetterBoard(dateFrom: string, dateTo: string): Promise<SetterBoardResult> {
  const [labelMap, actives] = await Promise.all([
    getSetterLabelMap().catch(() => ({}) as Record<string, string>),
    getActiveClients().catch(() => []),
  ]);
  const activeClients =
    actives.length > 0
      ? actives
      : [{ key: "tyson", name: "Tyson", manychatKey: "tyson_sonnek" } as (typeof actives)[number]];
  const activeKeys = new Set(activeClients.map((c) => c.key));

  const resolveSetter = (raw: string | null | undefined): string | null => {
    const trimmed = (raw || "").trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (lower === "ai" || lower === "a.i.") return "AI"; // the AI setter keeps its name
    if (labelMap[lower]) return labelMap[lower];
    // Sheet cells sometimes carry extras ("AMARA / AI") — try each token.
    for (const token of lower.split(/[^a-z]+/)) {
      if (token && labelMap[token]) return labelMap[token];
    }
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  };

  const rowsByName = new Map<string, SetterBoardRow>();
  const rowFor = (name: string) => {
    let row = rowsByName.get(name);
    if (!row) {
      row = blankRow(name);
      rowsByName.set(name, row);
    }
    return row;
  };

  // ── ManyChat new leads per setter, summed across the active clients ──
  await Promise.all(
    activeClients.map(async (client) => {
      try {
        const metrics = await getMetrics(client.manychatKey, dateFrom, dateTo);
        for (const [key, m] of Object.entries(metrics.setters || {})) {
          const name = resolveSetter(key);
          if (!name || isExcludedSetter(name)) continue;
          rowFor(name).newLeads += m.newLeads || 0;
        }
      } catch {
        // a client without a ManyChat pipeline simply contributes no leads
      }
    }),
  );

  // ── Tracker rows (calls + subscription table) for the range ──
  let sheetRows: SheetRow[] = [];
  try {
    sheetRows = await fetchSheetData(dateFrom, dateTo);
  } catch {
    sheetRows = [];
  }

  const isTaken = (r: SheetRow) => r.callTakenStatus === "yes" || r.callTaken || r.cashCollected > 0;

  for (const r of sheetRows) {
    const clientKey = creatorKeyFromText(r.offer);
    if (clientKey && !activeKeys.has(clientKey)) continue; // retired client rows stay out
    const name = resolveSetter(r.setter);
    if (!name || isExcludedSetter(name)) continue;
    const row = rowFor(name);

    if (r.programLength === "Subscription") {
      row.subsSold += 1;
      continue;
    }

    const outcome = (r.outcome || "").toUpperCase();
    if (isTaken(r)) row.callsTaken += 1;
    else if (r.callTakenStatus === "no" || outcome === "NS" || outcome === "NS/RS") row.noShows += 1;
    if (outcome === "WIN") row.wins += 1;
    row.cashCollected += r.cashCollected || 0;
  }

  // ── Booked = sets MADE in the range (the moment the lead scheduled),
  //    not tracker rows by call day (owner definition, 2026-09-11) ──
  try {
    const sets = await getSetsBooked({ dateFrom, dateTo });
    for (const s of sets.bySetter) {
      if (s.key === "unassigned") continue; // leaderboard rows are named setters
      rowFor(s.label).callsBooked += s.count;
    }
  } catch {
    // booking stream unreachable — Booked column reads zero rather than lying
  }

  const rows = [...rowsByName.values()]
    .filter((r) => r.newLeads > 0 || r.callsBooked > 0 || r.subsSold > 0)
    .map(finalizeRates)
    .sort((a, b) => b.cashCollected - a.cashCollected || b.newLeads - a.newLeads);

  const totals = finalizeRates(
    rows.reduce(
      (t, r) => ({
        ...t,
        newLeads: t.newLeads + r.newLeads,
        callsBooked: t.callsBooked + r.callsBooked,
        callsTaken: t.callsTaken + r.callsTaken,
        noShows: t.noShows + r.noShows,
        wins: t.wins + r.wins,
        cashCollected: t.cashCollected + r.cashCollected,
        subsSold: t.subsSold + r.subsSold,
      }),
      blankRow("Team"),
    ),
  );

  return {
    rows,
    totals,
    dateFrom,
    dateTo,
    clients: activeClients.map((c) => c.name),
    generatedAt: new Date().toISOString(),
  };
}
