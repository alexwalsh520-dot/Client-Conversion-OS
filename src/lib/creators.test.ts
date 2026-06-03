import { test } from "node:test";
import assert from "node:assert/strict";
import { creatorKeyFromText, isCreatorKey, CREATORS } from "./creators";

// These guard the bug class that silently dropped Lucy's data: a creator's
// various name forms MUST all resolve to their one canonical key, and unknown /
// ambiguous text must resolve to null (never a wrong creator).

test("creatorKeyFromText maps every creator's long-form + name forms to its canonical key", () => {
  assert.equal(creatorKeyFromText("lucy_hubbard"), "lucy"); // the Lucy leak
  assert.equal(creatorKeyFromText("Lucy Hubbard"), "lucy");
  assert.equal(creatorKeyFromText("tyson_sonnek"), "tyson");
  assert.equal(creatorKeyFromText("Tyson Sonnek"), "tyson");
  assert.equal(creatorKeyFromText("keith_holland"), "keith");
  assert.equal(creatorKeyFromText("antwan"), "antwan");
  assert.equal(creatorKeyFromText("Antwan Rarcus"), "antwan");
});

test("creatorKeyFromText resolves a sale offer string to the right creator", () => {
  assert.equal(creatorKeyFromText("Tyson Sonnek — Spring Shred"), "tyson");
  assert.equal(creatorKeyFromText("Keith's 90-day program"), "keith");
  assert.equal(creatorKeyFromText("Against All Odds Fitness"), "antwan");
});

test("creatorKeyFromText returns null for unknown or ambiguous text (never guesses)", () => {
  assert.equal(creatorKeyFromText(""), null);
  assert.equal(creatorKeyFromText("Generic 1:1 Coaching"), null);
  assert.equal(creatorKeyFromText(null), null);
  assert.equal(creatorKeyFromText(undefined), null);
  // Two different creators named → ambiguous → null (human decides).
  assert.equal(creatorKeyFromText("tyson and keith combo"), null);
});

test("isCreatorKey accepts exactly the known creators and nothing else", () => {
  for (const c of CREATORS) assert.equal(isCreatorKey(c.key), true);
  assert.equal(isCreatorKey("lucy_hubbard"), false); // long-form is NOT a canonical key
  assert.equal(isCreatorKey("unknown"), false);
  assert.equal(isCreatorKey(null), false);
  assert.equal(isCreatorKey(42), false);
});

test("every creator key is unique and lowercase (assumed across the pipeline)", () => {
  const keys = CREATORS.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate creator key");
  for (const k of keys) assert.equal(k, k.toLowerCase());
});
