// Google Sheets API fetching layer for CCOS
// Authenticates via service account, reads all 5 business sheets
// Server-side only — used by /api/sync route

import { google } from "googleapis";

// Sheet IDs extracted from Google Sheets URLs
const SHEET_IDS = {
  coachingFeedback: "196qJOcCvx37GlRA1wJ8aCDCaXBJfqJ_nqdGaVi8TfEY",
  onboarding: "1XcQeG_ehg5BYCsSEJllelT0zVaJJwjRE1OZWf4gjeTo",
  sales: "1890ucxVRqIPiXjs2-XoW517_RKKvPZC0tT-OU33av9o",
  tysonAds: "1r7UXESjrCvqg3Uf0sm0GGlzKuKlkpUR1Z5RjHbcYmAY",
  keithAds: "1DomGcRLp4NBV-nlXVq-zfq9vg8jPPNa1Wq4aalVr_Xk",
};

// Row types matching Supabase table columns (snake_case)
export interface CoachingRow {
  timestamp: string | null;
  client_name: string;
  coach_rating: number;
  workout_completion: string;
  missed_reason: string;
  sleep_rating: number;
  nutrition_rating: number;
  energy_rating: number;
  nps_score: number;
  feedback: string;
  wins: string;
  coach_name: string;
  date: string | null;
}

export interface OnboardingRow {
  onboarder: string;
  client: string;
  email: string;
  closer: string;
  amount_paid: number;
  pif: string;
  reschedule_email_sent: boolean;
  reminder_email: boolean;
  reach_out_closer: boolean;
  comments: string;
  status: string;
}

export interface CloserRow {
  month: string;
  closer_name: string;
  calls_booked: number;
  calls_taken: number;
  closed: number;
  lost: number;
  revenue: number;
  cash_collected: number;
  aov: number;
  close_rate: number;
}

export interface SetterRow {
  month: string;
  setter_name: string;
  messages_handled: number;
  calls_booked: number;
  conversion_rate: number;
  source: string;
}

export interface AdsDailyRow {
  source: string;
  date: string;
  ad_spend: number;
  impressions: number;
  cpi: number;
  link_clicks: number;
  ctr: number;
  cpc: number;
  messages: number;
  cost_per_message: number;
  calls_60_booked: number;
  cost_per_60_booked: number;
  calls_60_taken: number;
  show_up_60_pct: number;
  new_clients: number;
  close_rate: number;
  msg_conversion_rate: number;
  contracted_revenue: number;
  collected_revenue: number;
  cost_per_client: number;
  contracted_roi: number;
  collected_roi: number;
}

// ---- Auth ----

function getAuth() {
  // Use dedicated coaching env vars, fall back to shared ones
  const email = process.env.COACHING_GOOGLE_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.COACHING_GOOGLE_KEY || process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(
      "Missing COACHING_GOOGLE_EMAIL/COACHING_GOOGLE_KEY or GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY"
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

function getSheets() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

// ---- Helpers ----

function parseNum(val: string | undefined | null): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$,%]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseBool(val: string | undefined | null): boolean {
  if (!val) return false;
  const lower = val.toLowerCase().trim();
  return (
    lower === "true" ||
    lower.startsWith("yes") ||
    lower === "y" ||
    lower === "1"
  );
}

function parseDate(val: string | undefined | null, fallbackYear?: number): string | null {
  if (!val) return null;
  let trimmed = val.trim();
  if (!trimmed) return null;

  // Strip ordinal suffixes: "10th October" → "10 October", "1st December" → "1 December"
  trimmed = trimmed.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');

  try {
    // Handle M/D/YYYY or D/M/YYYY format (with optional HH:MM:SS timestamp)
    // e.g. "03/16/2026", "21/11/2025 12:49:50"
    const slashDateMatch = trimmed.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s|$)/
    );
    if (slashDateMatch) {
      let a = parseInt(slashDateMatch[1]);
      let b = parseInt(slashDateMatch[2]);
      let year = parseInt(slashDateMatch[3]);
      if (year < 100) year += 2000; // Handle 2-digit years like "26" → 2026
      let month: number, day: number;
      if (b > 12) {
        // Second number > 12 → must be MM/DD/YYYY (US format)
        month = a; day = b;
      } else if (a > 12) {
        // First number > 12 → must be DD/MM/YYYY
        month = b; day = a;
      } else {
        // Both ≤ 12 → ambiguous. Default to MM/DD (US format) but sanity-check:
        // If MM/DD would put the date > 6 months in the future and DD/MM gives
        // a recent date, prefer DD/MM (likely day-first entry).
        const now = new Date();
        const mmdd = new Date(year, a - 1, b);
        const ddmm = new Date(year, b - 1, a);
        const sixMonths = 180 * 24 * 60 * 60 * 1000;
        if (mmdd.getTime() - now.getTime() > sixMonths && ddmm.getTime() <= now.getTime()) {
          // MM/DD is far future but DD/MM is recent — likely day-first entry
          month = b; day = a;
        } else {
          month = a; day = b;
        }
      }
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) return d.toISOString().split("T")[0];
    }

    // Handle "M/D" format without year (e.g. "1/26", "12/31") — use fallbackYear if provided
    // MUST check this BEFORE new Date() because new Date("1/26") returns year 2001 (wrong)
    const mdMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (mdMatch) {
      if (fallbackYear) {
        const month = parseInt(mdMatch[1]);
        const day = parseInt(mdMatch[2]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          const d3 = new Date(fallbackYear, month - 1, day);
          if (!isNaN(d3.getTime())) return d3.toISOString().split("T")[0];
        }
      }
      // No fallback year and no 4-digit year — skip to avoid defaulting to 2001
      return null;
    }

    // Handle "Mon DD" or "Month DD" format without year (e.g. "Jan 26", "January 26")
    // — use fallbackYear if provided, otherwise skip
    const monDayMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
    if (monDayMatch) {
      if (fallbackYear) {
        const d4 = new Date(`${monDayMatch[0]}, ${fallbackYear}`);
        if (!isNaN(d4.getTime())) return d4.toISOString().split("T")[0];
      }
      return null;
    }

    // Handle "DD Month" or "DD Month YYYY" format (e.g. "10 October", "15 September 2025")
    const dayMonMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/);
    if (dayMonMatch) {
      const year = dayMonMatch[3] ? parseInt(dayMonMatch[3]) : fallbackYear;
      if (year) {
        const d5 = new Date(`${dayMonMatch[2]} ${dayMonMatch[1]}, ${year}`);
        if (!isNaN(d5.getTime())) return d5.toISOString().split("T")[0];
      }
      return null;
    }

    // Handle standard date formats with full year: "2/3/2026", "Feb 1, 2026", "2026-01-26", etc.
    // Only accept dates with year >= 2020 to guard against ambiguous parsing defaults
    const d = new Date(trimmed);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
      return d.toISOString().split("T")[0]; // YYYY-MM-DD
    }

    // Handle "2.3.26" format (month.day.year with 2-digit year)
    const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (dotMatch) {
      const month = parseInt(dotMatch[1]);
      const day = parseInt(dotMatch[2]);
      let year = parseInt(dotMatch[3]);
      if (year < 100) year += 2000;
      const d2 = new Date(year, month - 1, day);
      if (!isNaN(d2.getTime())) return d2.toISOString().split("T")[0];
    }

    // All other formats (e.g. "Thu, Jan 1" without year) — skip
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a DD/MM/YYYY HH:MM:SS timestamp into ISO format for TIMESTAMPTZ
 */
function parseTimestamp(val: string | undefined | null): string | null {
  if (!val) return null;
  const trimmed = val.trim();

  // Match "DD/MM/YYYY HH:MM:SS"
  const m = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
  );
  if (m) {
    const [, day, month, year, hour, min, sec] = m;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${min}:${sec}`;
  }

  // Fallback to standard parsing
  const d = new Date(trimmed);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
    return d.toISOString();
  }

  return null;
}

// ---- Fetch Functions ----

/**
 * Fetch coaching feedback (weekly survey) from Product Health Tracker
 * Tab: "Form responses 1"
 * Columns: 0-Timestamp, 1-Name, 2-Coach Rating, 3-Workout Completion,
 * 4-Missed Reason, 5-Sleep, 6-Nutrition, 7-Energy, 8-NPS,
 * 9-Video Testimonial, 10-Feedback, 11-Wins, 12-Coach Name, 13-Date
 */
export async function fetchCoachingFeedback(): Promise<CoachingRow[]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_IDS.coachingFeedback,
    range: "'Form responses 1'!A2:N1000",
  });

  const rows = res.data.values || [];
  return rows
    .filter((row) => row[1]) // Must have a name
    .map((row) => ({
      timestamp: parseTimestamp(row[0]),
      client_name: (row[1] || "").trim(),
      coach_rating: parseNum(row[2]),
      workout_completion: (row[3] || "").trim(),
      missed_reason: (row[4] || "").trim(),
      sleep_rating: parseNum(row[5]),
      nutrition_rating: parseNum(row[6]),
      energy_rating: parseNum(row[7]),
      nps_score: parseNum(row[8]),
      // Col 9 is "video testimonial" — skip
      feedback: (row[10] || "").trim(),
      wins: (row[11] || "").trim(),
      coach_name: (row[12] || "").trim(),
      date: parseDate(row[13]) || parseDate(row[0]),
    }));
}

/**
 * Fetch onboarding data from Coaching Clients Tracker
 * Tab: "Onboarding Backlog"
 * Row 3 has actual headers: Onboarder | Onboardee | Email | Closer |
 * Amount Paid | PIF? | Reschedule Email sent? | Reminder Email? |
 * Reach out with Closer | Comments
 * Data starts at row 4
 */
export async function fetchOnboarding(): Promise<OnboardingRow[]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_IDS.onboarding,
    range: "'Onboarding Backlog'!A4:J200",
  });

  const rows = res.data.values || [];
  return rows
    .filter((row) => row[1]) // Must have client name (Onboardee in col 1)
    .map((row) => ({
      onboarder: (row[0] || "").trim(),
      client: (row[1] || "").trim(),
      email: (row[2] || "").trim(),
      closer: (row[3] || "").trim(),
      amount_paid: parseNum(row[4]),
      pif: (row[5] || "").trim().toLowerCase(),
      reschedule_email_sent: parseBool(row[6]),
      reminder_email: parseBool(row[7]),
      reach_out_closer: parseBool(row[8]),
      comments: (row[9] || "").trim(),
      status: row[1] ? "active" : "pending", // If they have a name, they're active in backlog
    }));
}

/**
 * Fetch sales data from Sales Tracker
 * Each month tab (JANUARY, FEBRUARY, MARCH) has:
 * - Summary section rows 2-7 with aggregated stats
 * - Call-level data starting at row 10
 * - Columns: Row#, Date, Name, Call Taken, Call Length, Recorded?, Outcome,
 *   Closer, Objection, Revenue, Cash Collected, Program Length, Method, Setter
 *
 * We read the summary rows AND aggregate call-level data per closer.
 */
export async function fetchSalesData(): Promise<{
  closers: CloserRow[];
  setters: SetterRow[];
}> {
  const sheets = getSheets();

  // Determine current month tab name
  const monthNames = [
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
  ];
  const now = new Date();
  const currentMonthTab = monthNames[now.getMonth()];
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Fetch both summary area and call data from the current month tab
  const [summaryRes, callsRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_IDS.sales,
      range: `'${currentMonthTab}'!A1:V7`,
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_IDS.sales,
      range: `'${currentMonthTab}'!A10:N500`,
    }),
  ]);

  const summaryRows = summaryRes.data.values || [];
  const callRows = callsRes.data.values || [];

  // Parse summary data from rows 3-7
  // Row 3 (index 2): col E="Total Calls Booked:", col F=value, col G="Live Calls:", col H=value
  // Row 4 (index 3): col E="Total Won:", col F=value
  // Row 5 (index 4): col E="Total Lost:", col F=value
  // Row 7 (index 6): col E="Total Calls Taken:", col F=value
  // Row 2 (index 1): col M="Revenue Total", Row 3 col M=value
  // Row 3 (index 2): col O="Total Cash", col P="Cash On Calls", col Q="Subscriptions"

  const totalCallsBooked = parseNum(summaryRows[2]?.[5]);
  const totalWon = parseNum(summaryRows[3]?.[5]);
  const revenueTotal = parseNum(summaryRows[2]?.[12]);
  const totalCash = parseNum(summaryRows[2]?.[14]);

  // Aggregate call-level data by closer
  // Columns (0-indexed from A10): 0=Call#, 1=Date, 2=Name, 3=Call Taken,
  // 4=Call Length, 5=Recorded?, 6=Outcome, 7=Closer, 8=Objection,
  // 9=Revenue, 10=Cash Collected, 11=Program Length, 12=Method, 13=Setter
  const closerMap = new Map<
    string,
    {
      callsBooked: number;
      callsTaken: number;
      closed: number;
      lost: number;
      revenue: number;
      cashCollected: number;
    }
  >();
  const setterMap = new Map<
    string,
    { callsBooked: number }
  >();

  for (const row of callRows) {
    const closerName = (row[7] || "").trim().toUpperCase();
    const outcome = (row[6] || "").trim().toUpperCase();
    const callTaken = (row[3] || "").trim().toUpperCase();
    const revenue = parseNum(row[9]);
    const cashCollected = parseNum(row[10]);
    const setterName = (row[13] || "").trim();

    if (!closerName) continue;

    // Map closer codes to names
    let displayName = closerName;
    if (closerName === "BROZ") displayName = "Jacob Broz";
    else if (closerName === "WILL") displayName = "Will";
    else if (closerName === "AVERY") displayName = "Avery";

    const existing = closerMap.get(displayName) || {
      callsBooked: 0,
      callsTaken: 0,
      closed: 0,
      lost: 0,
      revenue: 0,
      cashCollected: 0,
    };

    existing.callsBooked += 1;
    if (callTaken === "YES") existing.callsTaken += 1;
    if (outcome === "WIN") existing.closed += 1;
    if (outcome === "LOST") existing.lost += 1;
    existing.revenue += revenue;
    existing.cashCollected += cashCollected;

    closerMap.set(displayName, existing);

    // Track setter bookings
    if (setterName) {
      const s = setterMap.get(setterName) || { callsBooked: 0 };
      s.callsBooked += 1;
      setterMap.set(setterName, s);
    }
  }

  // Build closer rows
  const closers: CloserRow[] = Array.from(closerMap.entries()).map(
    ([name, stats]) => ({
      month: monthKey,
      closer_name: name,
      calls_booked: stats.callsBooked,
      calls_taken: stats.callsTaken,
      closed: stats.closed,
      lost: stats.lost,
      revenue: stats.revenue,
      cash_collected: stats.cashCollected,
      aov:
        stats.closed > 0
          ? Math.round(stats.revenue / stats.closed)
          : 0,
      close_rate:
        stats.callsTaken > 0
          ? Math.round((stats.closed / stats.callsTaken) * 100)
          : 0,
    })
  );

  // Build setter rows (limited data — just calls booked from the Setter column)
  const setters: SetterRow[] = Array.from(setterMap.entries())
    .filter(([name]) => name.length > 0)
    .map(([name, stats]) => ({
      month: monthKey,
      setter_name: name,
      messages_handled: 0, // Not tracked in this sheet
      calls_booked: stats.callsBooked,
      conversion_rate: 0, // Needs DM data
      source: "tyson",
    }));

  return { closers, setters };
}

/**
 * Fetch daily ads data from monthly tabs (Feb, Mar, etc.)
 * Columns (0-indexed):
 * 0: Date, 1: Adspend (USD), 2: Impr, 3: Cost Per Impression,
 * 4: Link Clicks, 5: CTR, 6: CPC, 7: Messages, 8: Cost per Message,
 * 9: 15 Min Calls Booked (SKIP), 10: Cost Per 15 Booked (SKIP),
 * 11: 15 Calls Taken (SKIP), 12: 15 SUP-% (SKIP),
 * 13: Cost Per 15 Call Taken (SKIP),
 * 14: 60 Min Calls Booked, 15: Cost Per 60 Booked,
 * 16: 60 Calls Taken, 17: 60 SUP-%,
 * 18: Cost Per 60 Call Taken (SKIP),
 * 19: New Clients, 20: Call Closing Rate, 21: Messages Conversion Rate,
 * 22: Contracted Revenue, 23: Collected Revenue, 24: Cost Per New Client,
 * 25: Contracted-ROI, 26: Collected-ROI
 */
export async function fetchAdsDaily(
  sheetId: string,
  source: "tyson" | "keith"
): Promise<AdsDailyRow[]> {
  const sheets = getSheets();
  const results: AdsDailyRow[] = [];

  // Month name → 0-indexed month number
  const MONTH_MAP: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  // Discover actual tab names from the spreadsheet.
  // This is robust against sheets renaming "(Current) MMM" at different times
  // (e.g. Tyson's sheet may say "(Current) Mar" while Keith's still says "(Current) Jan").
  let actualTabs: string[] = [];
  try {
    const metaRes = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: "sheets.properties.title",
    });
    actualTabs = (metaRes.data.sheets || [])
      .map((s) => s.properties?.title || "")
      .filter(Boolean);
  } catch (e) {
    console.warn(`[sheets] ${source}: Could not fetch tab list, using default names:`, (e as Error).message?.substring(0, 80));
    // Fall back to building tab list dynamically based on current month
    actualTabs = MONTH_NAMES.map((name, idx) =>
      idx === currentMonth ? `(Current) ${name}` : name
    );
  }

  // Build a mapping: month index (0-11) → actual tab name in this specific sheet.
  // Strips "(Current) " prefix when matching against MONTH_NAMES.
  const monthTabMap = new Map<number, string>();
  for (const tabTitle of actualTabs) {
    const clean = tabTitle.replace(/^\(Current\)\s*/i, "").toLowerCase().substring(0, 3);
    const monthIdx = MONTH_MAP[clean];
    if (monthIdx !== undefined) {
      monthTabMap.set(monthIdx, tabTitle);
    }
  }

  // Process tabs in chronological order (Jan → Dec)
  for (let monthIdx = 0; monthIdx < 12; monthIdx++) {
    const tab = monthTabMap.get(monthIdx);
    if (!tab) continue; // This month's tab doesn't exist in this sheet

    try {
      // Determine the year for this tab:
      // If the tab's month is in the future relative to current month, it must be last year.
      const tabYear = monthIdx > currentMonth ? currentYear - 1 : currentYear;

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${tab}'!A3:AA200`, // Row 3 onward (skip header + targets row)
      });

      const rows = res.data.values || [];
      for (const row of rows) {
        // Pass tabYear as fallback so M/D dates (like "1/26") get the correct year
        const dateStr = parseDate(row[0], tabYear);
        if (!dateStr) continue; // Skip non-date rows (blanks, "Totals", etc.)

        results.push({
          source,
          date: dateStr,
          ad_spend: parseNum(row[1]),
          impressions: parseNum(row[2]),
          cpi: parseNum(row[3]),
          link_clicks: parseNum(row[4]),
          ctr: parseNum(row[5]),
          cpc: parseNum(row[6]),
          messages: parseNum(row[7]),
          cost_per_message: parseNum(row[8]),
          // Skip indices 9-13 (15-min call columns)
          calls_60_booked: parseNum(row[14]),
          cost_per_60_booked: parseNum(row[15]),
          calls_60_taken: parseNum(row[16]),
          show_up_60_pct: parseNum(row[17]),
          // Skip index 18 (Cost Per 60 Call Taken)
          new_clients: parseNum(row[19]),
          close_rate: parseNum(row[20]),
          msg_conversion_rate: parseNum(row[21]),
          contracted_revenue: parseNum(row[22]),
          collected_revenue: parseNum(row[23]),
          cost_per_client: parseNum(row[24]),
          contracted_roi: parseNum(row[25]),
          collected_roi: parseNum(row[26]),
        });
      }
    } catch (e) {
      // Some monthly tabs might be empty or inaccessible — that's fine
      console.log(`[sheets] Skipping ${source}/${tab}: ${(e as Error).message?.substring(0, 80)}`);
    }
  }

  return results;
}

/**
 * Discover all sheet tab names in a spreadsheet (for debugging/exploration)
 */
export async function getSheetTabs(
  sheetId: string
): Promise<{ title: string; index: number; rowCount: number }[]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties",
  });

  return (res.data.sheets || []).map((s) => ({
    title: s.properties?.title || "",
    index: s.properties?.index || 0,
    rowCount: s.properties?.gridProperties?.rowCount || 0,
  }));
}

// ---- Coach Tracker Tabs ----

/**
 * Row shape returned from coach tracker tabs.
 * Merges data from both coach-specific tabs and Nicole's onboarding tab.
 */
export interface CoachTrackerRow {
  client_name: string;
  sales_person: string;
  program: string;
  offer: string;
  start_date: string | null;
  end_date: string | null;
  comments: string;
  is_active: boolean;
  coach_name: string;
  // Milestone data from coach tabs (columns J-M)
  // Each is { done: boolean, date: string | null } where date is "MM/DD" format
  trust_pilot_done: boolean;
  trust_pilot_date: string | null;
  video_testimonial_done: boolean;
  video_testimonial_date: string | null;
  retention_done: boolean;
  retention_date: string | null;
  referral_done: boolean;
  referral_date: string | null;
  meetings: string;
  bonus_received: boolean;
  // Nicole-only fields
  onboarding_call_link: string;
  sales_information: string;
  payment_platform: string;
  source_tab: string;
}

/**
 * Parse a milestone cell value into { done, date }.
 * The cell could contain: "yes", "no", "", a date like "Feb 2", "2/15",
 * "02/03/2025", "2.15.26", etc.
 * Returns done=true if truthy/date-like, and date in "MM/DD" format when parseable.
 */
function parseMilestoneValue(val: string | undefined | null): { done: boolean; date: string | null } {
  if (!val) return { done: false, date: null };
  const trimmed = val.trim();
  if (!trimmed) return { done: false, date: null };

  const lower = trimmed.toLowerCase();
  // Explicit no
  if (lower === "no" || lower === "n" || lower === "false" || lower === "0") {
    return { done: false, date: null };
  }
  // Status words that mean NOT completed yet
  if (lower === "requested" || lower === "offered" || lower === "pending" || lower === "scheduled") {
    return { done: false, date: null };
  }
  // Explicit yes with no date
  if (lower === "yes" || lower === "y" || lower === "true" || lower === "1") {
    return { done: true, date: null };
  }

  // Helper: check if a parsed date is in the past (completed) vs future (scheduled)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function dateResult(month: number, day: number, year?: number): { done: boolean; date: string | null } {
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    const dateStr = `${mm}/${dd}`;

    // If we have a full year, compare against today
    if (year !== undefined) {
      // Normalise 2-digit years
      const fullYear = year < 100 ? 2000 + year : year;
      const parsed = new Date(fullYear, month - 1, day);
      if (parsed > today) {
        // Future date = scheduled, not completed
        return { done: false, date: dateStr };
      }
    }
    // Past date or no year = treat as completed
    return { done: true, date: dateStr };
  }

  // Strip trailing question marks (e.g. "03/23/2026??")
  const cleaned = trimmed.replace(/\?+$/, "").trim();

  // "M/D/YYYY" or "M/D/YY" or "M/D"
  const slashMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slashMatch) {
    const m = parseInt(slashMatch[1], 10);
    const d = parseInt(slashMatch[2], 10);
    const y = slashMatch[3] ? parseInt(slashMatch[3], 10) : undefined;
    return dateResult(m, d, y);
  }

  // "M.D.YY" or "M.D.YYYY" or "M.D"
  const dotMatch = cleaned.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (dotMatch) {
    const m = parseInt(dotMatch[1], 10);
    const d = parseInt(dotMatch[2], 10);
    const y = dotMatch[3] ? parseInt(dotMatch[3], 10) : undefined;
    return dateResult(m, d, y);
  }

  // "Mon D" or "Month D" (e.g. "Feb 2", "January 15")
  const MONTH_ABBR: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6,
    jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const monthMatch = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{2,4}))?$/);
  if (monthMatch) {
    const m = MONTH_ABBR[monthMatch[1].toLowerCase()];
    if (m) {
      const d = parseInt(monthMatch[2], 10);
      const y = monthMatch[3] ? parseInt(monthMatch[3], 10) : undefined;
      return dateResult(m, d, y);
    }
  }

  // "D Mon" or "D Month" (e.g. "2 Feb", "15 January")
  const dayMonthMatch = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)(?:,?\s*(\d{2,4}))?$/);
  if (dayMonthMatch) {
    const m = MONTH_ABBR[dayMonthMatch[2].toLowerCase()];
    if (m) {
      const d = parseInt(dayMonthMatch[1], 10);
      const y = dayMonthMatch[3] ? parseInt(dayMonthMatch[3], 10) : undefined;
      return dateResult(m, d, y);
    }
  }

  // YYYY-MM-DD (ISO)
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return dateResult(parseInt(isoMatch[2], 10), parseInt(isoMatch[3], 10), parseInt(isoMatch[1], 10));
  }

  // If we get here and it's non-empty, treat as unknown — NOT done
  // (avoids false positives from random text like notes or partial entries)
  return { done: false, date: null };
}

/**
 * Coach tab definitions — maps tab name to the coach's first name.
 * Columns A-O: Serial | Client Name | Sales | Program | Offer | Start Date |
 * End Date | Comments | Active? | Trust Pilot | Video Testimonial | Retention |
 * Referral | Meetings | Bonus Received?
 */
const COACH_TABS: { tab: string; coach: string }[] = [
  { tab: "Waleed's LT Client Tracker", coach: "Waleed" },
  { tab: "Ignacio's Tracker", coach: "Ignacio" },
  { tab: "Stef's Tracker", coach: "Stef" },
  { tab: "Farrukh's Tracker", coach: "Farrukh" },
  { tab: "Fatima's LT Clients", coach: "Fatima" },
];

/**
 * Normalise coach names so that variations (e.g. "Stephanie" in Nicole's tab)
 * map to the canonical short name used in the coach tabs.
 */
const COACH_NAME_ALIASES: Record<string, string> = {
  stephanie: "Stef",
};

/** Only these coaches are active — Nicole's tab entries for other coaches are ignored. */
const ACTIVE_COACHES = new Set(COACH_TABS.map(({ coach }) => coach));

/**
 * Nicole's onboarding tab — different column layout.
 * Columns A-M: Priority? | Serial | Client Name | Sales | Program | Offer |
 * Start Date (mm/dd/yy) | End Date | Onboarding Call Link | Coach |
 * Sales Information | Comments | Payment platform
 */
const NICOLE_TAB = "Nicole's LT Client Tracker";

/**
 * Fetch all coach tracker data from the Coaching Clients Tracker spreadsheet.
 * Reads 5 coach tabs + Nicole's onboarding tab and normalises into a flat array.
 */
export async function fetchCoachTrackers(): Promise<CoachTrackerRow[]> {
  const sheets = getSheets();
  const sheetId = SHEET_IDS.onboarding; // Same spreadsheet
  const results: CoachTrackerRow[] = [];

  // --- 1. Fetch all 5 coach tabs in parallel ---
  const coachFetches = COACH_TABS.map(async ({ tab, coach }) => {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${tab}'!A1:O500`, // Read from row 1 to auto-detect header row
      });

      const rows = res.data.values || [];

      // Auto-detect header row by searching for "Client Name" in first 5 rows
      let headerIdx = -1;
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const hasClientName = rows[i]?.some(
          (cell: string) => typeof cell === "string" && cell.trim().toLowerCase() === "client name"
        );
        if (hasClientName) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) {
        console.warn(`[sheets] Coach tracker "${tab}": could not find header row, skipping`);
        return;
      }

      // Build column index map from header row
      const headerRow = rows[headerIdx];
      const colMap: Record<string, number> = {};
      for (let c = 0; c < headerRow.length; c++) {
        const h = (headerRow[c] || "").trim().toLowerCase();
        if (h) colMap[h] = c;
      }

      // Helper to look up column by header name (case-insensitive)
      const col = (name: string): number => colMap[name.toLowerCase()] ?? -1;

      const dataRows = rows.slice(headerIdx + 1);
      const clientNameCol = col("client name");
      if (clientNameCol === -1) return;

      for (const row of dataRows) {
        const clientName = (row[clientNameCol] || "").trim();
        if (!clientName) continue; // Skip empty rows

        const activeCol = col("active?");
        const activeRaw = activeCol >= 0 ? (row[activeCol] || "").trim().toLowerCase() : "";
        const isActive =
          activeRaw === "yes" ||
          activeRaw === "y" ||
          activeRaw === "active" ||
          activeRaw === "true" ||
          activeRaw === "1";

        const tpCol = col("trust pilot");
        const vidCol = col("video testimonial");
        const retCol = col("retention");
        const refCol = col("referral");

        const tp = parseMilestoneValue(tpCol >= 0 ? row[tpCol] : undefined);
        const vid = parseMilestoneValue(vidCol >= 0 ? row[vidCol] : undefined);
        const ret = parseMilestoneValue(retCol >= 0 ? row[retCol] : undefined);
        const ref = parseMilestoneValue(refCol >= 0 ? row[refCol] : undefined);

        const salesCol = col("sales");
        const programCol = col("program");
        const offerCol = col("offer");
        const startCol = col("start date");
        const endCol = col("end date");
        const commentsCol = col("comments");
        const meetingsCol = col("meetings");
        const bonusCol = col("bonus received?");

        results.push({
          client_name: clientName,
          sales_person: salesCol >= 0 ? (row[salesCol] || "").trim() : "",
          program: programCol >= 0 ? (row[programCol] || "").trim() : "",
          offer: offerCol >= 0 ? (row[offerCol] || "").trim() : "",
          start_date: startCol >= 0 ? parseDate(row[startCol]) : null,
          end_date: endCol >= 0 ? parseDate(row[endCol]) : null,
          comments: commentsCol >= 0 ? (row[commentsCol] || "").trim() : "",
          is_active: isActive,
          coach_name: coach,
          trust_pilot_done: tp.done,
          trust_pilot_date: tp.date,
          video_testimonial_done: vid.done,
          video_testimonial_date: vid.date,
          retention_done: ret.done,
          retention_date: ret.date,
          referral_done: ref.done,
          referral_date: ref.date,
          meetings: meetingsCol >= 0 ? (row[meetingsCol] || "").trim() : "",
          bonus_received: bonusCol >= 0 ? parseBool(row[bonusCol]) : false,
          // Not present in coach tabs
          onboarding_call_link: "",
          sales_information: "",
          payment_platform: "",
          source_tab: tab,
        });
      }
    } catch (e) {
      console.warn(
        `[sheets] Coach tracker "${tab}" skipped:`,
        (e as Error).message?.substring(0, 80)
      );
    }
  });

  // --- 2. Fetch Nicole's tab ---
  const nicoleFetch = (async () => {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${NICOLE_TAB}'!A1:M500`, // Read from row 1 to auto-detect header row
      });

      const rows = res.data.values || [];

      // Auto-detect header row by searching for "Client Name" in first 5 rows
      let headerIdx = -1;
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const hasClientName = rows[i]?.some(
          (cell: string) => typeof cell === "string" && cell.trim().toLowerCase() === "client name"
        );
        if (hasClientName) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) {
        console.warn(`[sheets] Nicole's tracker: could not find header row, skipping`);
        return;
      }

      // Build column index map from header row
      const headerRow = rows[headerIdx];
      const colMap: Record<string, number> = {};
      for (let c = 0; c < headerRow.length; c++) {
        const h = (headerRow[c] || "").trim().toLowerCase();
        if (h) colMap[h] = c;
      }

      const col = (name: string): number => colMap[name.toLowerCase()] ?? -1;

      const dataRows = rows.slice(headerIdx + 1);
      const clientNameCol = col("client name");
      if (clientNameCol === -1) return;

      const salesCol = col("sales");
      const programCol = col("program");
      const offerCol = col("offer");
      // Try multiple possible header names for start date
      const startCol = col("start date") >= 0 ? col("start date") : col("start date (mm/dd/yy)");
      const endCol = col("end date");
      const commentsCol = col("comments");
      const coachCol = col("coach");
      const onboardingCol = col("onboarding call link");
      const salesInfoCol = col("sales information");
      const paymentCol = col("payment platform");

      for (const row of dataRows) {
        const clientName = (row[clientNameCol] || "").trim();
        if (!clientName) continue;

        // Resolve coach name and skip clients assigned to inactive/unknown coaches
        const rawCoach = coachCol >= 0 ? (row[coachCol] || "").trim() : "";
        const resolvedCoach = COACH_NAME_ALIASES[rawCoach.toLowerCase()] || rawCoach;
        if (!resolvedCoach || !ACTIVE_COACHES.has(resolvedCoach)) continue;

        results.push({
          client_name: clientName,
          sales_person: salesCol >= 0 ? (row[salesCol] || "").trim() : "",
          program: programCol >= 0 ? (row[programCol] || "").trim() : "",
          offer: offerCol >= 0 ? (row[offerCol] || "").trim() : "",
          start_date: startCol >= 0 ? parseDate(row[startCol]) : null,
          end_date: endCol >= 0 ? parseDate(row[endCol]) : null,
          comments: commentsCol >= 0 ? (row[commentsCol] || "").trim() : "",
          is_active: true, // Nicole's tab is for active onboardings
          coach_name: resolvedCoach,
          // Nicole's tab doesn't have milestone columns
          trust_pilot_done: false,
          trust_pilot_date: null,
          video_testimonial_done: false,
          video_testimonial_date: null,
          retention_done: false,
          retention_date: null,
          referral_done: false,
          referral_date: null,
          meetings: "",
          bonus_received: false,
          // Nicole-specific fields
          onboarding_call_link: onboardingCol >= 0 ? (row[onboardingCol] || "").trim() : "",
          sales_information: salesInfoCol >= 0 ? (row[salesInfoCol] || "").trim() : "",
          payment_platform: paymentCol >= 0 ? (row[paymentCol] || "").trim() : "",
          source_tab: NICOLE_TAB,
        });
      }
    } catch (e) {
      console.warn(
        `[sheets] Nicole's tracker skipped:`,
        (e as Error).message?.substring(0, 80)
      );
    }
  })();

  await Promise.all([...coachFetches, nicoleFetch]);
  return results;
}

// Export sheet IDs for reference
export { SHEET_IDS };
