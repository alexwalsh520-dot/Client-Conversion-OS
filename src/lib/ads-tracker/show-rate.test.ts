import { test } from "node:test";
import assert from "node:assert/strict";
import { showRatePercent } from "./server";

// Show rate = shown / due, where due = booked minus still-upcoming. This is the
// number Alex flagged as must-be-accurate, so pin the exact behavior.

test("upcoming calls are excluded from the denominator", () => {
  // 8 booked, 3 upcoming -> 5 due. 3 showed -> 60%.
  assert.equal(showRatePercent(8, 3, 3), 60);
});

test("nothing due yet returns null (cell shows a dash, not 0%)", () => {
  assert.equal(showRatePercent(3, 0, 3), null); // all 3 booked are upcoming
  assert.equal(showRatePercent(0, 0, 0), null); // no calls at all
});

test("a full show rate is 100%", () => {
  assert.equal(showRatePercent(5, 3, 2), 100); // 3 due, 3 showed
});

test("show rate can never exceed 100% even if taken outruns due", () => {
  // Edge: taken (from the tracker) outnumbers due bookings (source blend). Capped.
  assert.equal(showRatePercent(4, 5, 0), 100);
});

test("a plain half", () => {
  assert.equal(showRatePercent(4, 2, 0), 50); // 4 due, 2 showed
});

test("upcoming equal to booked is treated as nothing due", () => {
  assert.equal(showRatePercent(5, 0, 5), null);
});
