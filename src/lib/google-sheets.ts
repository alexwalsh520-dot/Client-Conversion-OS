// Google Sheets API v4 client for reading closer performance data (Sales Manager Hub)
// Uses API key auth via fetch() — no googleapis SDK dependency
// Reads from monthly tabs (JANUARY, FEBRUARY, etc.) with headers at row 9, data at row 10+

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SheetRow {
  callNumber: string;
  date: string;
  name: string;
  callTaken: boolean;
  callTakenStatus: "yes" | "no" | "pending";
  callLength: string;
  recorded: boolean;
  outcome: string; // WIN, LOST, NS-RS, PCFU, NOT A FIT
  closer: string;
  objection: string;
  programLength: string;
  revenue: number;
  cashCollected: number;
  method: string; // KLARNA, PIF, AFFIRM
  setter: string;
  callNotes: string;
  recordingLink: string;
  offer: string; // Keith Holland or Tyson Sonnek
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
] as const;

const SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function getSheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) {
    throw new Error(
      "Missing environment variable GOOGLE_SHEETS_SPREADSHEET_ID"
    );
  }
  return id;
}

function getApiKey(): string {
  const key = process.env.GOOGLE_SHEETS_API_KEY;
  if (!key) {
    throw new Error("Missing environment variable GOOGLE_SHEETS_API_KEY");
  }
  return key;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a revenue/currency string like "$1,200.00" into a number.
 * Strips dollar signs, commas, and whitespace. Returns 0 for unparseable values.
 */
export function parseRevenue(val: string): number {
  if (!val || typeof val !== "string") return 0;
  const cleaned = val.replace(/[$,\s]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Get the uppercase month tab name (JANUARY, FEBRUARY, etc.) from a Date.
 */
export function getMonthTab(date: Date): string {
  return MONTH_NAMES[date.getMonth()];
}

/**
 * Parse a date string from the sheet into a normalized YYYY-MM-DD string.
 * Handles formats like:
 *   - "3/5/2026" (M/D/YYYY)
 *   - "03/05/2026" (MM/DD/YYYY)
 *   - "3.5.26" (M.D.YY)
 *   - "March 5, 2026"
 *   - "2026-03-05" (ISO)
 */
function parseDateString(val: string | undefined | null): string | null {
  if (!val || typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed) return null;

  // Try M/D/YYYY or MM/DD/YYYY format first (most common in this sheet)
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10);
    const day = parseInt(slashMatch[2], 10);
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) {
        return formatDateISO(d);
      }
    }
  }

  // Try M.D.YY or M.D.YYYY format used in January
  const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotMatch) {
    const month = parseInt(dotMatch[1], 10);
    const day = parseInt(dotMatch[2], 10);
    let year = parseInt(dotMatch[3], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) {
        return formatDateISO(d);
      }
    }
  }

  // Try ISO format YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(
      parseInt(isoMatch[1], 10),
      parseInt(isoMatch[2], 10) - 1,
      parseInt(isoMatch[3], 10)
    );
    if (!isNaN(d.getTime())) {
      return formatDateISO(d);
    }
  }

  // Fallback: try native Date parsing for "March 5, 2026" etc.
  const d = new Date(trimmed);
  if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
    return formatDateISO(d);
  }

  return null;
}

function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseBoolField(val: string | undefined | null): boolean {
  if (!val) return false;
  const lower = val.trim().toLowerCase();
  return lower === "yes" || lower === "y" || lower === "true" || lower === "1";
}

function parseCallTakenStatus(val: string | undefined | null): "yes" | "no" | "pending" {
  if (!val || !val.trim()) return "pending";
  const lower = val.trim().toLowerCase();
  if (lower === "yes" || lower === "y" || lower === "true" || lower === "1") return "yes";
  if (lower === "no" || lower === "n" || lower === "false" || lower === "0") return "no";
  return "pending";
}

function normalizeCell(val: string | undefined): string {
  return (val || "").trim();
}

// ---------------------------------------------------------------------------
// API Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch raw values from a single monthly tab via Google Sheets API v4.
 * Range: A8:Q200 (row 8 = headers, rows 9+ = data).
 */
async function fetchTabValues(
  tab: string
): Promise<(string | undefined)[][]> {
  const sheetId = getSheetId();
  const apiKey = getApiKey();
  const range = encodeURIComponent(`${tab}!A8:Q200`);
  const url = `${SHEETS_BASE_URL}/${sheetId}/values/${range}?key=${apiKey}`;

  const response = await fetch(url);

  if (!response.ok) {
    // 400 often means the tab doesn't exist — return empty
    if (response.status === 400 || response.status === 404) {
      console.warn(
        `[google-sheets] Tab "${tab}" not found or empty (HTTP ${response.status})`
      );
      return [];
    }
    const body = await response.text().catch(() => "");
    throw new Error(
      `Google Sheets API error (HTTP ${response.status}): ${body.substring(0, 200)}`
    );
  }

  const json = await response.json();
  const rows: (string | undefined)[][] = json.values || [];

  // First row is headers (row 8), data starts from index 1 (row 9)
  if (rows.length <= 1) return [];
  return rows.slice(1); // skip header row
}

/**
 * Parse a raw row array into a SheetRow.
 * Columns: A=0 Call#, B=1 Date, C=2 Name, D=3 Call Taken, E=4 Call Length,
 *   F=5 Recorded?, G=6 Outcome, H=7 Closer, I=8 Objection, J=9 Program Length,
 *   K=10 Revenue, L=11 Cash Collected, M=12 Method, N=13 Setter,
 *   O=14 Call Notes, P=15 Call Recording Link, Q=16 Offer
 */
function parseRow(row: (string | undefined)[], tab?: string): SheetRow | null {
  const dateStr = parseDateString(row[1]);
  // Skip rows without a parseable date — they're likely blank or summary rows
  if (!dateStr) return null;

  const isJanuary = tab === "JANUARY";
  const callTakenStatus = parseCallTakenStatus(row[3]);
  const setter = isJanuary ? normalizeCell(row[12]) : normalizeCell(row[13]);
  const offer = isJanuary ? "" : normalizeCell(row[16]);

  return {
    callNumber: normalizeCell(row[0]),
    date: dateStr,
    name: normalizeCell(row[2]),
    callTaken: callTakenStatus === "yes",
    callTakenStatus,
    callLength: normalizeCell(row[4]),
    recorded: parseBoolField(row[5]),
    outcome: normalizeCell(row[6]).toUpperCase(),
    closer: normalizeCell(row[7]).toUpperCase(),
    objection: normalizeCell(row[8]),
    programLength: normalizeCell(row[9]),
    revenue: parseRevenue(row[isJanuary ? 9 : 10] || ""),
    cashCollected: parseRevenue(row[isJanuary ? 10 : 11] || ""),
    method: normalizeCell(row[isJanuary ? 11 : 12]).toUpperCase(),
    setter,
    callNotes: normalizeCell(row[isJanuary ? 13 : 14]),
    recordingLink: normalizeCell(row[isJanuary ? 14 : 15]),
    offer,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch rows from Google Sheets for a date range.
 *
 * Determines which monthly tab(s) to query based on dateFrom/dateTo, fetches
 * the data, parses rows, and filters to the requested date range.
 *
 * @param dateFrom - Start date (inclusive), ISO format YYYY-MM-DD
 * @param dateTo   - End date (inclusive), ISO format YYYY-MM-DD
 * @returns Array of parsed SheetRow objects within the date range
 */
export async function fetchSheetData(
  dateFrom: string,
  dateTo: string
): Promise<SheetRow[]> {
  const from = new Date(dateFrom + "T00:00:00");
  const to = new Date(dateTo + "T23:59:59");

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error(
      `Invalid date range: dateFrom="${dateFrom}", dateTo="${dateTo}"`
    );
  }

  if (from > to) {
    throw new Error(
      `dateFrom (${dateFrom}) must be before or equal to dateTo (${dateTo})`
    );
  }

  // Determine which monthly tabs we need to query
  const tabsToQuery = new Set<string>();
  const cursor = new Date(from);
  cursor.setDate(1); // start of the from-month

  while (cursor <= to) {
    tabsToQuery.add(getMonthTab(cursor));
    // Move to next month
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // Fetch all tabs in parallel
  const tabEntries = Array.from(tabsToQuery);
  const tabResults = await Promise.all(
    tabEntries.map((tab) =>
      fetchTabValues(tab).catch((err) => {
        console.error(`[google-sheets] Error fetching tab "${tab}":`, err);
        return [] as (string | undefined)[][];
      })
    )
  );

  // Parse and filter rows
  const allRows: SheetRow[] = [];
  const fromISO = dateFrom; // YYYY-MM-DD
  const toISO = dateTo;

  for (let i = 0; i < tabResults.length; i++) {
    const rawRows = tabResults[i];
    const tab = tabEntries[i];
    for (const raw of rawRows) {
      const parsed = parseRow(raw, tab);
      if (!parsed) continue;

      // Filter by date range (string comparison works for YYYY-MM-DD)
      if (parsed.date >= fromISO && parsed.date <= toISO) {
        allRows.push(parsed);
      }
    }
  }

  // Sort by date ascending, then by call number
  allRows.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return a.callNumber.localeCompare(b.callNumber, undefined, {
      numeric: true,
    });
  });

  return allRows;
}

/**
 * Fetch the subscriptions sold count from cell Q3 in a monthly tab.
 * The sheet has a summary cell at Q3 that contains the subscription count.
 */
export async function fetchSubscriptionsSold(
  dateFrom: string,
  dateTo: string
): Promise<number> {
  const from = new Date(dateFrom + "T00:00:00");
  const to = new Date(dateTo + "T23:59:59");

  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 0;

  // Determine which monthly tabs to query
  const tabsToQuery = new Set<string>();
  const cursor = new Date(from);
  cursor.setDate(1);
  while (cursor <= to) {
    tabsToQuery.add(getMonthTab(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const sheetId = getSheetId();
  const apiKey = getApiKey();
  let total = 0;

  for (const tab of tabsToQuery) {
    try {
      const range = encodeURIComponent(`${tab}!Q3`);
      const url = `${SHEETS_BASE_URL}/${sheetId}/values/${range}?key=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const json = await response.json();
      const val = json.values?.[0]?.[0];
      if (val) {
        const num = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
        if (!isNaN(num)) total += num;
      }
    } catch {
      // Non-critical — continue
    }
  }

  return total;
}
