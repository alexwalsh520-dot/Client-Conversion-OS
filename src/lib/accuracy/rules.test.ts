import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ONE_DOOR_TOLERANCE_NOTE,
  classifyOneDoor,
  classifyAskTwice,
  classifyBooksBalance,
  classifyBudgetPhotos,
  classifyCashVsSheet,
  classifyChangeLog,
  classifyFreshness,
  classifySetterCoverage,
  classifySpendVsMeta,
  classifyStampOrReason,
  classifyThermometers,
  classifyUnknownPurity,
  describeLeak,
  pct,
  usd,
  type BooksMismatch,
} from "./rules";

// Every red and amber path below is forced with CONSTRUCTED numbers. No test
// in this file touches, corrupts, or depends on real data.

function mismatch(over: Partial<BooksMismatch> = {}): BooksMismatch {
  return {
    client: "tyson",
    window: "last7",
    metric: "cash",
    recount: 100,
    saved: 90,
    fromSpendFeed: false,
    fedAfterAnswerSaved: false,
    ...over,
  };
}

// ── 1. Books balance ──────────────────────────────────────────────────────

test("books balance: agreeing numbers are green", () => {
  assert.equal(classifyBooksBalance([], 0).status, "green");
});

test("books balance: RED when a money number disagrees", () => {
  const v = classifyBooksBalance([mismatch({ metric: "cash", recount: 570000, saved: 560000 })], 0);
  assert.equal(v.status, "red");
  assert.match(v.reason, /cash/);
});

test("books balance: RED when a DM count disagrees, even though DMs are not money", () => {
  assert.equal(classifyBooksBalance([mismatch({ metric: "DMs" })], 0).status, "red");
});

test("books balance: AMBER when only spend differs and the spend landed after the answer was saved", () => {
  const v = classifyBooksBalance(
    [
      mismatch({ metric: "spend", fromSpendFeed: true, fedAfterAnswerSaved: true }),
      mismatch({ metric: "impressions", fromSpendFeed: true, fedAfterAnswerSaved: true }),
    ],
    0,
  );
  assert.equal(v.status, "amber");
});

test("books balance: RED when spend differs but nothing landed after the answer was saved", () => {
  const v = classifyBooksBalance(
    [mismatch({ metric: "spend", fromSpendFeed: true, fedAfterAnswerSaved: false })],
    0,
  );
  assert.equal(v.status, "red");
});

test("books balance: RED when spend is late AND a money number also disagrees", () => {
  const v = classifyBooksBalance(
    [
      mismatch({ metric: "spend", fromSpendFeed: true, fedAfterAnswerSaved: true }),
      mismatch({ metric: "cash" }),
    ],
    0,
  );
  assert.equal(v.status, "red");
});

test("books balance: AMBER when a window has no saved answer yet", () => {
  assert.equal(classifyBooksBalance([], 2).status, "amber");
});

// ── 2. Spend vs Meta ──────────────────────────────────────────────────────

test("spend vs Meta: exact match is green", () => {
  const v = classifySpendVsMeta([
    { client: "tyson", window: "yesterday", ourCents: 40541, metaCents: 40541, configured: true },
  ]);
  assert.equal(v.status, "green");
});

test("spend vs Meta: GREEN on the real penny-rounding gap (10 cents on $2,989)", () => {
  const v = classifySpendVsMeta([
    { client: "tyson", window: "trailing 7 days", ourCents: 298926, metaCents: 298936, configured: true },
  ]);
  assert.equal(v.status, "green");
});

test("spend vs Meta: AMBER inside 1 percent but past penny rounding (Meta still settling)", () => {
  const v = classifySpendVsMeta([
    { client: "tyson", window: "yesterday", ourCents: 40541, metaCents: 40700, configured: true },
  ]);
  assert.equal(v.status, "amber");
  assert.ok(pct(40541, 40700) < 1);
});

test("spend vs Meta: the penny allowance never waves through a TINY account", () => {
  // 70 cents is under the dollar allowance, but it is 12 percent of a $5.70 day,
  // so the percentage rule still calls it red. The allowance can only ever
  // forgive a gap that is BOTH under a dollar and under 0.1 percent.
  const v = classifySpendVsMeta([
    { client: "jake", window: "yesterday", ourCents: 500, metaCents: 570, configured: true },
  ]);
  assert.equal(v.status, "red");
});

test("spend vs Meta: RED past 1 percent", () => {
  const v = classifySpendVsMeta([
    { client: "tyson", window: "yesterday", ourCents: 30000, metaCents: 40000, configured: true },
  ]);
  assert.equal(v.status, "red");
  assert.match(v.reason, /Meta key/);
});

test("spend vs Meta: AMBER, never red, when a creator has no Meta key", () => {
  const v = classifySpendVsMeta([
    { client: "jake", window: "yesterday", ourCents: 6847, metaCents: 0, configured: false },
  ]);
  assert.equal(v.status, "amber");
});

test("spend vs Meta: a real gap still wins over a missing key", () => {
  const v = classifySpendVsMeta([
    { client: "jake", window: "yesterday", ourCents: 1, metaCents: 0, configured: false },
    { client: "tyson", window: "yesterday", ourCents: 30000, metaCents: 40000, configured: true },
  ]);
  assert.equal(v.status, "red");
});

// ── 3. Cash vs the sheet ──────────────────────────────────────────────────

test("cash vs sheet: identical totals and row counts are green", () => {
  const v = classifyCashVsSheet({
    factsCents: 6602400,
    trackerCents: 6602400,
    factsRows: 224,
    trackerRows: 224,
  });
  assert.equal(v.status, "green");
});

test("cash vs sheet: RED on a one cent difference", () => {
  const v = classifyCashVsSheet({
    factsCents: 6602401,
    trackerCents: 6602400,
    factsRows: 224,
    trackerRows: 224,
  });
  assert.equal(v.status, "red");
});

test("cash vs sheet: AMBER when a moneyless call was typed in after the last rebuild", () => {
  const v = classifyCashVsSheet({
    factsCents: 6602400,
    trackerCents: 6602400,
    factsRows: 224,
    trackerRows: 225,
    sheetSyncedAfterRebuild: true,
  });
  assert.equal(v.status, "amber");
  assert.match(v.reason, /1 call\(s\) were typed into the sheet/);
});

test("cash vs sheet: RED when the sheet has an extra row but nothing synced since the rebuild", () => {
  const v = classifyCashVsSheet({
    factsCents: 6602400,
    trackerCents: 6602400,
    factsRows: 224,
    trackerRows: 225,
    sheetSyncedAfterRebuild: false,
  });
  assert.equal(v.status, "red");
});

test("cash vs sheet: RED when WE hold more rows than the sheet, lag or not", () => {
  const v = classifyCashVsSheet({
    factsCents: 6602400,
    trackerCents: 6602400,
    factsRows: 225,
    trackerRows: 224,
    sheetSyncedAfterRebuild: true,
  });
  assert.equal(v.status, "red");
  assert.match(v.reason, /row count/);
});

test("cash vs sheet: RED when the money differs, even during a sync lag", () => {
  const v = classifyCashVsSheet({
    factsCents: 6602400,
    trackerCents: 6612400,
    factsRows: 224,
    trackerRows: 225,
    sheetSyncedAfterRebuild: true,
  });
  assert.equal(v.status, "red");
  assert.match(v.reason, /cash differs/);
});

// ── 4. Freshness ──────────────────────────────────────────────────────────

test("freshness: everything inside its window is green", () => {
  const v = classifyFreshness([
    { name: "Meta spend", ageHours: 1, maxHours: 26 },
    { name: "recorded calls", ageHours: 40, maxHours: 72 },
  ]);
  assert.equal(v.status, "green");
});

test("freshness: RED with the age shown when a feed goes stale", () => {
  const v = classifyFreshness([{ name: "Meta spend", ageHours: 30.5, maxHours: 26 }]);
  assert.equal(v.status, "red");
  assert.match(v.reason, /30\.5h/);
});

test("freshness: RED when a feed has never written", () => {
  const v = classifyFreshness([{ name: "DM capture", ageHours: null, maxHours: 72 }]);
  assert.equal(v.status, "red");
  assert.match(v.reason, /never/);
});

// ── 5, 6, 7: the zero-tolerance checks ────────────────────────────────────

test("stamp or reason: zero is green, anything above is red", () => {
  assert.equal(classifyStampOrReason(0).status, "green");
  assert.equal(classifyStampOrReason(1).status, "red");
});

test("unknown purity: zero is green, a single missed sale is red", () => {
  assert.equal(classifyUnknownPurity(0).status, "green");
  assert.equal(classifyUnknownPurity(27).status, "red");
});

test("setter coverage: zero is green, a dropped setter is red", () => {
  assert.equal(classifySetterCoverage(0).status, "green");
  assert.equal(classifySetterCoverage(4).status, "red");
});

// ── 8. Change log ─────────────────────────────────────────────────────────

test("change log: recent capture and no duplicates is green", () => {
  const v = classifyChangeLog({ hoursSinceLastCapture: 1.2, duplicateUids: 0 });
  assert.equal(v.status, "green");
});

test("change log: RED when the capture has been quiet too long", () => {
  const v = classifyChangeLog({ hoursSinceLastCapture: 26, duplicateUids: 0 });
  assert.equal(v.status, "red");
});

test("change log: RED on duplicate change ids (the real July re-pull bug)", () => {
  const v = classifyChangeLog({ hoursSinceLastCapture: 1, duplicateUids: 1000 });
  assert.equal(v.status, "red");
  assert.match(v.reason, /duplicate/);
});

test("change log: RED when the capture has never succeeded", () => {
  assert.equal(classifyChangeLog({ hoursSinceLastCapture: null, duplicateUids: 0 }).status, "red");
});

// ── 9. Budget photos ──────────────────────────────────────────────────────

test("budget photos: every live dial photographed is green", () => {
  assert.equal(classifyBudgetPhotos({ active: 9, photographed: 9 }).status, "green");
});

test("budget photos: RED when a live dial has no photo today", () => {
  const v = classifyBudgetPhotos({ active: 9, photographed: 7 });
  assert.equal(v.status, "red");
  assert.match(v.reason, /2 live dial/);
});

// ── 10. Two thermometers ──────────────────────────────────────────────────

test("two thermometers: inside 1 percent is green (the real 0.14 percent tail)", () => {
  const v = classifyThermometers([
    { client: "tyson", ourCents: 1365258, v1Cents: 1363405, v1AgeHours: 12 },
  ]);
  assert.equal(v.status, "green");
});

test("two thermometers: RED past 1 percent", () => {
  const v = classifyThermometers([
    { client: "tyson", ourCents: 1365258, v1Cents: 1200000, v1AgeHours: 12 },
  ]);
  assert.equal(v.status, "red");
});

test("two thermometers: AMBER, never red, when the old tab has stopped refreshing", () => {
  const v = classifyThermometers([
    { client: "tyson", ourCents: 1365258, v1Cents: 1363405, v1AgeHours: 200 },
  ]);
  assert.equal(v.status, "amber");
  assert.match(v.reason, /stale/);
});

test("two thermometers: AMBER when there is no old photo at all", () => {
  const v = classifyThermometers([
    { client: "jake", ourCents: 255988, v1Cents: null, v1AgeHours: null },
  ]);
  assert.equal(v.status, "amber");
});

// ── 11. Ask twice ─────────────────────────────────────────────────────────

test("ask twice: three identical reads are green", () => {
  const a = '{"spendCents":260063,"collectedCents":570000}';
  assert.equal(classifyAskTwice({ firstAnswer: a, secondAnswer: a, shortcutAnswer: a }).status, "green");
});

test("ask twice: RED when the same question moves between reads", () => {
  const v = classifyAskTwice({
    firstAnswer: '{"spendCents":260063}',
    secondAnswer: '{"spendCents":260064}',
    shortcutAnswer: '{"spendCents":260063}',
  });
  assert.equal(v.status, "red");
  assert.match(v.reason, /two different answers/);
});

test("ask twice: RED when the warehouse shortcut disagrees with its own table", () => {
  const v = classifyAskTwice({
    firstAnswer: '{"spendCents":260063}',
    secondAnswer: '{"spendCents":260063}',
    shortcutAnswer: '{"spendCents":0}',
  });
  assert.equal(v.status, "red");
  assert.match(v.reason, /shortcut/);
});

// ── 12. Leak watch ────────────────────────────────────────────────────────

test("leak watch is informational and never red, even when the leak grows", () => {
  const v = describeLeak({ last7: 40, prior7: 5 });
  assert.equal(v.status, "green");
  assert.match(v.reason, /up 35/);
});

// ── formatting ────────────────────────────────────────────────────────────

test("money is formatted for a human, including negatives", () => {
  assert.equal(usd(6602400), "$66,024.00");
  assert.equal(usd(-1130), "-$11.30");
});

// ── 13. One front door ────────────────────────────────────────────────────
// Every red path is forced here with constructed numbers, exactly as the other
// twelve do, so the check can never quietly pass when it should not.

test("one front door: agreement is green", () => {
  const v = classifyOneDoor({ windowsChecked: 72, comparisons: 576, mismatches: [], refusedWindows: [] });
  assert.equal(v.status, "green");
  assert.match(v.reason, /agree exactly/);
});

test("one front door: a single differing number is red, with no tolerance", () => {
  const v = classifyOneDoor({
    windowsChecked: 72,
    comparisons: 576,
    mismatches: [{ client: "tyson", window: "2026-07-28..2026-07-28 all", metric: "collected", door: 199900, saved: 199901 }],
    refusedWindows: [],
  });
  assert.equal(v.status, "red");
  assert.match(v.reason, /the door says 199900 and the saved answer says 199901/);
});

test("one front door: a window the door refuses but the tab can serve is red", () => {
  const v = classifyOneDoor({
    windowsChecked: 71, comparisons: 568, mismatches: [],
    refusedWindows: ["tyson 2026-07-28..2026-07-28 all"],
  });
  assert.equal(v.status, "red");
  assert.match(v.reason, /refused 1 window/);
});

test("one front door: nothing to check at all is red, never green", () => {
  const v = classifyOneDoor({ windowsChecked: 0, comparisons: 0, mismatches: [], refusedWindows: [] });
  assert.equal(v.status, "red");
  assert.match(v.reason, /asked nothing/);
});

test("one front door: its tolerance note states plainly that there is no tolerance", () => {
  assert.match(ONE_DOOR_TOLERANCE_NOTE, /NO tolerance/);
  assert.match(ONE_DOOR_TOLERANCE_NOTE, /Any difference at all is red/);
});
