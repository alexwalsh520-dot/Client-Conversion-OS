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
  offer: string; // Keith Holland, Tyson Sonnek, or Lucy Hubbard
  callType: string; // "Type of call" column: Strategy Session / Onboarding Call / Miscellaneous Chat
  manychatLink: string; // ManyChat chat link pasted by setters (newer "expanded" rows, col D)
  manychatSubscriberId: string | null; // stable subscriber ID parsed from the link
}

/**
 * Pull the ManyChat subscriber ID out of a pasted chat link.
 * Links look like https://app.manychat.com/fb<accountId>/chat/<subscriberId>
 * so the ID is the trailing number after /chat/. We also accept a bare number
 * (a setter pasting just the ID). Returns null when nothing usable is present —
 * callers then fall back to name matching, so a junk value never forces a match.
 */
export function manychatSubscriberIdFromLink(
  link: string | null | undefined
): string | null {
  if (!link) return null;
  const text = link.trim();
  if (!text) return null;
  // Preferred: the number right after "/chat/"
  const chatMatch = text.match(/\/chat\/(\d{3,})/i);
  if (chatMatch) return chatMatch[1];
  // Bare ID: the whole cell is just digits
  if (/^\d{3,}$/.test(text)) return text;
  // Fallback: the last run of 3+ digits anywhere in the string
  const digitRuns = text.match(/\d{3,}/g);
  if (digitRuns && digitRuns.length > 0) return digitRuns[digitRuns.length - 1];
  return null;
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
const SALES_TRACKER_SPREADSHEET_ID = "1890ucxVRqIPiXjs2-XoW517_RKKvPZC0tT-OU33av9o";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function getSheetId(): string {
  return SALES_TRACKER_SPREADSHEET_ID;
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

function normalizeHeader(val: string | undefined): string {
  return normalizeCell(val).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeaderIndex(
  headers: (string | undefined)[],
  candidates: string[],
): number {
  const normalizedCandidates = candidates.map((candidate) => normalizeHeader(candidate));
  return headers.findIndex((header) =>
    normalizedCandidates.includes(normalizeHeader(header))
  );
}

function headerValue(
  row: (string | undefined)[],
  index: number,
): string | undefined {
  return index >= 0 ? row[index] : undefined;
}

function normalizeSetterName(val: string | undefined): string {
  const normalized = normalizeCell(val).toUpperCase();
  if (!normalized) return "";

  const canonical: Record<string, string> = {
    AMARA: "Amara",
    KELCHI: "Kelechi",
    KELECHI: "Kelechi",
    GIDEON: "Gideon",
    DEBBIE: "Debbie",
    DEBBY: "Debbie",
    NAOMI: "Naomi",
    OTHER: "Other",
  };

  if (canonical[normalized]) return canonical[normalized];

  return normalized
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function usesExpandedSalesLayout(row: (string | undefined)[]): boolean {
  const offer = normalizeCell(row[18]).toLowerCase();
  return offer.includes("tyson") || offer.includes("keith") || offer.includes("lucy") || offer.includes("hubbard");
}

function getOfferForRow(
  row: (string | undefined)[],
  tab?: string,
  expandedLayout = false
): string {
  if (expandedLayout) return normalizeCell(row[18]);
  if (tab === "JANUARY") return "Tyson Sonnek";
  return normalizeCell(row[16]);
}

// ---------------------------------------------------------------------------
// API Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch raw values from a single monthly tab via Google Sheets API v4.
 * Range: A8:Z (row 8 = headers, rows 9+ = data). The row bound is left open
 * on purpose — a fixed ceiling (e.g. row 1000) would silently drop every sale
 * past that row in a high-volume month, the exact kind of invisible gap that
 * once hid two-thirds of a month's revenue. The API only returns populated
 * rows, so an open range costs nothing on a quiet month.
 */
interface TabValues {
  headers: (string | undefined)[];
  rows: (string | undefined)[][];
}

async function fetchTabValues(
  tab: string
): Promise<TabValues> {
  const sheetId = getSheetId();
  const apiKey = getApiKey();
  const range = encodeURIComponent(`${tab}!A8:Z`);
  const url = `${SHEETS_BASE_URL}/${sheetId}/values/${range}?key=${apiKey}`;

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    // 400 often means the tab doesn't exist — return empty
    if (response.status === 400 || response.status === 404) {
      console.warn(
        `[google-sheets] Tab "${tab}" not found or empty (HTTP ${response.status})`
      );
      return { headers: [], rows: [] };
    }
    const body = await response.text().catch(() => "");
    throw new Error(
      `Google Sheets API error (HTTP ${response.status}): ${body.substring(0, 200)}`
    );
  }

  const json = await response.json();
  const rows: (string | undefined)[][] = json.values || [];

  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return normalized.includes("date") &&
      normalized.includes("name") &&
      normalized.includes("offer");
  });

  if (headerIndex >= 0) {
    return {
      headers: rows[headerIndex],
      rows: rows.slice(headerIndex + 1),
    };
  }

  // Fallback for older tabs whose header row is not returned cleanly.
  if (rows.length <= 1) return { headers: [], rows: [] };
  return { headers: [], rows: rows.slice(1) };
}

async function fetchSubscriptionTabValues(
  tab: string
): Promise<TabValues> {
  const sheetId = getSheetId();
  const apiKey = getApiKey();
  const range = encodeURIComponent(`${tab}!AG4:AN`);
  const url = `${SHEETS_BASE_URL}/${sheetId}/values/${range}?key=${apiKey}`;

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    if (response.status === 400 || response.status === 404) return { headers: [], rows: [] };
    const body = await response.text().catch(() => "");
    throw new Error(
      `Google Sheets API error (HTTP ${response.status}): ${body.substring(0, 200)}`
    );
  }

  const json = await response.json();
  const rows: (string | undefined)[][] = json.values || [];
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return normalized.includes("date") &&
      normalized.includes("name") &&
      normalized.includes("offer");
  });

  if (headerIndex >= 0) {
    return {
      headers: rows[headerIndex],
      rows: rows.slice(headerIndex + 1),
    };
  }

  if (rows.length <= 1) return { headers: [], rows: [] };
  return { headers: [], rows: rows.slice(1) };
}

/**
 * Parse a raw row array into a SheetRow.
 * Legacy columns: A=0 Call#, B=1 Date, C=2 Name, D=3 Call Taken, E=4 Call Length,
 *   F=5 Recorded?, G=6 Outcome, H=7 Closer, I=8 Objection, J=9 Program Length,
 *   K=10 Revenue, L=11 Cash Collected, M=12 Method, N=13 Setter,
 *   O=14 Call Notes, P=15 Call Recording Link, Q=16 Offer
 * Expanded columns include Manychat Link at D and Ad Type at E, shifting
 * the sales fields two columns to the right and Offer to S=18.
 */
function parseHeaderRow(
  row: (string | undefined)[],
  headers: (string | undefined)[],
): SheetRow | null {
  const dateIdx = findHeaderIndex(headers, ["Date"]);
  const nameIdx = findHeaderIndex(headers, ["Name"]);
  const manychatIdx = findHeaderIndex(headers, ["Manychat Link", "ManyChat Link"]);
  const callTakenIdx = findHeaderIndex(headers, ["Call Taken"]);
  const callLengthIdx = findHeaderIndex(headers, ["Call Length"]);
  const recordedIdx = findHeaderIndex(headers, ["Recorded"]);
  const outcomeIdx = findHeaderIndex(headers, ["Outcome"]);
  const closerIdx = findHeaderIndex(headers, ["Closer"]);
  const objectionIdx = findHeaderIndex(headers, ["Objection"]);
  const programLengthIdx = findHeaderIndex(headers, ["Program Length", "Program Length Months"]);
  const revenueIdx = findHeaderIndex(headers, ["Revenue"]);
  const cashCollectedIdx = findHeaderIndex(headers, ["Cash Collected"]);
  const methodIdx = findHeaderIndex(headers, ["Method"]);
  const setterIdx = findHeaderIndex(headers, ["Setter"]);
  const callNotesIdx = findHeaderIndex(headers, ["Call Notes"]);
  const recordingLinkIdx = findHeaderIndex(headers, ["Call Recording Link", "Recording Link"]);
  const offerIdx = findHeaderIndex(headers, ["Offer"]);
  const callTypeIdx = findHeaderIndex(headers, ["Type of call", "Type of Call", "Call Type"]);
  const callNumberIdx = Math.max(0, dateIdx - 1);

  const dateStr = parseDateString(headerValue(row, dateIdx));
  if (!dateStr) return null;

  const callTakenStatus = parseCallTakenStatus(headerValue(row, callTakenIdx));
  const manychatLink = normalizeCell(headerValue(row, manychatIdx));

  return {
    callNumber: normalizeCell(headerValue(row, callNumberIdx)),
    date: dateStr,
    name: normalizeCell(headerValue(row, nameIdx)),
    callTaken: callTakenStatus === "yes",
    callTakenStatus,
    callLength: normalizeCell(headerValue(row, callLengthIdx)),
    recorded: parseBoolField(headerValue(row, recordedIdx)),
    outcome: normalizeCell(headerValue(row, outcomeIdx)).toUpperCase(),
    closer: normalizeCell(headerValue(row, closerIdx)).toUpperCase(),
    objection: normalizeCell(headerValue(row, objectionIdx)),
    programLength: normalizeCell(headerValue(row, programLengthIdx)),
    revenue: parseRevenue(headerValue(row, revenueIdx) || ""),
    cashCollected: parseRevenue(headerValue(row, cashCollectedIdx) || ""),
    method: normalizeCell(headerValue(row, methodIdx)).toUpperCase(),
    setter: normalizeSetterName(headerValue(row, setterIdx)),
    callNotes: normalizeCell(headerValue(row, callNotesIdx)),
    recordingLink: normalizeCell(headerValue(row, recordingLinkIdx)),
    offer: normalizeCell(headerValue(row, offerIdx)),
    callType: normalizeCell(headerValue(row, callTypeIdx)),
    manychatLink,
    manychatSubscriberId: manychatSubscriberIdFromLink(manychatLink),
  };
}

function parseRow(
  row: (string | undefined)[],
  tab?: string,
  headers: (string | undefined)[] = [],
): SheetRow | null {
  if (headers.length > 0) return parseHeaderRow(row, headers);

  const dateStr = parseDateString(row[1]);
  // Skip rows without a parseable date — they're likely blank or summary rows
  if (!dateStr) return null;

  const isJanuary = tab === "JANUARY";
  const expandedLayout = usesExpandedSalesLayout(row);
  // The ManyChat chat link only exists on the newer "expanded" layout (col D).
  const manychatLink = expandedLayout ? normalizeCell(row[3]) : "";
  const callTakenStatus = parseCallTakenStatus(row[expandedLayout ? 5 : 3]);
  const setter = normalizeSetterName(
    expandedLayout ? row[15] : isJanuary ? row[12] : row[13]
  );
  const offer = getOfferForRow(row, tab, expandedLayout);

  return {
    callNumber: normalizeCell(row[0]),
    date: dateStr,
    name: normalizeCell(row[2]),
    callTaken: callTakenStatus === "yes",
    callTakenStatus,
    callLength: normalizeCell(row[expandedLayout ? 6 : 4]),
    recorded: parseBoolField(row[expandedLayout ? 7 : 5]),
    outcome: normalizeCell(row[expandedLayout ? 8 : 6]).toUpperCase(),
    closer: normalizeCell(row[expandedLayout ? 9 : 7]).toUpperCase(),
    objection: normalizeCell(row[expandedLayout ? 10 : 8]),
    programLength: normalizeCell(row[expandedLayout ? 11 : 9]),
    revenue: parseRevenue(
      row[expandedLayout ? 12 : isJanuary ? 9 : 10] || ""
    ),
    cashCollected: parseRevenue(
      row[expandedLayout ? 13 : isJanuary ? 10 : 11] || ""
    ),
    method: normalizeCell(
      row[expandedLayout ? 14 : isJanuary ? 11 : 12]
    ).toUpperCase(),
    setter,
    callNotes: normalizeCell(row[expandedLayout ? 16 : isJanuary ? 13 : 14]),
    recordingLink: normalizeCell(
      row[expandedLayout ? 17 : isJanuary ? 14 : 15]
    ),
    offer,
    callType: "",
    manychatLink,
    manychatSubscriberId: manychatSubscriberIdFromLink(manychatLink),
  };
}

function parseSubscriptionHeaderRow(
  row: (string | undefined)[],
  headers: (string | undefined)[],
): SheetRow | null {
  const dateIdx = findHeaderIndex(headers, ["Date"]);
  const nameIdx = findHeaderIndex(headers, ["Name"]);
  const closerIdx = findHeaderIndex(headers, ["Closer"]);
  const amountIdx = findHeaderIndex(headers, ["New MRR", "Amount"]);
  const sourceIdx = findHeaderIndex(headers, ["Source"]);
  const offerIdx = findHeaderIndex(headers, ["Offer"]);
  const callTypeIdx = findHeaderIndex(headers, ["Type of call", "Type of Call", "Call Type"]);
  const callNumberIdx = Math.max(0, dateIdx - 1);

  const dateStr = parseDateString(headerValue(row, dateIdx));
  if (!dateStr) return null;

  const name = normalizeCell(headerValue(row, nameIdx));
  const amount = parseRevenue(headerValue(row, amountIdx) || "");
  const source = normalizeCell(headerValue(row, sourceIdx));
  const offer = normalizeCell(headerValue(row, offerIdx));

  if (!name || !offer) return null;
  if (!amount && !source) return null;

  return {
    callNumber: normalizeCell(headerValue(row, callNumberIdx)),
    date: dateStr,
    name,
    callTaken: false,
    callTakenStatus: "pending",
    callLength: "",
    recorded: false,
    outcome: amount > 0 ? "WIN" : "REFUNDED",
    closer: normalizeCell(headerValue(row, closerIdx)).toUpperCase(),
    objection: "",
    programLength: "Subscription",
    revenue: amount,
    cashCollected: amount,
    method: source,
    setter: normalizeSetterName(headerValue(row, closerIdx)),
    callNotes: "",
    recordingLink: "",
    offer,
    callType: normalizeCell(headerValue(row, callTypeIdx)),
    manychatLink: "",
    manychatSubscriberId: null,
  };
}

function parseSubscriptionRow(
  row: (string | undefined)[],
  headers: (string | undefined)[] = [],
): SheetRow | null {
  if (headers.length > 0) return parseSubscriptionHeaderRow(row, headers);

  const dateStr = parseDateString(row[1]);
  if (!dateStr) return null;

  const name = normalizeCell(row[2]);
  const amount = parseRevenue(row[4] || "");
  const source = normalizeCell(row[5]);
  const offer = normalizeCell(row[6]);

  if (!name || !offer) return null;
  if (!amount && !source) return null;

  return {
    callNumber: normalizeCell(row[0]),
    date: dateStr,
    name,
    callTaken: false,
    callTakenStatus: "pending",
    callLength: "",
    recorded: false,
    outcome: amount > 0 ? "WIN" : "REFUNDED",
    closer: normalizeCell(row[3]).toUpperCase(),
    objection: "",
    programLength: "Subscription",
    revenue: amount,
    cashCollected: amount,
    method: source,
    setter: normalizeSetterName(row[3]),
    callNotes: normalizeCell(row[7]),
    recordingLink: "",
    offer,
    callType: "",
    manychatLink: "",
    manychatSubscriberId: null,
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
  const [tabResults, subscriptionTabResults] = await Promise.all([
    Promise.all(
      tabEntries.map((tab) =>
        fetchTabValues(tab).catch((err) => {
          console.error(`[google-sheets] Error fetching tab "${tab}":`, err);
          return { headers: [], rows: [] } as TabValues;
        })
      )
    ),
    Promise.all(
      tabEntries.map((tab) =>
        fetchSubscriptionTabValues(tab).catch((err) => {
          console.error(
            `[google-sheets] Error fetching subscription table "${tab}":`,
            err
          );
          return { headers: [], rows: [] } as TabValues;
        })
      )
    ),
  ]);

  // Parse and filter rows
  const allRows: SheetRow[] = [];
  const fromISO = dateFrom; // YYYY-MM-DD
  const toISO = dateTo;

  for (let i = 0; i < tabResults.length; i++) {
    const { headers, rows: rawRows } = tabResults[i];
    const tab = tabEntries[i];
    for (const raw of rawRows) {
      const parsed = parseRow(raw, tab, headers);
      if (!parsed) continue;

      // Filter by date range (string comparison works for YYYY-MM-DD)
      if (parsed.date >= fromISO && parsed.date <= toISO) {
        allRows.push(parsed);
      }
    }

    const { headers: subscriptionHeaders, rows: rawSubscriptionRows } = subscriptionTabResults[i] || { headers: [], rows: [] };
    for (const raw of rawSubscriptionRows) {
      const parsed = parseSubscriptionRow(raw, subscriptionHeaders);
      if (!parsed) continue;

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
 * Fetch the subscriptions sold count from the monthly tab summary row.
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
      const range = encodeURIComponent(`${tab}!A1:Z4`);
      const url = `${SHEETS_BASE_URL}/${sheetId}/values/${range}?key=${apiKey}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const json = await response.json();
      const rows: (string | undefined)[][] = json.values || [];
      let val: string | undefined;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const colIndex = rows[rowIndex].findIndex(
          (cell) => normalizeHeader(cell) === "subscriptions"
        );
        if (colIndex < 0) continue;
        val = rows[rowIndex][colIndex + 1] || rows[rowIndex + 1]?.[colIndex];
        break;
      }
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
