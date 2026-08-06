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
//   * ?month=YYYY-MM navigates whole calendar months (matching the tracker's
//     month tabs), clamped between Jan 2026 and next month — a full-month
//     window is what keeps future upcoming calls visible.
//   * Only call-level facts the client already owns leave this route: date,
//     name, setter, closer, status, and cash on closed deals. No call notes,
//     no recording links, no ManyChat links.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
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
const EARLIEST_MONTH = "2026-01";

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

/** "2026-08" + 1 → "2026-09" (handles year rollover). */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
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

  // 2) Resolve the month — whole calendar months, clamped to the tracker's
  //    range. "Next month" is allowed so calls booked past month-end stay
  //    visible as upcoming.
  const currentMonth = etTodayIso().slice(0, 7);
  const latestMonth = shiftMonth(currentMonth, 1);
  const requested = req.nextUrl.searchParams.get("month") || currentMonth;
  const month = /^\d{4}-\d{2}$/.test(requested)
    ? requested < EARLIEST_MONTH
      ? EARLIEST_MONTH
      : requested > latestMonth
        ? latestMonth
        : requested
    : currentMonth;

  // 3) Live read of the tracker, scoped hard to this token's client.
  try {
    const { from, to } = monthBounds(month);
    const allRows = await fetchSheetData(from, to);
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
        month,
        currentMonth,
        earliestMonth: EARLIEST_MONTH,
        latestMonth,
        clientLabel: CREATORS_BY_KEY[clientKey].name,
        generatedAt: new Date().toISOString(),
        metrics: { booked, upcoming, taken, closed, cashCollected, aov },
        rows,
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
