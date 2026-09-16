import { test } from "node:test";
import assert from "node:assert/strict";
import { computeChurnMonth, churnSlackText, previousMonthStart } from "./stripe-churn";

const T = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const subs = [
  { id: "a", status: "active", created: T("2026-06-10T00:00:00Z"), endedAt: null },
  { id: "b", status: "canceled", created: T("2026-06-20T00:00:00Z"), endedAt: T("2026-08-15T00:00:00Z") },
  { id: "c", status: "unpaid", created: T("2026-07-01T00:00:00Z"), endedAt: T("2026-08-03T00:00:00Z") },
  { id: "d", status: "active", created: T("2026-08-12T00:00:00Z"), endedAt: null },
  { id: "e", status: "canceled", created: T("2026-08-05T00:00:00Z"), endedAt: T("2026-08-20T00:00:00Z") },
  { id: "f", status: "canceled", created: T("2026-05-01T00:00:00Z"), endedAt: T("2026-07-09T00:00:00Z") },
];
const now = new Date("2026-09-16T00:00:00Z");

test("computeChurnMonth counts alive at start, canceled + unpaid in month, new, and end", () => {
  const c = computeChurnMonth(subs, "2026-08-01", now);
  assert.equal(c.startActive, 3); // a, b, c (f already gone in July)
  assert.equal(c.canceled, 2); // b and e (e joined and left inside August)
  assert.equal(c.unpaid, 1); // c
  assert.equal(c.churned, 3);
  assert.equal(c.newSubs, 2); // d, e
  assert.equal(c.churnRatePct, 100); // 3 / 3
  assert.equal(c.endActive, 2); // a, d
  assert.equal(c.partial, false);
  assert.equal(c.monthLabel, "August 2026");
});

test("computeChurnMonth marks the running month partial and uses now as its end", () => {
  const c = computeChurnMonth(subs, "2026-09-01", now);
  assert.equal(c.partial, true);
  assert.equal(c.startActive, 2);
  assert.equal(c.churned, 0);
  assert.equal(c.churnRatePct, 0);
});

test("previousMonthStart rolls over the year", () => {
  assert.equal(previousMonthStart(new Date("2026-01-01T02:30:00Z")), "2025-12-01");
  assert.equal(previousMonthStart(new Date("2026-10-01T02:30:00Z")), "2026-09-01");
});

test("churnSlackText carries the rate and the plain sentences", () => {
  const text = churnSlackText(computeChurnMonth(subs, "2026-08-01", now));
  assert.ok(text.includes("Churn rate: *100.0%*"));
  assert.ok(text.includes("We started August 2026 with 3 paying subscribers."));
  assert.ok(text.includes("2 canceled on purpose."));
});
