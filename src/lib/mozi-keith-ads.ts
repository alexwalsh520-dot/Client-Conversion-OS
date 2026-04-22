// Pull Keith's last-30d ad spend from the Google Sheets ad tracker.
// Sheet: "Keith [ACTIVE] Ads Tracker 2/22/26"
// Tabs:  "Jan", "Feb", ..., "Dec"  (current month may be labeled "(Current) {Mon}")
// Layout: col A = "Mon, Mar 1" style date · col B = "$103.88" style ad spend.

const SHEET_ID = "1DomGcRLp4NBV-nlXVq-zfq9vg8jPPNa1Wq4aalVr_Xk";
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface SheetValuesResponse {
  values?: string[][];
}

function parseDollarsToCents(s: string | undefined): number {
  if (!s) return 0;
  const clean = s.replace(/[$,\s]/g, "");
  const n = parseFloat(clean);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// Accepts "Sun, Mar 1" or "Sun, Mar 1, 2026" or similar. Returns a Date or null.
function parseDateCell(cell: string | undefined, tabMonthIndex: number, year: number): Date | null {
  if (!cell) return null;
  const match = cell.match(/([A-Z][a-z]{2})\s+(\d{1,2})/);
  if (!match) return null;
  const mo = MONTHS_SHORT.indexOf(match[1]);
  const day = parseInt(match[2], 10);
  if (mo < 0 || !day) return null;
  // Trust the tab month over any month text in the cell — covers edge cases.
  return new Date(year, tabMonthIndex, day);
}

async function fetchTabRows(tabName: string, apiKey: string): Promise<string[][]> {
  // Tab might be "Mar" or "(Current) Mar" — try both.
  const candidates = [tabName, `(Current) ${tabName}`];
  for (const tab of candidates) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(
      tab + "!A1:B45",
    )}?key=${apiKey}`;
    const res = await fetch(url);
    if (res.ok) {
      const j = (await res.json()) as SheetValuesResponse;
      if (j.values && j.values.length > 0) return j.values;
    }
  }
  return [];
}

export interface KeithAdSpendBreakdown {
  totalCents: number;
  daysCovered: number;
  dailyLines: Array<{ date: string; cents: number }>;
}

export async function fetchKeithAdSpendLast30d(now: Date = new Date()): Promise<KeithAdSpendBreakdown> {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) return { totalCents: 0, daysCovered: 0, dailyLines: [] };

  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  // Figure out which month tabs we need (current + possibly previous + possibly one before that if window crosses)
  const neededTabs = new Set<{ month: number; year: number }>();
  const cursor = new Date(windowStart);
  cursor.setDate(1);
  while (cursor <= now) {
    neededTabs.add({ month: cursor.getMonth(), year: cursor.getFullYear() });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const dailyLines: KeithAdSpendBreakdown["dailyLines"] = [];
  let totalCents = 0;

  for (const { month, year } of neededTabs) {
    const tabName = MONTHS_SHORT[month];
    const rows = await fetchTabRows(tabName, apiKey);
    if (rows.length === 0) continue;

    for (let i = 0; i < rows.length; i++) {
      const [dateCell, spendCell] = rows[i] ?? [];
      if (!dateCell) continue;
      if (dateCell.toLowerCase().includes("targets")) continue; // skip header row
      const d = parseDateCell(dateCell, month, year);
      if (!d) continue;
      if (d < windowStart || d > now) continue;
      const cents = parseDollarsToCents(spendCell);
      if (cents <= 0) continue;
      dailyLines.push({ date: d.toISOString().slice(0, 10), cents });
      totalCents += cents;
    }
  }

  return { totalCents, daysCovered: dailyLines.length, dailyLines };
}
