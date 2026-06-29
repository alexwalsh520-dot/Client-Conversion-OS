// API route to live-fetch financial data from two Google Sheets:
//   1. Cancellations & Refunds sheet — header row at row 1
//   2. Sales Tracker, monthly tabs — Flagship Retention Payments table
//      lives somewhere on the right side of each month's tab. Columns
//      shift when other columns get added/removed elsewhere on the
//      sheet, so we anchor by finding the "Flagship Retention Payments"
//      title cell, then read the header row below it to map column
//      names to indices. This survives column reorders / renames as
//      long as the title and a "Date" column exist.

import { google } from "googleapis";
import { NextResponse } from "next/server";

const REFUNDS_SHEET_ID = "1DjsLzXyAs23TezCVlHbr2N6Mjha76IYGU3OkXenDVoY";
const SALES_TRACKER_ID = "1890ucxVRqIPiXjs2-XoW517_RKKvPZC0tT-OU33av9o";

const MONTH_TABS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

const RETENTION_TITLE = /flagship\s+retention\s+payments/i;
const HEADER_DATE = /^date/i;
const HEADER_NAME = /^(name|client)/i;
const HEADER_PAYMENT = /payment/i;
const HEADER_COACH = /^coach/i;
const HEADER_NEW = /^new/i;
const HEADER_OFFER = /^offer/i;
const HEADER_MONTHS = /months/i;

// Maximum rows to scan below the title looking for the header row.
const HEADER_LOOKAHEAD = 5;
// Maximum data rows to consume below the header before bailing.
const MAX_DATA_ROWS = 200;

function getAuth() {
  const email = process.env.COACHING_GOOGLE_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.COACHING_GOOGLE_KEY || process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error("Missing Google service account credentials");
  }
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function parseMoney(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// ----- Grid helpers --------------------------------------------------------

type Grid = (string | undefined)[][];

/** Find the (row, col) of the first cell matching `pattern` anywhere in the grid. */
function findCell(grid: Grid, pattern: RegExp): { row: number; col: number } | null {
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const v = (row[c] ?? "").toString();
      if (pattern.test(v)) return { row: r, col: c };
    }
  }
  return null;
}

/**
 * Below a known title cell, scan up to `HEADER_LOOKAHEAD` rows for a row that
 * contains a "Date" cell. Returns the row index of that header, or null.
 * Constrains the search to columns at-or-right of the title to avoid hitting
 * unrelated "Date" cells elsewhere on the sheet.
 */
function findHeaderRow(grid: Grid, titleRow: number, titleCol: number): number | null {
  const endRow = Math.min(grid.length, titleRow + 1 + HEADER_LOOKAHEAD);
  for (let r = titleRow + 1; r < endRow; r++) {
    const row = grid[r] ?? [];
    for (let c = titleCol; c < row.length; c++) {
      if (HEADER_DATE.test((row[c] ?? "").toString())) return r;
    }
  }
  return null;
}

interface RetentionColumns {
  date: number;
  name: number | null;
  payment: number | null;
  coach: number | null;
  isNew: number | null;
  offer: number | null;
  months: number | null;
}

/**
 * Given a header row and the title's column position, build the column-index
 * map by loose substring match. Only considers columns at-or-right of the
 * title (the retention table sits to the right of unrelated month columns).
 */
function mapRetentionColumns(headerRow: (string | undefined)[], titleCol: number): RetentionColumns {
  const find = (pattern: RegExp): number | null => {
    for (let c = titleCol; c < headerRow.length; c++) {
      if (pattern.test((headerRow[c] ?? "").toString())) return c;
    }
    return null;
  };
  const dateCol = find(HEADER_DATE);
  if (dateCol == null) {
    throw new Error("retention table: header row missing Date column");
  }
  return {
    date: dateCol,
    name: find(HEADER_NAME),
    payment: find(HEADER_PAYMENT),
    coach: find(HEADER_COACH),
    isNew: find(HEADER_NEW),
    offer: find(HEADER_OFFER),
    months: find(HEADER_MONTHS),
  };
}

// ----- Main handler --------------------------------------------------------

interface Diagnostics {
  retention_anchor_found: boolean;
  retention_header_found: boolean;
  retention_columns: Record<string, number | null> | null;
  retention_title_cell: string | null;
  warnings: string[];
}

export async function GET(request: Request) {
  const diagnostics: Diagnostics = {
    retention_anchor_found: false,
    retention_header_found: false,
    retention_columns: null,
    retention_title_cell: null,
    warnings: [],
  };

  try {
    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get("month");
    const monthIndex = monthParam !== null ? parseInt(monthParam, 10) : new Date().getMonth();
    const monthTab = MONTH_TABS[monthIndex];

    if (!monthTab) {
      return NextResponse.json({ error: "Invalid month" }, { status: 400 });
    }

    const sheets = google.sheets({ version: "v4", auth: getAuth() });

    // Read a wide block from the month tab so we capture the entire
    // retention section regardless of where it currently sits. The block
    // is intentionally generous (A1:BZ200) — Google Sheets returns
    // sparse arrays, so the cost is minor.
    const [refundsRes, retentionGridRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: REFUNDS_SHEET_ID,
        range: "A1:H500",
      }).catch((err) => {
        console.error("Refunds sheet fetch error:", err.message);
        diagnostics.warnings.push(`refunds: ${err.message}`);
        return null;
      }),

      sheets.spreadsheets.values.get({
        spreadsheetId: SALES_TRACKER_ID,
        range: `'${monthTab}'!A1:BZ200`,
      }).catch((err) => {
        console.error("Retention sheet fetch error:", err.message);
        diagnostics.warnings.push(`retention: ${err.message}`);
        return null;
      }),
    ]);

    // ----- Parse refunds (header-driven) -----
    const refunds: Array<{
      clientName: string;
      date: string;
      type: string;
      amount: number;
      fault: string;
      reason: string;
      salesPerson: string;
      disputed: string;
    }> = [];

    if (refundsRes?.data?.values) {
      const grid = refundsRes.data.values as Grid;
      const headerRow = grid[0] ?? [];
      // Map by header name with loose substring matching so column reorders
      // / renames in the refunds sheet don't silently corrupt parsing.
      const idx = {
        clientName: headerRow.findIndex((h) => /name|client/i.test(h ?? "")),
        date: headerRow.findIndex((h) => /date/i.test(h ?? "")),
        type: headerRow.findIndex((h) => /cancel|refund/i.test(h ?? "")),
        amount: headerRow.findIndex((h) => /amount/i.test(h ?? "")),
        reason: headerRow.findIndex((h) => /reason|comment/i.test(h ?? "")),
        salesPerson: headerRow.findIndex((h) => /sales/i.test(h ?? "")),
        disputed: headerRow.findIndex((h) => /dispute/i.test(h ?? "")),
        fault: headerRow.findIndex((h) => /fault/i.test(h ?? "")),
        offer: headerRow.findIndex((h) => /offer/i.test(h ?? "")),
      };
      // Fall back to positional indices when a column isn't found by header
      // (preserves backward compat with the original A-H layout).
      const col = (i: number, fallback: number) => (i >= 0 ? i : fallback);
      for (let r = 1; r < grid.length; r++) {
        const row = grid[r] ?? [];
        const clientName = (row[col(idx.clientName, 0)] ?? "").toString().trim();
        if (!clientName) continue;
        refunds.push({
          clientName,
          date: (row[col(idx.date, 1)] ?? "").toString().trim(),
          type: (row[col(idx.type, 2)] ?? "").toString().trim(),
          amount: parseMoney((row[col(idx.amount, 3)] ?? "").toString()),
          fault: (row[col(idx.fault, 4)] ?? "").toString().trim(),
          reason: (row[col(idx.reason, 5)] ?? "").toString().trim(),
          salesPerson: (row[col(idx.salesPerson, 6)] ?? "").toString().trim(),
          disputed: (row[col(idx.disputed, 7)] ?? "").toString().trim(),
        });
      }
    }

    // ----- Parse retention (anchor-based) -----
    const retentions: Array<{
      callNumber: string;
      date: string;
      clientName: string;
      paymentTotal: number;
      coach: string;
      isNew: string;
      offer: string;
      monthsSold: number;
    }> = [];

    if (retentionGridRes?.data?.values) {
      const grid = retentionGridRes.data.values as Grid;

      // 1. Find the "Flagship Retention Payments" title cell
      const title = findCell(grid, RETENTION_TITLE);
      if (!title) {
        diagnostics.warnings.push(
          `Could not find "Flagship Retention Payments" anchor on ${monthTab} tab`,
        );
      } else {
        diagnostics.retention_anchor_found = true;
        diagnostics.retention_title_cell = `row ${title.row + 1}, col ${title.col + 1}`;

        // 2. Below the title, find the header row (contains a "Date" cell)
        const headerRowIdx = findHeaderRow(grid, title.row, title.col);
        if (headerRowIdx == null) {
          diagnostics.warnings.push(
            `Found retention title at row ${title.row + 1} but no "Date" header within ${HEADER_LOOKAHEAD} rows below`,
          );
        } else {
          diagnostics.retention_header_found = true;
          const headerRow = grid[headerRowIdx] ?? [];

          try {
            const cols = mapRetentionColumns(headerRow, title.col);
            diagnostics.retention_columns = {
              date: cols.date,
              name: cols.name,
              payment: cols.payment,
              coach: cols.coach,
              isNew: cols.isNew,
              offer: cols.offer,
              months: cols.months,
            };

            // 3. Read data rows starting one below the header. Stop on the
            //    first row where both Date and Name (or Payment) are empty,
            //    which marks the end of the section.
            const endRow = Math.min(grid.length, headerRowIdx + 1 + MAX_DATA_ROWS);
            for (let r = headerRowIdx + 1; r < endRow; r++) {
              const row = grid[r] ?? [];
              const dateVal = (row[cols.date] ?? "").toString().trim();
              const nameVal = cols.name != null ? (row[cols.name] ?? "").toString().trim() : "";
              const paymentVal = cols.payment != null ? (row[cols.payment] ?? "").toString().trim() : "";

              // Stop scanning when we hit a fully empty row (end of section).
              if (!dateVal && !nameVal && !paymentVal) break;
              // Skip rows that have a date but no client name (template scaffold).
              if (!nameVal) continue;

              retentions.push({
                // call number isn't a guaranteed column anymore — use the
                // sheet row number as a stable identifier instead
                callNumber: `Row ${r + 1}`,
                date: dateVal,
                clientName: nameVal,
                paymentTotal: parseMoney(paymentVal),
                coach: cols.coach != null ? (row[cols.coach] ?? "").toString().trim() : "",
                isNew: cols.isNew != null ? (row[cols.isNew] ?? "").toString().trim() : "",
                offer: cols.offer != null ? (row[cols.offer] ?? "").toString().trim() : "",
                monthsSold: cols.months != null
                  ? parseInt((row[cols.months] ?? "0").toString(), 10) || 0
                  : 0,
              });
            }
          } catch (e) {
            diagnostics.warnings.push(
              `retention column mapping failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
    }

    // Filter refunds by selected month (any value parseable as a date in
    // that month is included; other rows are dropped from the per-month view).
    const refundsForMonth = refunds.filter((r) => {
      if (!r.date) return false;
      try {
        const d = new Date(r.date);
        return d.getMonth() === monthIndex;
      } catch {
        return false;
      }
    });

    return NextResponse.json({
      month: monthTab,
      monthIndex,
      refunds: refundsForMonth,
      allRefunds: refunds,
      retentions,
      diagnostics,
    });
  } catch (err) {
    console.error("Financials API error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, diagnostics }, { status: 500 });
  }
}
