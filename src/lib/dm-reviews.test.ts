import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDmCombineMessage, buildSetterMessage, etDayRangeUtc, renderDmBriefHeader, renderSetterHeader, setterRunKeys, type SetterConversation } from "./dm-reviews";
import { renderShadowReport, type Proposal, COLUMNS } from "./tracker-autofill";

test("etDayRangeUtc covers the ET day, DST-aware", () => {
  const summer = etDayRangeUtc("2026-09-18");
  assert.equal(summer.from, "2026-09-18T04:00:00.000Z"); // EDT
  assert.equal(summer.to, "2026-09-19T03:59:59.999Z");
  const winter = etDayRangeUtc("2026-01-15");
  assert.equal(winter.from, "2026-01-15T05:00:00.000Z"); // EST
});

const conv = (over: Partial<SetterConversation>): SetterConversation => ({
  igId: "1", manychatId: "9", leadName: "DaJon R", handle: "dajonr", setter: "Amara",
  messages: [
    { sent_at: "2026-09-18T13:31:00Z", direction: "inbound", message_type: "text", setter_name: null, body: "EARN" },
    { sent_at: "2026-09-18T13:32:00Z", direction: "outbound", message_type: "text", setter_name: null, body: "Mind if I ask a couple of questions?" },
    { sent_at: "2026-09-18T13:40:00Z", direction: "inbound", message_type: "text", setter_name: null, body: "sure" },
  ],
  inbound: 2, outbound: 1, todayMessages: 3, callLinkSent: false, inTracker: false, medianResponseMin: 1, ...over,
});

test("buildSetterMessage names the setter, includes the thread and the json contract", () => {
  const msg = buildSetterMessage("Amara", "2026-09-18", [conv({})], { n: 1, of: 1 }, { setterScript: null, guardrails: null });
  assert.ok(msg.includes("Review Amara's Instagram DM conversations for 2026-09-18"));
  assert.ok(msg.includes("CONVERSATION 1: DaJon R (@dajonr)"));
  assert.ok(msg.includes("Prospect: EARN"));
  assert.ok(msg.includes('"conversations": ['));
  assert.ok(!msg.includes("part 1 of 1"));
});

test("renderSetterHeader counts links, bookings and median reply", () => {
  const h = renderSetterHeader("Amara", "2026-09-18", [conv({ callLinkSent: true, inTracker: true, medianResponseMin: 4 }), conv({ medianResponseMin: 10 })], { active: 300, engaged: 40 }, { n: 1, of: 1 });
  assert.ok(h.startsWith("*SETTER BRIEF* | 2026-09-18 | Amara"));
  assert.ok(h.includes("2 engaged conversations reviewed | 1 call links sent | 1 booked | median reply 10 min"));
  assert.ok(h.includes("40 engaged of 300 active"));
});

test("setterRunKeys matches the dispatch loop's mm_review_runs keys", () => {
  const keys = setterRunKeys("2026-09-17", { Debbie: [conv({ setter: "Debbie" })], Amara: [conv({})] });
  assert.deepEqual(keys, ["setter:2026-09-17:Amara", "setter:2026-09-17:Debbie"]);
});

test("renderDmBriefHeader is two lines with team totals and per-setter counts", () => {
  const h = renderDmBriefHeader("2026-09-17", {
    Amara: [conv({ callLinkSent: true, inTracker: true, medianResponseMin: 4 })],
    Debbie: [conv({ setter: "Debbie", medianResponseMin: 10 })],
  }, { active: 300, engaged: 2 });
  assert.equal(h.split("\n").length, 2);
  assert.ok(h.startsWith("*DM BRIEF* | 2026-09-17"));
  assert.ok(h.includes("2 engaged of 300 active conversations | 1 call links sent | 1 booked | median reply 10 min"));
  assert.ok(h.includes("Amara 1, Debbie 1"));
});

test("buildDmCombineMessage asks for one document and carries the stored notes", () => {
  const msg = buildDmCombineMessage("2026-09-17", "*DM BRIEF* | 2026-09-17\n2 engaged", ["- Amara: 1 engaged"], [
    { key: "2026-09-17:Amara", md: "*SETTER BRIEF* | 2026-09-17 | Amara\nnotes" },
  ]);
  assert.ok(msg.includes("Write THE DM BRIEF for the sales manager (Matt) — one document for the whole day."));
  assert.ok(msg.includes("No per-setter sub-briefs, no parts"));
  assert.ok(msg.includes("--- NOTES 2026-09-17:Amara ---"));
  assert.ok(msg.includes("- Amara: 1 engaged"));
  const empty = buildDmCombineMessage("2026-09-17", "*DM BRIEF* | 2026-09-17", [], []);
  assert.ok(empty.includes("none stored"));
});

test("renderShadowReport tallies agreement per column and lists asks", () => {
  const cells = Object.fromEntries(COLUMNS.map((c) => [c, { value: null, source: "—", certainty: "none" as const }])) as Proposal["cells"];
  const current = Object.fromEntries(COLUMNS.map((c) => [c, null])) as Proposal["current"];
  const compare = Object.fromEntries(COLUMNS.map((c) => [c, "both_blank" as const])) as Proposal["compare"];
  const p: Proposal = {
    sheet_row_key: "2026-09-18:call-129:irbin-benitez", row_date: "2026-09-18", prospect: "Irbin Benitez", closer: "WILL",
    identity: { method: "name+date", appointment_id: "x", email: "i@x.com" },
    cells: { ...cells, cash_collected: { value: 2999, source: "Stripe LLP amount", certainty: "hard" }, outcome: { value: "WIN", source: "Stripe", certainty: "hard" } },
    current: { ...current, cash_collected: 3000, outcome: "WIN" },
    compare: { ...compare, cash_collected: "agree", outcome: "agree", objection: "ask" },
    asks: ["Irbin Benitez: program length not on the Stripe charge — how many months?"],
  };
  const text = renderShadowReport("2026-09-12", "2026-09-18", [p]);
  assert.ok(text.includes("*Cash Collected* 1/0/0/0/0 — 100% agree"));
  assert.ok(text.includes("*Objection* 0/0/0/0/1"));
  assert.ok(text.includes("keyed to a GHL booking: 1"));
  assert.ok(text.includes("*WOULD HAVE ASKED* (1)"));
});

import { mrkdwnToMarkdown } from "./report-delivery";
test("mrkdwnToMarkdown turns Slack labels into headings and keeps links readable", () => {
  const md = mrkdwnToMarkdown("*DAILY SALES BRIEF* | 2026-09-18\n5 taken of 9 booked\n\n*PER-CLOSER*\n*Will* (1 call)\nStrong: rapport\n• bullet\n:rotating_light: *REVIEW* peptides\nFull: <https://x.y/z|Deal>");
  assert.ok(md.includes("## DAILY SALES BRIEF — 2026-09-18"));
  assert.ok(md.includes("## PER-CLOSER"));
  assert.ok(md.includes("**Will** (1 call)"));
  assert.ok(md.includes("- bullet"));
  assert.ok(md.includes("!! **REVIEW** peptides"));
  assert.ok(md.includes("Deal (https://x.y/z)"));
});

import { sanitizeForPdf } from "./report-delivery";
test("sanitizeForPdf strips emoji and maps dashes/quotes to WinAnsi", () => {
  assert.equal(sanitizeForPdf("PA\u{1F4CD}: \u201Cnothings holding me back\u201D \u2014 Joel\u2019s call"), "PA: \"nothings holding me back\" - Joel's call");
  assert.equal(sanitizeForPdf("Dieananana \u{1F5E1}\uFE0F (@mochi)"), "Dieananana (@mochi)");
});
