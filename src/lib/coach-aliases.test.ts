import { test } from "node:test";
import assert from "node:assert/strict";
import { displayCoachName } from "./coach-aliases";

// Farrukh goes by Mark in the weekly reports. The alias is display-only:
// the stored coach_name is still "Farrukh", so this must map reliably
// regardless of how the value arrives, and must leave every other coach
// exactly as stored.

test("Farrukh renders as Mark", () => {
  assert.equal(displayCoachName("Farrukh"), "Mark");
});

test("the alias survives casing and stray whitespace from the database", () => {
  assert.equal(displayCoachName("farrukh"), "Mark");
  assert.equal(displayCoachName("FARRUKH"), "Mark");
  assert.equal(displayCoachName("  Farrukh  "), "Mark");
});

test("every other coach passes through untouched", () => {
  for (const name of ["Waleed", "Stef", "Shiraad", "Fatima", "Kevin", "Martin", "Ahmad", "Belkys"]) {
    assert.equal(displayCoachName(name), name);
  }
});

test("missing or blank coach returns null so callers pick their own fallback", () => {
  assert.equal(displayCoachName(null), null);
  assert.equal(displayCoachName(undefined), null);
  assert.equal(displayCoachName(""), null);
  assert.equal(displayCoachName("   "), null);
});
