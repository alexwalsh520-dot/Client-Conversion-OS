import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHits } from "./reschedules";

// parseHits is the guard between a free-form model reply and a number that goes
// out to the whole sales team. It has to be strict: a hallucinated prospect
// would put a "rescheduled" tag on a call that actually ran.

const DAY = ["Dan Barczewski", "Jommy Hauger", "Genesis De Jesus"];

test("a well-formed reply is accepted", () => {
  const hits = parseHits(
    '{"rescheduled":[{"prospect":"Dan Barczewski","evidence":"Dan B wants to reschedule again"}]}',
    DAY,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].prospect, "Dan Barczewski");
  assert.match(hits[0].evidence, /reschedule again/);
});

test("prose wrapped around the JSON is tolerated", () => {
  const hits = parseHits('Here you go:\n{"rescheduled":[{"prospect":"Jommy Hauger","evidence":"wants to move his call"}]}\nHope that helps.', DAY);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].prospect, "Jommy Hauger");
});

test("a prospect who was not on the day's list is dropped", () => {
  // The single most damaging failure: a name invented or lifted from an
  // unrelated message becomes a phantom reschedule.
  const hits = parseHits('{"rescheduled":[{"prospect":"Kyle McCullough","evidence":"got him rescheduled"}]}', DAY);
  assert.deepEqual(hits, []);
});

test("matching is case-insensitive but still list-bound", () => {
  const hits = parseHits('{"rescheduled":[{"prospect":"dan barczewski","evidence":"x"}]}', DAY);
  assert.equal(hits.length, 1);
});

test("an empty result is an empty list, not a failure", () => {
  assert.deepEqual(parseHits('{"rescheduled":[]}', DAY), []);
});

test("malformed or non-JSON replies degrade to no reschedules", () => {
  assert.deepEqual(parseHits("I could not determine any reschedules.", DAY), []);
  assert.deepEqual(parseHits('{"rescheduled": [', DAY), []);
  assert.deepEqual(parseHits('{"rescheduled":"Dan Barczewski"}', DAY), []);
  assert.deepEqual(parseHits("", DAY), []);
});

test("a runaway evidence string is truncated", () => {
  const long = "x".repeat(500);
  const hits = parseHits(`{"rescheduled":[{"prospect":"Dan Barczewski","evidence":"${long}"}]}`, DAY);
  assert.equal(hits[0].evidence.length, 120);
});
