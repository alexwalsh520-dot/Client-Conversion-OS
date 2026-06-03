import { test } from "node:test";
import assert from "node:assert/strict";
import {
  salesRowKey,
  stableSaleKey,
  saleContactAliasKeyForResolution,
  getSaleResolution,
  sortMatchCandidates,
} from "./server";

const ALERT = "ads_tracker_alert_resolution"; // manual resolution (priority 2)
const AUTO = "ads_tracker_auto_sales_attribution"; // auto-written (priority 1)

const row = (o: Record<string, unknown>) =>
  ({ callNumber: "", name: "", date: "", offer: "", ...o } as any);

// ── salesRowKey: stable identity, NOT the mutable bits ─────────────────────
test("salesRowKey keys on call number, date, creator — never setter/outcome", () => {
  assert.equal(
    salesRowKey(row({ callNumber: "Call 52", name: "Caleb Smith", date: "2026-04-30", offer: "Tyson" }), "tyson"),
    "sale:2026-04-30:tyson:call-52"
  );
  // Exactly 4 colon-parts: setter/outcome must never leak into the key (that
  // caused resolved sales to reappear when the sheet was edited).
  assert.equal(
    salesRowKey(row({ callNumber: "Call 52", name: "Caleb Smith", date: "2026-04-30", offer: "Tyson" }), "tyson").split(":").length,
    4
  );
});

test("salesRowKey falls back to the person name when there is no call number", () => {
  assert.equal(
    salesRowKey(row({ callNumber: "", name: "Preston Bowles", date: "2026-05-01", offer: "Tyson" }), "tyson"),
    "sale:2026-05-01:tyson:preston bowles"
  );
});

test("salesRowKey derives the creator from the offer when clientKey is null", () => {
  assert.equal(
    salesRowKey(row({ callNumber: "Call 9", date: "2026-05-01", offer: "Keith Holland program" }), null),
    "sale:2026-05-01:keith:call-9"
  );
});

// ── stableSaleKey: collapse legacy 6-part keys onto the 4-part key ──────────
test("stableSaleKey collapses a legacy …:setter:outcome key to the stable 4-part key", () => {
  assert.equal(stableSaleKey("sale:2026-05-06:tyson:call-37:kelechi:win"), "sale:2026-05-06:tyson:call-37");
  assert.equal(stableSaleKey("sale:2026-05-06:tyson:call-37"), "sale:2026-05-06:tyson:call-37");
  assert.equal(stableSaleKey("salecontact:tyson:preston bowles"), "salecontact:tyson:preston bowles"); // not a sale: key
});

// ── per-person alias (Step 2: resolved sale stays resolved after edits) ─────
test("saleContactAliasKeyForResolution builds a stable salecontact:<creator>:<name> alias", () => {
  assert.equal(
    saleContactAliasKeyForResolution({ saleKey: "sale:2026-05-01:tyson:preston bowles", clientKey: "tyson", contactName: "Preston Bowles" } as any),
    "salecontact:tyson:preston bowles"
  );
  // creator comes from the sale key's segment, name from contactName
  assert.equal(
    saleContactAliasKeyForResolution({ saleKey: "sale:2026-04-30:tyson:call-52", clientKey: "tyson", contactName: "Caleb Smith" } as any),
    "salecontact:tyson:caleb smith"
  );
  assert.equal(saleContactAliasKeyForResolution({ saleKey: "ghl_booking_missing_keyword:tyson:x", contactName: "Bob" } as any), null);
});

// ── getSaleResolution: exact-first, alias-fallback, priority on tie ─────────
test("getSaleResolution rescues a rotated row via the per-person alias", () => {
  // Row's exact key won't be in the map (call number changed), but the person
  // was resolved → alias must still find it instead of it reappearing unresolved.
  const r = row({ callNumber: "Call 999", name: "Preston Bowles", date: "2026-06-01", offer: "Tyson" });
  const resolution = { id: "res1", source: ALERT, action: "organic" } as any;
  const map = new Map<string, any>([["salecontact:tyson:preston bowles", resolution]]);
  assert.equal(getSaleResolution(map, r, "tyson")?.id, "res1");
});

test("getSaleResolution prefers the exact key, and a manual resolution beats a stray auto-write", () => {
  const r = row({ callNumber: "Call 52", name: "Caleb Smith", date: "2026-04-30", offer: "Tyson" });
  const exactKey = "sale:2026-04-30:tyson:call-52";
  const aliasKey = "salecontact:tyson:caleb smith";

  // Same priority → exact wins.
  let map = new Map<string, any>([
    [exactKey, { id: "exact", source: ALERT }],
    [aliasKey, { id: "alias", source: ALERT }],
  ]);
  assert.equal(getSaleResolution(map, r, "tyson")?.id, "exact");

  // Exact is an auto-write, alias is a human's manual answer → manual wins.
  map = new Map<string, any>([
    [exactKey, { id: "autoExact", source: AUTO }],
    [aliasKey, { id: "manualAlias", source: ALERT }],
  ]);
  assert.equal(getSaleResolution(map, r, "tyson")?.id, "manualAlias");

  // Nothing matches → undefined.
  assert.equal(getSaleResolution(new Map(), r, "tyson"), undefined);
});

// ── sortMatchCandidates: deterministic order (T0.1) ────────────────────────
test("sortMatchCandidates orders newest-first deterministically regardless of input order", () => {
  const a = { event_at: "2026-05-01T00:00:00Z", keyword_normalized: "core" } as any;
  const b = { event_at: "2026-05-09T00:00:00Z", keyword_normalized: "glow" } as any;
  const c = { event_at: "2026-05-05T00:00:00Z", keyword_normalized: "burn" } as any;

  const list1 = [a, b, c];
  const list2 = [c, a, b];
  sortMatchCandidates(list1);
  sortMatchCandidates(list2);
  // Both orderings converge to the same newest-first result.
  assert.deepEqual(list1.map((x) => x.event_at), list2.map((x) => x.event_at));
  assert.equal(list1[0].event_at, "2026-05-09T00:00:00Z");
});

test("sortMatchCandidates breaks exact-timestamp ties consistently (no flip between loads)", () => {
  const x = { event_at: "2026-05-05T00:00:00Z", keyword_normalized: "alpha", appointment_id: "1" } as any;
  const y = { event_at: "2026-05-05T00:00:00Z", keyword_normalized: "beta", appointment_id: "2" } as any;
  const l1 = [x, y];
  const l2 = [y, x];
  sortMatchCandidates(l1);
  sortMatchCandidates(l2);
  assert.deepEqual(l1.map((e) => e.keyword_normalized), l2.map((e) => e.keyword_normalized));
});
