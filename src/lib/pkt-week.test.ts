import { test } from "node:test";
import assert from "node:assert/strict";
import { getThisWeekMondayPktMs, pktDateStr } from "./pkt-week";

// The Sunday weekly report and the Coach Rankings meeting boost both key
// off this boundary. If it drifts by a day, meetings and check-ins land
// in the wrong week and the report silently describes the wrong seven
// days. PKT is UTC+5 with no DST, so Monday 00:00 PKT is 19:00 UTC on
// the preceding Sunday.

const MONDAY_2026_08_10_PKT = Date.UTC(2026, 7, 9, 19, 0, 0);

test("Sunday 4 PM PKT (the report firing moment) resolves to THAT SAME week's Monday", () => {
  // Sun 2026-08-16 16:00 PKT === 11:00 UTC, which is when the cron runs.
  const firing = new Date(Date.UTC(2026, 7, 16, 11, 0, 0));
  assert.equal(
    getThisWeekMondayPktMs(firing),
    Date.UTC(2026, 7, 9, 19, 0, 0),
    "Sunday must look back to the Monday 6 days earlier, not the one 13 days earlier"
  );
});

test("Monday just after midnight PKT resolves to itself, not the week before", () => {
  const justAfterMidnight = new Date(MONDAY_2026_08_10_PKT + 30 * 60 * 1000);
  assert.equal(getThisWeekMondayPktMs(justAfterMidnight), MONDAY_2026_08_10_PKT);
});

test("one millisecond before Monday 00:00 PKT still belongs to the previous week", () => {
  const justBefore = new Date(MONDAY_2026_08_10_PKT - 1);
  assert.equal(
    getThisWeekMondayPktMs(justBefore),
    Date.UTC(2026, 7, 2, 19, 0, 0),
    "23:59:59.999 Sunday PKT is the tail of the old week"
  );
});

test("every day of one PKT week maps to the same Monday", () => {
  const mondays = new Set<number>();
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    for (const hour of [0, 6, 12, 18, 23]) {
      const t = new Date(
        MONDAY_2026_08_10_PKT + dayOffset * 86400000 + hour * 3600000
      );
      mondays.add(getThisWeekMondayPktMs(t));
    }
  }
  assert.deepEqual([...mondays], [MONDAY_2026_08_10_PKT]);
});

test("pktDateStr reports the Pakistan calendar date, not the UTC one", () => {
  // 21:00 UTC is already the NEXT day in Pakistan (02:00 PKT).
  assert.equal(pktDateStr(Date.UTC(2026, 7, 16, 21, 0, 0)), "2026-08-17");
  assert.equal(pktDateStr(Date.UTC(2026, 7, 16, 11, 0, 0)), "2026-08-16");
  assert.equal(pktDateStr(MONDAY_2026_08_10_PKT), "2026-08-10");
});
