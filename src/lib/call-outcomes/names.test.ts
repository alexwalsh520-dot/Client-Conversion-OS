import { test } from "node:test";
import assert from "node:assert/strict";
import { nameMatchScore, normalizeName } from "./names";

// Every pair below is a REAL GHL-vs-sales-tracker spelling of the same person,
// taken from August. The join is name-only (the sheet's Date drifts), so these
// have to keep matching or the day's outcomes silently go missing.

test("identical names score 0", () => {
  assert.equal(nameMatchScore("Hira Jahangir", "Hira Jahangir"), 0);
});

test("case, padding and accents are normalized away", () => {
  assert.equal(normalizeName("  Génesis De Jesus "), "genesis de jesus");
  assert.equal(nameMatchScore("Genesis De Jesus", "Génesis De Jesus "), 0);
  assert.equal(nameMatchScore("Jonathan Kelvinton", "Jonathan kelvinton"), 0);
});

test("a stray trailing letter still matches", () => {
  // GHL "Jazy Mantillal" vs sheet "Jazy Mantilla "
  assert.notEqual(nameMatchScore("Jazy Mantillal", "Jazy Mantilla "), null);
});

test("nickname plus a transposed surname still matches", () => {
  // GHL "Greg Kuebler" vs sheet "Gregory Keubler" — the case that forced the
  // surname-distance + given-name-prefix rule.
  assert.notEqual(nameMatchScore("Greg Kuebler", "Gregory Keubler "), null);
});

test("different people who share a first name do NOT match", () => {
  assert.equal(nameMatchScore("Jacob Sykes", "Jacob Broz"), null);
  assert.equal(nameMatchScore("Ryan Grimm", "Ryan Kang"), null);
  assert.equal(nameMatchScore("Chris Jolivette", "Chris Sharrard"), null);
  assert.equal(nameMatchScore("Tyler Ripley", "Tyler Sonnek"), null);
});

test("similar surnames are not enough on their own", () => {
  assert.equal(nameMatchScore("Max Turk", "Max Turner"), null);
  assert.equal(nameMatchScore("Danny Savage", "Dan Barczewski"), null);
});

test("a single-token name never matches loosely", () => {
  // "Dan" in the tracker must not swallow every Dan on the calendar.
  assert.equal(nameMatchScore("Dan Barczewski", "Dan"), null);
});

test("empty input never matches", () => {
  assert.equal(nameMatchScore("", "Hira Jahangir"), null);
  assert.equal(nameMatchScore("Hira Jahangir", null), null);
});
