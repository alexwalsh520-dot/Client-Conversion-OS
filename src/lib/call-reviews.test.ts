import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeSalesCall, parseReviewReply } from "./call-reviews";
import {
  closerCodeFromName, closerDisplayName, fathomKeys, flattenDmThread, gradeTrend, outcomeFromTracker,
  pickTrackerRow, trackerDayStats, type TrackerRow,
} from "./call-review-context";
import { fitSlack, renderCallPost } from "./call-review-format";

const longTranscript = "Will: Hey man, how are you doing today?\nProspect: Good, good. ".repeat(60);

test("looksLikeSalesCall: a closer-recorded Strategy Session with an external prospect is a sales call", () => {
  assert.equal(looksLikeSalesCall({
    title: "Strategy Session - Irbin Benitez <> Will (TS)", duration_sec: 44 * 60, transcript: longTranscript,
    attendees: [{ email: "ibeniteztejada@gmail.com" }, { email: "will@thefitnessprotocol.com" }],
    closer_key: "WILL",
  }), true);
});

test("looksLikeSalesCall: closer-recorded Onboarding Call (the $50-app upsell) counts; non-closer onboarding does not", () => {
  const base = { duration_sec: 30 * 60, transcript: longTranscript, attendees: [{ email: "someone@gmail.com" }] };
  assert.equal(looksLikeSalesCall({ ...base, title: "Onboarding Call - Cameron <> Chris", closer_key: "CHRIS" }), true);
  assert.equal(looksLikeSalesCall({ ...base, title: "Onboarding Call - Cameron <> Nicole", closer_key: null }), false);
});

test("looksLikeSalesCall: Matthew's non-sales calls are out even with an external attendee", () => {
  // The 2026-09-15 false positive: a setter interview graded as a sales call.
  assert.equal(looksLikeSalesCall({
    title: "Daniel Toms", duration_sec: 32 * 60, transcript: longTranscript,
    attendees: [{ email: "daniel@gmail.com" }, { email: "matthew@clientconversion.io" }], closer_key: null,
  }), false);
  // But a booked sales call recorded from the shared key still counts.
  assert.equal(looksLikeSalesCall({
    title: "Strategy Session - Jane Doe <> Will (TS)", duration_sec: 32 * 60, transcript: longTranscript,
    attendees: [{ email: "jane@gmail.com" }, { email: "matthew@clientconversion.io" }], closer_key: null,
  }), true);
});

test("looksLikeSalesCall: Fathom's demo call, internal calls, short calls and client calls are out", () => {
  const t = longTranscript;
  assert.equal(looksLikeSalesCall({ title: "Fathom Demo", duration_sec: 600, transcript: t, attendees: [{ email: "susannah.durant@fathom.video" }], closer_key: "WILL" }), false);
  assert.equal(looksLikeSalesCall({ title: "Closer Huddle", duration_sec: 3600, transcript: t, attendees: [], closer_key: "WILL" }), false);
  assert.equal(looksLikeSalesCall({ title: "Will <> Matt", duration_sec: 3600, transcript: t, attendees: [{ email: "will@thefitnessprotocol.com" }, { email: "matthew@clientconversion.io" }], closer_key: "WILL" }), false);
  assert.equal(looksLikeSalesCall({ title: "Strategy Session - X <> Will (TS)", duration_sec: 5 * 60, transcript: t, attendees: [{ email: "x@gmail.com" }], closer_key: "WILL" }), false);
  assert.equal(looksLikeSalesCall({ title: "Tyson check-in", duration_sec: 3600, transcript: t, attendees: [{ email: "tysonnek29@gmail.com" }, { email: "will@thefitnessprotocol.com" }], closer_key: "WILL" }), false);
});

test("parseReviewReply splits the markdown from the trailing json footer", () => {
  const reply = "1. Call Summary\nGood call.\n\n2. STOP Doing\n- x\n```json\n{\"grade\": 71, \"sub_scores\": {\"close\": 60}}\n```";
  const { review_md, fields } = parseReviewReply(reply);
  assert.equal(fields.grade, 71);
  assert.deepEqual(fields.sub_scores, { close: 60 });
  assert.ok(review_md.startsWith("1. Call Summary"));
  assert.ok(!review_md.includes("```json"));
});

test("parseReviewReply keeps the review when the json is broken", () => {
  const { review_md, fields } = parseReviewReply("review text\n```json\n{not json\n```");
  assert.equal(review_md, "review text");
  assert.deepEqual(fields, {});
});

test("closer names: tracker codes, Fathom account names and emails all resolve", () => {
  assert.equal(closerCodeFromName("Will Rincan"), "WILL");
  assert.equal(closerCodeFromName("Jacob Broz"), "BROZ");
  assert.equal(closerCodeFromName("Andrew Wobbe"), "WOBBE");
  assert.equal(closerCodeFromName("chris@thefitnessprotocol.com"), "CHRIS");
  assert.equal(closerCodeFromName("Matthew Conder"), null);
  assert.equal(closerDisplayName("WOBBE"), "Wobbe");
  assert.equal(closerDisplayName("newguy"), "Newguy");
});

test("fathomKeys: one entry per closer key plus the shared TEAM key, onboarding key ignored", () => {
  const keys = fathomKeys({
    FATHOM_API_KEY: "team", FATHOM_API_KEY_WILL: "w", FATHOM_API_KEY_BROZ: "b", FATHOM_API_KEY_ONBOARDING: "n", FATHOM_API_KEY_EMPTY: "",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(keys.map((k) => k.label), ["BROZ", "WILL", "TEAM"]);
  assert.equal(keys.find((k) => k.label === "TEAM")?.closerCode, null);
  assert.equal(keys.find((k) => k.label === "WILL")?.closerCode, "WILL");
});

const row = (p: Partial<TrackerRow>): TrackerRow => ({
  date: "2026-09-18", prospect_name: null, prospect_name_normalized: null, call_taken_status: "yes", outcome: null,
  closer: "WILL", setter: "Debbie", objection: null, program_length: null, payment_method: null,
  contracted_revenue_cents: 0, collected_revenue_cents: 0, call_notes: null, recording_link: null,
  manychat_subscriber_id: null, offer: null, ...p,
});

test("pickTrackerRow: exact name wins, same-day + same-closer break ties, first-name-only never binds", () => {
  const rows = [
    row({ prospect_name_normalized: "irbin benitez", date: "2026-09-17", closer: "BROZ" }),
    row({ prospect_name_normalized: "irbin benitez", date: "2026-09-18", closer: "WILL", outcome: "WIN" }),
    row({ prospect_name_normalized: "irbin garcia", date: "2026-09-18", closer: "WILL" }),
  ];
  assert.equal(pickTrackerRow(rows, "Irbin Benitez", "2026-09-18", "WILL")?.outcome, "WIN");
  assert.equal(pickTrackerRow(rows, "Irbin", "2026-09-18", "WILL"), null);
  assert.equal(pickTrackerRow(rows, "Benitez, Irbin", "2026-09-18", null)?.outcome, "WIN"); // first+last present
  assert.equal(pickTrackerRow(rows, "Nobody Here", "2026-09-18", "WILL"), null);
});

test("outcomeFromTracker maps the sheet vocabulary onto the review vocabulary", () => {
  assert.equal(outcomeFromTracker("WIN"), "won");
  assert.equal(outcomeFromTracker("PCFU"), "follow-up");
  assert.equal(outcomeFromTracker("NS/RS"), "no-show");
  assert.equal(outcomeFromTracker("NOT A FIT/NO OFFER"), "lost");
  assert.equal(outcomeFromTracker(""), null);
});

test("trackerDayStats: show = taken / (taken + no-shows), close = closed / taken, per closer", () => {
  const s = trackerDayStats([
    row({ outcome: "WIN", collected_revenue_cents: 210000 }),
    row({ outcome: "LOST" }),
    row({ outcome: "NS/RS", call_taken_status: "no", closer: "WOBBE" }),
    row({ call_taken_status: "pending", closer: "WOBBE" }),
    row({ outcome: "CANCELLED", call_taken_status: "no", closer: "WOBBE" }),
  ]);
  assert.equal(s.booked, 5);
  assert.equal(s.taken, 2);
  assert.equal(s.noShows, 1);
  assert.equal(s.closed, 1);
  assert.equal(s.cashCents, 210000);
  assert.equal(s.closeRate, 50);
  assert.equal(s.showRate, 67);
  assert.equal(s.pending, 1);
  assert.equal(s.cancelled, 1);
  assert.equal(s.byCloser.WILL.closeRate, 50);
  assert.equal(s.byCloser.WOBBE.taken, 0);
  assert.equal(s.byCloser.WOBBE.pending, 1);
  assert.equal(s.byCloser.WOBBE.showRate, 0);
});

test("gradeTrend needs 4 grades and compares halves", () => {
  assert.equal(gradeTrend([60, 62]), "insufficient");
  assert.equal(gradeTrend([50, 55, 70, 75]), "improving");
  assert.equal(gradeTrend([75, 70, 55, 50]), "declining");
  assert.equal(gradeTrend([60, 62, 61, 63]), "stable");
});

test("flattenDmThread labels prospect vs setter and keeps the tail", () => {
  const text = flattenDmThread([
    { sent_at: "2026-07-10T13:31:00Z", direction: "inbound", message_type: "text", setter_name: null, body: "EARN" },
    { sent_at: "2026-07-10T13:32:00Z", direction: "outbound", message_type: "text", setter_name: "Amara", body: "Mind if I ask a couple of questions?" },
    { sent_at: "2026-07-10T13:53:00Z", direction: "outbound", message_type: "audio", setter_name: null, body: null },
  ]);
  assert.ok(text.includes("Prospect: EARN"));
  assert.ok(text.includes("Setter (Amara): Mind if I ask"));
  assert.ok(text.includes("Setter: [audio]"));
});

test("renderCallPost stays phone-sized and links to the deal", () => {
  const post = renderCallPost({
    fathomId: "184557725", closer: "Will", prospect: "Irbin Benitez", callType: "Strategy Session", outcome: "won",
    cashCents: 300000, grade: 78, trend: "improving", avg14: 71, history: 6,
    fields: {
      keep: "K".repeat(400), stop: "S".repeat(400), start: "T".repeat(400), drill: "D".repeat(400),
      sub_scores: { qualification: 70, discovery: 80, pitch: 75, objections: 60, close: 85 },
      objections_raised: [{ category: "price", verbatim_quote: "Q".repeat(300), handling_quality: "partial" }],
      review_flag: { flag: true, reason: "new objection category" },
    },
    dmAvailable: false, trackerMatched: true,
  });
  assert.ok(post.length < 2000, `post is ${post.length} chars`);
  assert.ok(post.includes("*Will* | Irbin Benitez | Strategy Session"));
  assert.ok(post.includes("*Cash* $3,000"));
  assert.ok(post.includes("Q70 D80 P75 O60 C85"));
  assert.ok(post.includes("REVIEW"));
  assert.ok(post.includes("no DM transcript"));
  assert.ok(post.includes("/micromanager?deal=184557725"));
});

test("fitSlack trims on a line boundary and appends the link", () => {
  const long = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
  const out = fitSlack(long, 1000, "Full: https://x");
  assert.ok(out.length < 1100);
  assert.ok(out.endsWith("Full: https://x"));
  assert.ok(out.includes("(Trimmed for Slack.)"));
  assert.equal(fitSlack("short", 1000), "short");
});
