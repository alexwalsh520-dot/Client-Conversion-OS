// The sheet's creator column decides WHO a call belongs to (Alex, 8/13).
// These pin the offer -> creator mapping: active creators match by first
// name, retired creators and junk resolve to null.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clientFromSheetOffer } from "./attribution";

test("active creators map by first name", () => {
  assert.equal(clientFromSheetOffer("Tyson Sonnek"), "tyson");
  assert.equal(clientFromSheetOffer("Jake Divijak"), "jake");
  assert.equal(clientFromSheetOffer("  tyson sonnek  "), "tyson");
  assert.equal(clientFromSheetOffer("TYSON"), "tyson");
});

test("retired creators resolve to null, never a dead account", () => {
  assert.equal(clientFromSheetOffer("Antwan Rarcus"), null);
  assert.equal(clientFromSheetOffer("Keith Holland"), null);
});

test("blank and junk resolve to null", () => {
  assert.equal(clientFromSheetOffer(""), null);
  assert.equal(clientFromSheetOffer("   "), null);
  assert.equal(clientFromSheetOffer(null), null);
  assert.equal(clientFromSheetOffer(undefined), null);
  assert.equal(clientFromSheetOffer("Somebody Unknown"), null);
});
