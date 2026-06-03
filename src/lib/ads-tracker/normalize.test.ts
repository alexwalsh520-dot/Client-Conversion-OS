import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKeyword, keywordFromAdName, normalizePersonName } from "./normalize";

// The keyword join only works if a keyword is normalized the SAME way on the
// write side (DM/booking ingest) and the read side (Meta ad). If these drift, a
// real event looks unattributed. These tests pin the normalization contract.

test("normalizeKeyword is case- and whitespace-insensitive", () => {
  assert.equal(normalizeKeyword("FART"), "fart");
  assert.equal(normalizeKeyword("  Glow "), "glow");
  assert.equal(normalizeKeyword("Core"), normalizeKeyword("CORE"));
});

test("normalizeKeyword is idempotent (running it twice changes nothing)", () => {
  for (const k of ["FART", " Glow ", "balance", "NuRtUrE"]) {
    assert.equal(normalizeKeyword(normalizeKeyword(k)), normalizeKeyword(k));
  }
});

test("normalizeKeyword handles empty / non-string safely", () => {
  assert.equal(normalizeKeyword(""), null);
  assert.equal(normalizeKeyword("   "), null);
  assert.equal(normalizeKeyword(null), null);
  assert.equal(normalizeKeyword(undefined), null);
});

test("keywordFromAdName extracts the keyword from an ad name and matches normalizeKeyword", () => {
  // Meta side derives the keyword from the last token of the ad name; it must
  // line up with the keyword captured on the DM/booking.
  assert.equal(keywordFromAdName("PUSH"), "push");
  assert.equal(keywordFromAdName("Spring Shred | GLOW"), "glow");
  assert.equal(keywordFromAdName("Ad 4 - FART"), "fart");
  assert.equal(keywordFromAdName("PUSH"), normalizeKeyword("push"));
  assert.equal(keywordFromAdName(""), null);
  assert.equal(keywordFromAdName(null), null);
});

test("normalizePersonName lowercases, trims, and collapses internal whitespace", () => {
  assert.equal(normalizePersonName("Preston Bowles"), "preston bowles");
  assert.equal(normalizePersonName("  Caleb   Smith "), "caleb smith");
  assert.equal(normalizePersonName("CALEB SMITH"), normalizePersonName("caleb smith"));
  assert.equal(normalizePersonName(""), null);
  assert.equal(normalizePersonName(null), null);
});
