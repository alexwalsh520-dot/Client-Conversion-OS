import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyKeyword,
  resolveSaleKeyword,
  groupBookingsByPerson,
  type BookingRecord,
} from "./attribution";

// ── classifyKeyword ───────────────────────────────────────────────────────

test("no keyword is always none", () => {
  assert.equal(
    classifyKeyword({ keyword: "", organicMarked: true, paidSpendDays: [], eventDay: "2026-07-23" }),
    "none",
  );
});

test("a keyword with paid spend on the event day is paid", () => {
  assert.equal(
    classifyKeyword({
      keyword: "fit",
      organicMarked: false,
      paidSpendDays: ["2026-07-20", "2026-07-22"],
      eventDay: "2026-07-22",
    }),
    "paid",
  );
});

test("paid wins over an organic mark during the run and cool-down", () => {
  // Marked organic, but the ad ran through 07-22; a DM on 07-25 (within 30d) is paid.
  assert.equal(
    classifyKeyword({
      keyword: "fit",
      organicMarked: true,
      paidSpendDays: ["2026-07-20", "2026-07-22"],
      eventDay: "2026-07-25",
    }),
    "paid",
  );
});

test("organic only takes over after the 30 day cool-down", () => {
  // Last spend 07-22, cool-down ends 08-21; an organic-marked event on 09-01 is organic.
  assert.equal(
    classifyKeyword({
      keyword: "fit",
      organicMarked: true,
      paidSpendDays: ["2026-07-22"],
      eventDay: "2026-09-01",
    }),
    "organic",
  );
});

test("organic-marked word that never had paid spend is organic", () => {
  assert.equal(
    classifyKeyword({
      keyword: "locked",
      organicMarked: true,
      paidSpendDays: [],
      eventDay: "2026-07-23",
    }),
    "organic",
  );
});

test("a word with no spend and no organic mark is none", () => {
  assert.equal(
    classifyKeyword({
      keyword: "mystery",
      organicMarked: false,
      paidSpendDays: [],
      eventDay: "2026-07-23",
    }),
    "none",
  );
});

// ── resolveSaleKeyword ────────────────────────────────────────────────────

const paid = new Set(["fit", "gym", "edge"]);

test("human resolution wins over everything, even saying no keyword", () => {
  const r = resolveSaleKeyword({
    humanResolution: { keyword: null },
    pastedSubscriberId: "sub1",
    bookingKeywordBySubscriber: new Map([["sub1", "fit"]]),
    paidKeywords: paid,
  });
  assert.deepEqual(r, { keyword: null, method: "human" });
});

test("pasted subscriber id resolves via the booked call first", () => {
  const r = resolveSaleKeyword({
    pastedSubscriberId: "sub1",
    bookingKeywordBySubscriber: new Map([["sub1", "fit"]]),
    dmKeywordBySubscriber: new Map([["sub1", "gym"]]),
    paidKeywords: paid,
  });
  assert.deepEqual(r, { keyword: "fit", method: "link_booking" });
});

test("falls to the DM keyword when there is no booked call", () => {
  const r = resolveSaleKeyword({
    pastedSubscriberId: "sub1",
    dmKeywordBySubscriber: new Map([["sub1", "gym"]]),
    paidKeywords: paid,
  });
  assert.deepEqual(r, { keyword: "gym", method: "link_dm" });
});

test("uses the stored GHL bridge subscriber when nothing was pasted", () => {
  const r = resolveSaleKeyword({
    pastedSubscriberId: null,
    bridgeSubscriberId: "sub2",
    bookingKeywordBySubscriber: new Map([["sub2", "edge"]]),
    paidKeywords: paid,
  });
  assert.deepEqual(r, { keyword: "edge", method: "link_booking" });
});

test("origin-check keyword is accepted only when it has real paid spend", () => {
  const ok = resolveSaleKeyword({ originCheckKeyword: "edge", paidKeywords: paid });
  assert.deepEqual(ok, { keyword: "edge", method: "origin_check" });
  const rejected = resolveSaleKeyword({ originCheckKeyword: "locked", paidKeywords: paid });
  assert.deepEqual(rejected, { keyword: null, method: "none" });
});

test("nothing proves it -> none (never a name guess)", () => {
  const r = resolveSaleKeyword({ pastedSubscriberId: "ghost", paidKeywords: paid });
  assert.deepEqual(r, { keyword: null, method: "none" });
});

// ── groupBookingsByPerson ─────────────────────────────────────────────────

test("reschedules collapse to one person with a record count", () => {
  const recs: BookingRecord[] = [
    {
      contactId: "c1",
      personName: "Sam Lee",
      keyword: "fit",
      startTime: "2026-07-20T15:00:00Z",
      createdTime: "2026-07-15T00:00:00Z",
      dmEtDay: "2026-07-14",
      bookedEtDay: "2026-07-20",
      isUpcoming: false,
      taken: false,
    },
    {
      contactId: "c1",
      personName: "Sam Lee",
      keyword: "fit",
      startTime: "2026-07-23T15:00:00Z",
      createdTime: "2026-07-21T00:00:00Z",
      dmEtDay: "2026-07-14",
      bookedEtDay: "2026-07-23",
      isUpcoming: false,
      taken: true,
    },
  ];
  const grouped = groupBookingsByPerson(recs);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].records, 2);
  assert.equal(grouped[0].status, "showed"); // any record taken -> showed
  assert.equal(grouped[0].name, "Sam Lee");
});

test("two different people stay separate; ordering is deterministic", () => {
  const recs: BookingRecord[] = [
    {
      contactId: "a",
      personName: "Aaron",
      keyword: "fit",
      startTime: "2026-07-21T15:00:00Z",
      createdTime: null,
      dmEtDay: null,
      bookedEtDay: "2026-07-21",
      isUpcoming: true,
      taken: false,
    },
    {
      contactId: "b",
      personName: "Bea",
      keyword: "fit",
      startTime: "2026-07-22T15:00:00Z",
      createdTime: null,
      dmEtDay: null,
      bookedEtDay: "2026-07-22",
      isUpcoming: false,
      taken: false,
    },
  ];
  const grouped = groupBookingsByPerson(recs);
  assert.equal(grouped.length, 2);
  // Most recent call day first.
  assert.equal(grouped[0].name, "Bea");
  // Bea's call day passed with no taken record and no GHL no-show status, so she
  // is "no outcome yet" (never counted as a show), not a no-show.
  assert.equal(grouped[0].status, "no_outcome");
  assert.equal(grouped[1].status, "upcoming");
});
