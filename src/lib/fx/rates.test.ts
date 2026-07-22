import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UsdRateMap,
  convertCentsToUsd,
  convertDollarsToUsd,
  creatorCurrency,
  nonUsdCurrenciesForClients,
  shiftIsoDate,
  USD,
} from "./rates";

// Build a map with a few AUD->USD business-day rates (Fri, then next Mon/Tue).
// Weekend days (07-11 Sat, 07-12 Sun) are intentionally absent, like the ECB feed.
function audMap() {
  return new UsdRateMap(
    new Map([
      [
        "AUD",
        [
          { date: "2026-07-10", rate: 0.695 },
          { date: "2026-07-13", rate: 0.694 },
          { date: "2026-07-14", rate: 0.6 },
        ],
      ],
    ])
  );
}

test("USD always converts 1:1 and is never looked up", () => {
  const m = audMap();
  assert.equal(m.rate(USD, "2026-07-14"), 1);
  assert.equal(convertCentsToUsd(12345, "USD", "2026-07-14", m), 12345);
});

test("exact-day rate is used", () => {
  const m = audMap();
  assert.equal(m.rate("AUD", "2026-07-10"), 0.695);
  // 100.00 AUD * 0.695 = 69.50 USD
  assert.equal(convertCentsToUsd(10000, "AUD", "2026-07-10", m), 6950);
});

test("weekend/holiday carries the last published rate forward", () => {
  const m = audMap();
  // Sat 07-11 and Sun 07-12 have no rate -> use Fri 07-10's 0.695
  assert.equal(m.rate("AUD", "2026-07-11"), 0.695);
  assert.equal(m.rate("AUD", "2026-07-12"), 0.695);
});

test("a day before any stored rate falls back to the earliest, not null", () => {
  const m = audMap();
  assert.equal(m.rate("AUD", "2026-01-01"), 0.695);
});

test("an unknown currency returns null and the amount passes through unconverted", () => {
  const m = audMap();
  assert.equal(m.rate("CAD", "2026-07-14"), null);
  assert.equal(convertCentsToUsd(10000, "CAD", "2026-07-14", m), 10000);
});

test("dollars helper converts at the day's rate (raw float, rounded downstream)", () => {
  const m = audMap();
  assert.ok(Math.abs(convertDollarsToUsd(100, "AUD", "2026-07-13", m) - 69.4) < 1e-9);
});

test("ROAS is preserved when spend and cash convert at the same day's rate", () => {
  const m = audMap();
  const spendAud = 20000; // $200.00 AUD (cents)
  const cashAud = 120000; // $1,200.00 AUD (cents)
  const day = "2026-07-14";
  const spendUsd = convertCentsToUsd(spendAud, "AUD", day, m);
  const cashUsd = convertCentsToUsd(cashAud, "AUD", day, m);
  // Ratio unchanged (6x) even though the absolute dollars shrank.
  assert.equal(cashAud / spendAud, 6);
  assert.equal(cashUsd / spendUsd, 6);
});

test("creator currency comes from the config (Jake=AUD, Tyson=USD, unknown=USD)", () => {
  assert.equal(creatorCurrency("jake"), "AUD");
  assert.equal(creatorCurrency("tyson"), "USD");
  assert.equal(creatorCurrency("nobody"), "USD");
  assert.equal(creatorCurrency(null), "USD");
});

test("nonUsdCurrenciesForClients returns only the distinct non-USD currencies", () => {
  assert.deepEqual(nonUsdCurrenciesForClients(["tyson", "jake", "jake"]), ["AUD"]);
  assert.deepEqual(nonUsdCurrenciesForClients(["tyson", "keith"]), []);
});

test("shiftIsoDate walks the calendar in UTC", () => {
  assert.equal(shiftIsoDate("2026-07-01", -14), "2026-06-17");
  assert.equal(shiftIsoDate("2026-07-13", 1), "2026-07-14");
});
