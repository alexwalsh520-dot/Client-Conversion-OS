/**
 * Reads the "Admin Everfit Client Reports" Google Sheet and returns a parsed
 * set of per-client per-week rows.
 *
 * Sheet layout per coach tab (agreed with MAS 2026-09-15):
 *   Col A: Sr
 *   Col B: Client Name
 *   Col C: End Date
 *   Col D: Week 9/14       (label; format "Week M/D")
 *   Col E: Percentage %
 *   Col F: Notes
 *   Col G: Week 9/07
 *   Col H: Percentage %
 *   Col I: Notes
 *   ...   older weeks to the right
 *
 * Tabs named after a coach in capitals are what we read. Other tabs
 * (message archives, etc.) are skipped.
 *
 * Design notes:
 *   - We are strict about the header row: we look for a row that contains
 *     both "Client Name" and "End Date" in the first few columns, then infer
 *     week triples from the rest of that row.
 *   - Week labels are parsed to a real week_ending date. We assume the year
 *     is the current year; if that would put the date more than 90 days in
 *     the future, we roll back one year.
 *   - Coach names on tabs are canonicalized via the same alias map the JSON
 *     sync uses (extended for all-caps variants).
 */

import { google, type sheets_v4 } from "googleapis";
import { canonicalCoachName } from "./coach-aliases";

const norm = (s: string | null | undefined) =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export interface ParsedWeek {
  weekLabel: string;
  weekEndingAt: string; // YYYY-MM-DD
  workoutPct: number | null;
  note: string | null;
}

export interface ParsedRow {
  clientName: string;
  endDate: string | null; // YYYY-MM-DD
  coachName: string;      // canonical
  weeks: ParsedWeek[];
}

export interface ParseResult {
  tabsRead: string[];
  tabsSkipped: string[];
  rows: ParsedRow[];
  errors: { tab: string; message: string }[];
}

function getAuth() {
  const email = process.env.COACHING_GOOGLE_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.COACHING_GOOGLE_KEY || process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(
      "Missing COACHING_GOOGLE_EMAIL/COACHING_GOOGLE_KEY or GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY.",
    );
  }
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function getSheets(): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: getAuth() });
}

/** Parse a "Week 9/14" or "9/14" or "Sep 14" label into a YYYY-MM-DD.
 *  We interpret it as the WEEK ENDING date and infer the year (current year,
 *  or previous year if that puts it more than 90 days in the future). */
function parseWeekLabel(raw: string): string | null {
  const cleaned = raw.replace(/^week\s*/i, "").trim();
  const now = new Date();
  const y = now.getUTCFullYear();
  // Numeric M/D
  const md = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(cleaned);
  if (md) {
    const m = +md[1], d = +md[2];
    let yy = md[3] ? +md[3] : y;
    if (yy < 100) yy += 2000;
    let iso = new Date(Date.UTC(yy, m - 1, d));
    if (!md[3] && iso.getTime() - now.getTime() > 90 * 86_400_000) {
      iso = new Date(Date.UTC(yy - 1, m - 1, d));
    }
    return iso.toISOString().slice(0, 10);
  }
  // "Sep 14" fallback
  const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const t = /^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:,?\s*(\d{2,4}))?$/.exec(cleaned);
  if (t) {
    const m = MONTHS[t[1].slice(0, 3).toLowerCase()];
    if (m === undefined) return null;
    const d = +t[2];
    let yy = t[3] ? +t[3] : y;
    if (yy < 100) yy += 2000;
    let iso = new Date(Date.UTC(yy, m, d));
    if (!t[3] && iso.getTime() - now.getTime() > 90 * 86_400_000) {
      iso = new Date(Date.UTC(yy - 1, m, d));
    }
    return iso.toISOString().slice(0, 10);
  }
  return null;
}

/** Parse "80%", "80", "0.80" -> 80. NULL for empty/N/A. */
function parsePct(raw: string): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const cleaned = s.replace(/%/g, "").trim();
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  const scaled = n <= 1 ? n * 100 : n; // handles "0.80"
  return Math.max(0, Math.min(100, Math.round(scaled * 100) / 100));
}

/** Parse an end-date cell. Accepts M/D, M/D/YYYY, ISO, "Sep 14, 2026". */
function parseEndDate(raw: string): string | null {
  return parseWeekLabel(raw);
}

/** From a raw tab title (usually all-caps, e.g. "SHIRAAD" or "STEPHANIE HUGHES"),
 *  get the canonical CCOS coach name if it matches a known coach; otherwise
 *  return the title-cased title for the caller to compare against KNOWN_COACHES.
 *
 *  Title-case FIRST, then run through the alias map. canonicalCoachName only
 *  fires on the alias-map keys and otherwise passes through .trim() — that
 *  means a naked "SHIRAAD" would come back as "SHIRAAD" not "Shiraad" without
 *  the title-case step. */
export function tabToCoach(tabTitle: string): string | null {
  const raw = tabTitle.trim();
  if (!raw) return null;
  const titled = raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return canonicalCoachName(titled);
}

/** Which coach tab titles do we accept as "this tab is a coach's roster"?
 *  Kept permissive: any all-caps tab whose canonicalized name lands in
 *  KNOWN_COACHES. Update this set when the roster changes. */
const KNOWN_COACHES = new Set(
  ["Farrukh", "Stef", "Shiraad", "Martin", "Kevin", "Waleed", "Ahmad", "Fatima", "Belkys"].map((s) =>
    norm(s),
  ),
);

function isCoachTab(tabTitle: string): { yes: boolean; coach: string | null } {
  // Reject "Overview", "Legend", "Dashboard", etc. by only accepting tabs that
  // resolve to a known coach.
  const coach = tabToCoach(tabTitle);
  if (!coach) return { yes: false, coach: null };
  return { yes: KNOWN_COACHES.has(norm(coach)), coach };
}

/** Read the sheet + parse. Requires the CCOS service account to have viewer+
 *  access to the spreadsheet. */
export async function parseSheet(spreadsheetId: string): Promise<ParseResult> {
  const sheets = getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const tabTitles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title ?? "")
    .filter(Boolean);

  const coachTabs: { title: string; coach: string }[] = [];
  const tabsSkipped: string[] = [];
  for (const t of tabTitles) {
    const hit = isCoachTab(t);
    if (hit.yes && hit.coach) coachTabs.push({ title: t, coach: hit.coach });
    else tabsSkipped.push(t);
  }

  if (coachTabs.length === 0) {
    return {
      tabsRead: [],
      tabsSkipped,
      rows: [],
      errors: [
        {
          tab: "*",
          message:
            "No coach tabs found. Confirm the sheet has tabs named after coaches (e.g. FARRUKH, STEF).",
        },
      ],
    };
  }

  // Batch-read all coach tabs in one round-trip. Each tab is read A1:ZZ1000 —
  // more than enough for a 300-client sheet.
  const ranges = coachTabs.map((t) => `${quoteRange(t.title)}!A1:ZZ1000`);
  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const errors: { tab: string; message: string }[] = [];
  const rows: ParsedRow[] = [];

  const valueRanges = batch.data.valueRanges ?? [];
  for (let i = 0; i < coachTabs.length; i++) {
    const { title, coach } = coachTabs[i];
    const grid = (valueRanges[i]?.values ?? []) as (string | number)[][];
    if (!grid.length) {
      errors.push({ tab: title, message: "Empty tab." });
      continue;
    }
    try {
      const parsed = parseTab(grid, coach);
      rows.push(...parsed.rows);
      if (parsed.warning) errors.push({ tab: title, message: parsed.warning });
    } catch (e) {
      errors.push({ tab: title, message: (e as Error).message });
    }
  }

  return {
    tabsRead: coachTabs.map((t) => t.title),
    tabsSkipped,
    rows,
    errors,
  };
}

function quoteRange(title: string): string {
  // Sheets range needs single-quoted title when it contains special chars.
  return `'${title.replace(/'/g, "''")}'`;
}

interface TabParse {
  rows: ParsedRow[];
  warning?: string;
}

function parseTab(grid: (string | number)[][], coach: string): TabParse {
  // Find the header row: first row containing "Client Name" and "End Date"
  // in the first 6 columns.
  let headerRow = -1;
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const cells = (grid[i] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
    const hasName = cells.slice(0, 6).some((c) => c === "client name" || c === "client");
    const hasEnd = cells.slice(0, 6).some((c) => c === "end date");
    if (hasName && hasEnd) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) {
    return {
      rows: [],
      warning: "Could not find a header row with 'Client Name' + 'End Date'.",
    };
  }

  const header = grid[headerRow].map((c) => String(c ?? "").trim());
  // Column indexes
  const nameCol = header.findIndex((c) => /^client(\s*name)?$/i.test(c));
  const endCol = header.findIndex((c) => /^end\s*date$/i.test(c));
  if (nameCol === -1 || endCol === -1) {
    return { rows: [], warning: "Header row missing expected columns." };
  }

  // Week columns: any header cell matching /week/i or /^\d{1,2}\/\d{1,2}/.
  // The next two columns after a week header are "Percentage %" and "Notes".
  const weekTriples: { label: string; weekCol: number; pctCol: number; noteCol: number }[] = [];
  for (let c = 0; c < header.length; c++) {
    const cell = header[c];
    const isWeek = /^week\b/i.test(cell) || /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(cell);
    if (!isWeek) continue;
    weekTriples.push({
      label: cell.replace(/^week\s*/i, "").trim(),
      weekCol: c,
      pctCol: c + 1,
      noteCol: c + 2,
    });
  }
  if (weekTriples.length === 0) {
    return { rows: [], warning: "No week columns found." };
  }

  const rows: ParsedRow[] = [];
  for (let i = headerRow + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const clientName = String(row[nameCol] ?? "").trim();
    if (!clientName) continue;
    const endRaw = String(row[endCol] ?? "").trim();
    const endDate = endRaw ? parseEndDate(endRaw) : null;

    const weeks: ParsedWeek[] = [];
    for (const w of weekTriples) {
      const weekEnding = parseWeekLabel(w.label);
      if (!weekEnding) continue;
      const pct = parsePct(String(row[w.pctCol] ?? ""));
      const note = String(row[w.noteCol] ?? "").trim() || null;
      if (pct === null && !note) continue; // skip empty weeks
      weeks.push({ weekLabel: w.label, weekEndingAt: weekEnding, workoutPct: pct, note });
    }

    rows.push({
      clientName,
      endDate,
      coachName: coach,
      weeks,
    });
  }

  return { rows };
}
