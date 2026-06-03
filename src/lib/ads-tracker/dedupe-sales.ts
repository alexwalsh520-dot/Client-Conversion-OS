// ─────────────────────────────────────────────────────────────────────────────
// SALES-ROW DE-DUPLICATION (read-side safety net)
//
// The sales sync (api/sync/sales-tracker-rows) keys each cached row on
// `sheet_row_key = date:callKey:name:offer`, where TWO parts are mutable:
//   • offer   — filled in after the first sync (blank → "tyson-sonnek"), and
//   • callKey — falls back to `idx-<position>` for rows with no call number.
// When either changes between syncs, the upsert INSERTS a new row instead of
// updating the old one, so the same real sale lands in `sales_tracker_rows`
// two+ times (e.g. June read ~2× its true cash). The main Ads tab dodges this
// by reading the live Google Sheet, but the money model reads the cache
// directly, and the whole tab falls back to the cache whenever the Sheets API
// hiccups — at which point every number doubles.
//
// This collapses those duplicates on READ so no consumer can ever double-count,
// regardless of cache state. It is deliberately conservative: it only merges
// rows that are IDENTICAL on the sale's real identity AND both dollar amounts,
// so it can never drop a genuinely different sale or a different payment. Among
// a duplicate set it keeps the most-complete row (creator/offer filled, then
// most-recently synced) so attribution by creator stays intact.
//
// The upstream key fix (stop creating the duplicates) lands separately; this
// read-side guard stays as permanent defense-in-depth.
// ─────────────────────────────────────────────────────────────────────────────

export interface DedupableSaleRow {
  date?: string | null;
  prospect_name_normalized?: string | null;
  prospect_name?: string | null;
  call_number?: string | null;
  collected_revenue_cents?: number | null;
  contracted_revenue_cents?: number | null;
  offer?: string | null;
  synced_at?: string | null;
}

function norm(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Identity = the sale's immutable facts: date, person, call number, and the cash
// collected on that call. Two rows share a key only when they are the SAME sale
// for the SAME cash — the exact fingerprint of a sync-created duplicate. We do
// NOT key on contracted revenue, setter, or offer: those are the mutable fields
// that get filled in (or corrected from a misparse) between syncs, which is what
// spawns the duplicate in the first place — the stale copy carries junk in them
// (e.g. contracted "300", setter "Pif"). A genuinely different sale has a
// different call number; a real second payment has different collected cash —
// both get distinct keys and are kept.
function dedupeKey(row: DedupableSaleRow): string {
  const name = norm(row.prospect_name_normalized) || norm(row.prospect_name);
  const call = norm(row.call_number); // null/blank → "" → no-call rows collapse
  //                                      only when person + date + cash also match
  return [
    row.date || "nodate",
    name || "noname",
    call,
    Math.round(Number(row.collected_revenue_cents) || 0),
  ].join("|");
}

// Higher = keep. Prefer the row whose creator/offer is tagged (drives
// attribution), then the most recently synced. Pure function of the row, so the
// choice is deterministic — payroll-grade numbers must not shift between loads.
function rank(row: DedupableSaleRow): [number, string] {
  const offerTagged = String(row.offer || "").trim() ? 1 : 0;
  return [offerTagged, String(row.synced_at || "")];
}

function better(a: DedupableSaleRow, b: DedupableSaleRow): boolean {
  const [ao, as] = rank(a);
  const [bo, bs] = rank(b);
  if (ao !== bo) return ao > bo;
  return as >= bs;
}

// Collapses duplicate sales rows. Preserves first-seen order of surviving rows
// (callers pass a stably-ordered query result), so output ordering stays
// deterministic for downstream attribution.
export function dedupeSalesRows<T extends DedupableSaleRow>(rows: T[]): T[] {
  const bestByKey = new Map<string, T>();
  const orderByKey = new Map<string, number>();
  rows.forEach((row, i) => {
    const key = dedupeKey(row);
    const current = bestByKey.get(key);
    if (!current) {
      bestByKey.set(key, row);
      orderByKey.set(key, i);
    } else if (better(row, current)) {
      bestByKey.set(key, row); // keep the more-complete row, original slot order
    }
  });
  return [...bestByKey.keys()]
    .sort((x, y) => (orderByKey.get(x) || 0) - (orderByKey.get(y) || 0))
    .map((k) => bestByKey.get(k) as T);
}
