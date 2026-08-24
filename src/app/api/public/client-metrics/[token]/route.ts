// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC, NO-LOGIN CLIENT CALL-METRICS API — the data boundary for the
// client-facing dashboard at /p/client-metrics/<token>.
//
// A client (e.g. Jake) opens a shared token link to watch their own sales-call
// numbers: calls booked, calls taken, calls closed, and AOV — with the names
// behind each number. The contract:
//
//   * Access is decided SOLELY by the token row in public_share_links
//     (kind = 'client-metrics', not revoked). The client scope comes from the
//     token row's client_key — no client param is honored, so a tampered query
//     string cannot reach another client's calls.
//   * Source of truth is the Google Sheets sales tracker, read LIVE via
//     fetchSheetData — the moment a booked call lands on the tracker it shows
//     here. Rows are attributed to the client via the Offer column
//     (creatorKeyFromText), the same detector the rest of the pipeline uses.
//   * A blank "Call Taken" cell means the call hasn't happened yet — those rows
//     are the UPCOMING bucket. "Yes"/"No" is the decider for taken; a WIN
//     outcome is the decider for closed; AOV = cash collected ÷ closes.
//   * ?from=YYYY-MM-DD&to=YYYY-MM-DD picks the date window. Default is the
//     current calendar month (full month, so future upcoming calls are
//     visible). Clamped to the tracker's range and capped at a year so a
//     hostile query can't fan out over unbounded sheet reads.
//   * Only call-level facts the client already owns leave this route: date,
//     name, setter, closer, status, and cash on closed deals. No call notes,
//     no recording links, no ManyChat links.
//   * upcomingCalls is the LIVE CALENDAR: booked, non-cancelled appointments
//     from ghl_appointments (the GHL webhook mirror) on this client's pinned
//     sales calendars, from now forward. Prospect name + start time only —
//     no closer, no calendar/appointment title. Reschedule calendars are
//     excluded because their client attribution is ambiguous (they default
//     to another client), and a wrong guess would leak someone else's lead.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
import { engineCalendar } from "@/lib/metrics-engine/calendars";
import {
  creatorKeyFromText,
  isCreatorKey,
  CREATORS_BY_KEY,
  type CreatorKey,
} from "@/lib/creators";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

// The tracker's first month tab is JANUARY 2026.
const EARLIEST_DATE = "2026-01-01";
// Widest window one request may span — keeps the tab fan-out bounded.
const MAX_RANGE_DAYS = 366;
// How far past today the window may reach (calls get booked ahead).
const MAX_FUTURE_DAYS = 92;

// Per-token rate limit (per instance): plenty for a dashboard someone leaves
// open, hostile to token-guessing scripts.
const RATE_LIMIT = { windowMs: 10_000, max: 30 };
const rateBuckets = new Map<string, { windowStart: number; count: number }>();

function rateLimited(token: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(token);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT.windowMs) {
    rateBuckets.set(token, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT.max;
}

function etTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Full calendar month around a date — the default window. */
function monthBounds(date: string): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const month = date.slice(0, 7);
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function clampDate(value: string, min: string, max: string): string {
  return value < min ? min : value > max ? max : value;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Client-readable labels for the tracker's outcome vocabulary. Anything not in
// the map falls back to a title-cased copy of the raw cell.
const OUTCOME_LABELS: Record<string, string> = {
  "NS/RS": "No Show / Resched",
  "NS-RS": "No Show / Resched",
  "NO SHOW": "No Show",
  CANCELLED: "Cancelled",
  "NOT A FIT/NO OFFER": "Not a Fit",
  "NOT A FIT": "Not a Fit",
  LOST: "Lost",
  PCFU: "Follow-Up",
};

type Stage = "upcoming" | "taken" | "closed" | "no";

// How far forward the live calendar looks. Calls rarely book further out, and
// the bound keeps the query cheap.
const CALENDAR_LOOKAHEAD_DAYS = 45;

interface UpcomingCall {
  id: string;
  name: string;
  startTime: string; // ISO instant
}

/**
 * The live calendar: booked, non-cancelled appointments on this client's
 * pinned SALES calendars (dm + outbound), from now forward. Degrades to []
 * on any failure — the metrics half of the payload must still render.
 */
async function fetchUpcomingCalls(clientKey: CreatorKey): Promise<UpcomingCall[]> {
  try {
    const sb = getServiceSupabase();
    const nowIso = new Date().toISOString();
    const horizonIso = new Date(
      Date.now() + CALENDAR_LOOKAHEAD_DAYS * 86_400_000,
    ).toISOString();
    const { data, error } = await sb
      .from("ghl_appointments")
      .select("appointment_id, calendar_id, contact_name, start_time, status, event_type")
      .gte("start_time", nowIso)
      .lte("start_time", horizonIso)
      .order("start_time", { ascending: true })
      .limit(500);
    if (error || !data) return [];
    return data
      .filter((r) => {
        const cal = engineCalendar(r.calendar_id);
        if (!cal || cal.client !== clientKey) return false;
        // Sales calendars only; reschedule calendars are client-ambiguous and
        // onboarding calls aren't part of the sales-call story.
        if (cal.side !== "dm" && cal.side !== "outbound") return false;
        return !`${r.status || ""} ${r.event_type || ""}`.toLowerCase().includes("cancel");
      })
      .map((r) => ({
        id: String(r.appointment_id),
        name: (r.contact_name || "").trim() || "Booked Call",
        startTime: new Date(r.start_time).toISOString(),
      }));
  } catch {
    return [];
  }
}

// Defensive allow-list copy — only these fields ever leave the route.
function publicRow(row: SheetRow) {
  const isWin = row.outcome === "WIN";
  const stage: Stage = isWin
    ? "closed"
    : row.callTakenStatus === "pending"
      ? "upcoming"
      : row.callTakenStatus === "yes"
        ? "taken"
        : "no";
  const statusLabel =
    stage === "closed"
      ? "Closed Won"
      : stage === "upcoming"
        ? "Upcoming"
        : stage === "taken"
          ? row.outcome
            ? OUTCOME_LABELS[row.outcome] || titleCase(row.outcome)
            : "Taken"
          : row.outcome
            ? OUTCOME_LABELS[row.outcome] || titleCase(row.outcome)
            : "Not Taken";
  return {
    date: row.date,
    name: row.name.trim(),
    setter: row.setter || "—",
    closer: row.closer ? titleCase(row.closer) : "—",
    stage,
    statusLabel,
    taken: row.callTakenStatus === "yes",
    // Cash only on closed deals — it's the client's own revenue, and it's what
    // makes the AOV number auditable from the list.
    cashCollected: isWin ? row.cashCollected : null,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (rateLimited(token)) {
    return NextResponse.json(
      { error: "Too many requests. Give it a few seconds." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  // 1) The token is the only credential — it must be a live 'client-metrics'
  //    link whose client_key resolves to a known creator.
  let clientKey: CreatorKey;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("kind, revoked, client_key")
      .eq("token", token)
      .maybeSingle();
    if (
      error ||
      !data ||
      data.revoked ||
      data.kind !== "client-metrics" ||
      !isCreatorKey(data.client_key)
    ) {
      return NextResponse.json(
        { error: "This link is not available." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    clientKey = data.client_key;
  } catch {
    return NextResponse.json(
      { error: "This link is not available." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  // 2) Resolve the date window — default the current full calendar month
  //    (keeps future upcoming calls visible), clamped to the tracker's range.
  const today = etTodayIso();
  const latestDate = shiftDate(today, MAX_FUTURE_DAYS);
  const defaults = monthBounds(today);
  const isIsoDate = (v: string | null): v is string =>
    !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const rawFrom = req.nextUrl.searchParams.get("from");
  const rawTo = req.nextUrl.searchParams.get("to");
  let from = clampDate(isIsoDate(rawFrom) ? rawFrom : defaults.from, EARLIEST_DATE, latestDate);
  let to = clampDate(isIsoDate(rawTo) ? rawTo : defaults.to, EARLIEST_DATE, latestDate);
  if (from > to) [from, to] = [to, from];
  if (shiftDate(from, MAX_RANGE_DAYS) < to) to = shiftDate(from, MAX_RANGE_DAYS);

  // 3) Live read of the tracker, scoped hard to this token's client. The GHL
  //    calendar read runs alongside and degrades to [] on its own failures.
  try {
    const [allRows, upcomingCalls] = await Promise.all([
      fetchSheetData(from, to),
      fetchUpcomingCalls(clientKey),
    ]);
    const rows = allRows
      .filter((row) => row.programLength !== "Subscription")
      .filter((row) => creatorKeyFromText(row.offer) === clientKey)
      .map(publicRow);

    const booked = rows.length;
    const upcoming = rows.filter((r) => r.stage === "upcoming").length;
    const taken = rows.filter((r) => r.taken).length;
    const closedRows = rows.filter((r) => r.stage === "closed");
    const closed = closedRows.length;
    const cashCollected = closedRows.reduce(
      (sum, r) => sum + (r.cashCollected || 0),
      0,
    );
    const aov = closed > 0 ? cashCollected / closed : null;

    return NextResponse.json(
      {
        from,
        to,
        earliestDate: EARLIEST_DATE,
        latestDate,
        defaultFrom: defaults.from,
        defaultTo: defaults.to,
        clientLabel: CREATORS_BY_KEY[clientKey].name,
        generatedAt: new Date().toISOString(),
        metrics: { booked, upcoming, taken, closed, cashCollected, aov },
        rows,
        upcomingCalls,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("[public/client-metrics] sheet read failed", err);
    return NextResponse.json(
      { error: "Could not load call metrics right now. Try refreshing." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
