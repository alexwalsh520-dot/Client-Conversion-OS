// Payout data layer — reads ONE month tab of the sales tracker and returns
// engine-ready rows for the team-payout engine (./compute.ts).
//
// Why this exists instead of fetchSheetData(): payouts settle a whole prior
// month and must (a) read both the main sales table AND the New MRR block, and
// (b) be tab-aware about dates. The tracker is organized one tab per month, so a
// row physically in the MAY tab is a May sale by construction — if its date cell
// reads a different YEAR (a real typo we hit: 2028-05-27), the tab wins. We
// normalize the year to the tab and SURFACE it, rather than silently dropping
// the row out of the date window or silently rewriting it.

import { fetchMonthTabSalesRows, fetchMonthTabMrrRows } from "@/lib/google-sheets";
import type { MainRow, MrrRow } from "./compute";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function pad(n: number) {
  return String(n).padStart(2, "0");
}

export interface PriorMonthData {
  mainRows: MainRow[];
  mrrRows: MrrRow[];
  warnings: string[];
}

// Reconcile a row's literal date against the (year, month) tab it lives in.
// Returns the date to use, or null to drop the row, plus an optional warning.
function reconcileDate(
  literal: string,
  year: number,
  month: number,
  ctx: string // for the warning message, e.g. `$300 sale "Kendall Ferguson" (closer WILL)`
): { date: string | null; warning?: string } {
  const py = Number(literal.slice(0, 4));
  const pm = Number(literal.slice(5, 7));
  const day = literal.slice(8, 10);
  const tabLabel = `${MONTHS[month - 1]} ${year}`;
  if (pm === month && py === year) return { date: literal };
  if (pm === month && py !== year) {
    // same month, wrong year → tab wins; count it but flag the typo
    return {
      date: `${year}-${pad(month)}-${day}`,
      warning: `Date typo: ${ctx} is dated ${literal} but sits in the ${tabLabel} tab — counted as ${year}-${pad(month)}-${day}. Fix the cell to silence this.`,
    };
  }
  // different month entirely → don't guess; exclude and flag
  return {
    date: null,
    warning: `Out-of-month row: ${ctx} is dated ${literal} but sits in the ${tabLabel} tab — NOT counted. Move it to the right tab or fix the date.`,
  };
}

/** Load and normalize one calendar month's main + New MRR rows. */
export async function loadPriorMonth(year: number, month: number): Promise<PriorMonthData> {
  const [rawMain, rawMrr] = await Promise.all([
    fetchMonthTabSalesRows(year, month),
    fetchMonthTabMrrRows(year, month),
  ]);
  const warnings: string[] = [];

  const mainRows: MainRow[] = [];
  for (const r of rawMain) {
    const cash = r.cashCollected || 0;
    const { date, warning } = reconcileDate(
      r.date,
      year,
      month,
      `$${cash.toLocaleString()} sale "${r.name || "?"}" (closer ${r.closer || "—"})`
    );
    if (warning && cash > 0) warnings.push(warning);
    if (!date) continue;
    mainRows.push({ date, closer: (r.closer || "").trim().toUpperCase(), cash, setter: r.setter || "" });
  }

  const mrrRows: MrrRow[] = [];
  for (const r of rawMrr) {
    const { date, warning } = reconcileDate(
      r.date,
      year,
      month,
      `$${r.mrr.toLocaleString()} New MRR "${r.name || "?"}" (DM-closer ${r.dmCloser || "—"})`
    );
    if (warning) warnings.push(warning);
    if (!date) continue;
    mrrRows.push({ date, dmCloser: (r.dmCloser || "").trim().toUpperCase(), mrr: r.mrr, name: r.name });
  }

  return { mainRows, mrrRows, warnings };
}
