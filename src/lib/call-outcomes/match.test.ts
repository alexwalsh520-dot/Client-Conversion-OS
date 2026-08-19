import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSheetRow } from "./data";
import type { SheetRow } from "@/lib/google-sheets";

// Joining a calendar booking to its tracker row is name-based, because the
// sheet's Date column drifts. These tests pin the guardrails that stop a
// name-only join from crediting the wrong call.

function row(partial: Partial<SheetRow>): SheetRow {
  return {
    callNumber: "", date: "2026-08-19", name: "", callTaken: false,
    callTakenStatus: "pending", callLength: "", recorded: false, outcome: "",
    closer: "", objection: "", programLength: "", revenue: 0, cashCollected: 0,
    method: "", setter: "", callNotes: "", recordingLink: "", offer: "",
    callType: "Strategy Session", manychatLink: "", manychatSubscriberId: null,
    ...partial,
  };
}

test("a mis-dated row still matches when the call type agrees", () => {
  // Real case: GHL had Max Turk's Strategy Session at 6:00 AM Aug 19; the
  // setter logged it as Aug 20.
  const rows = [row({ name: "Max Turk ", date: "2026-08-20", callType: "Strategy Session" })];
  const hit = matchSheetRow("Max Turk", "Strategy Session", "2026-08-19", rows);
  assert.equal(hit?.name, "Max Turk ");
});

test("an off-day row of a DIFFERENT call type is rejected", () => {
  // Regression: Jordan Abernathy's Aug 17 "Miscellaneous Chat" WIN of $1,000
  // was being credited to his Aug 19 onboarding call.
  const rows = [row({
    name: "Jordan Abernathy", date: "2026-08-17",
    callType: "Miscellaneous Chat", outcome: "WIN", cashCollected: 1000,
  })];
  assert.equal(matchSheetRow("Jordan Abernathy", "Client Onboarding", "2026-08-19", rows), null);
});

test("a same-day row is taken even when the type differs", () => {
  // Génesis De Jesus's Aug 18 sales call was logged as "Miscellaneous Chat".
  // Same day is unambiguous, so the type check does not apply.
  const rows = [row({
    name: "Génesis De Jesus ", date: "2026-08-18",
    callType: "Miscellaneous Chat", outcome: "WIN", cashCollected: 800,
  })];
  const hit = matchSheetRow("Genesis De Jesus", "Strategy Session", "2026-08-18", rows);
  assert.equal(hit?.cashCollected, 800);
});

test("the closest day wins when a prospect has several rows", () => {
  const rows = [
    row({ name: "Hira Jahangir", date: "2026-08-15", cashCollected: 100 }),
    row({ name: "Hira Jahangir", date: "2026-08-19", cashCollected: 200 }),
  ];
  const hit = matchSheetRow("Hira Jahangir", "Strategy Session", "2026-08-19", rows);
  assert.equal(hit?.cashCollected, 200);
});

test("rows beyond the scan window are ignored", () => {
  const rows = [row({ name: "Max Turk", date: "2026-07-01" })];
  assert.equal(matchSheetRow("Max Turk", "Strategy Session", "2026-08-19", rows), null);
});

test("either onboarding kind matches the tracker's single onboarding type", () => {
  const rows = [row({ name: "Ryan Grimm", date: "2026-08-18", callType: "Onboarding Call " })];
  const hit = matchSheetRow("Ryan Grimm", "Rep Onboarding", "2026-08-19", rows);
  assert.equal(hit?.name, "Ryan Grimm");
});

test("a blank tracker call type matches anything", () => {
  // Older rows predate the "Type of call" column.
  const rows = [row({ name: "Max Turk", date: "2026-08-17", callType: "" })];
  assert.equal(matchSheetRow("Max Turk", "Rep Onboarding", "2026-08-19", rows)?.name, "Max Turk");
});

test("no candidate at all returns null", () => {
  assert.equal(matchSheetRow("Nobody Here", "Strategy Session", "2026-08-19", []), null);
});

test("a rep-run onboarding never claims a strategy-session row from another day", () => {
  // Rep onboarding is still onboarding: it must not absorb a sales row.
  const rows = [row({
    name: "Curtis Sharrard", date: "2026-08-17",
    callType: "Strategy Session", outcome: "WIN", cashCollected: 1500,
  })];
  assert.equal(matchSheetRow("Curtis Sharrard", "Rep Onboarding", "2026-08-19", rows), null);
});
