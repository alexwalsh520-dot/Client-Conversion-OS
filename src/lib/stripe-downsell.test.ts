import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOnboardingRedirect, parseClientReference } from "./stripe-downsell";

test("keyword--subscriber (the ManyChat flow form)", () => {
  const r = parseClientReference("FIT--1234567890");
  assert.equal(r.clientKey, "tyson");
  assert.equal(r.keywordRaw, "FIT");
  assert.equal(r.keyword, "fit");
  assert.equal(r.subscriberId, "1234567890");
});

test("client--keyword--subscriber", () => {
  const r = parseClientReference("jake--badge--987654321");
  assert.equal(r.clientKey, "jake");
  assert.equal(r.keyword, "badge");
  assert.equal(r.subscriberId, "987654321");
});

test("keyword only (hand-pasted per-keyword link)", () => {
  const r = parseClientReference("loaded");
  assert.equal(r.keyword, "loaded");
  assert.equal(r.subscriberId, null);
});

test("empty keyword keeps the subscriber id (organic walk-in)", () => {
  const r = parseClientReference("--1234567890");
  assert.equal(r.keyword, null);
  assert.equal(r.subscriberId, "1234567890");
});

test("missing or junk reference is null everywhere", () => {
  assert.deepEqual(parseClientReference(null), { clientKey: "tyson", keywordRaw: null, keyword: null, subscriberId: null });
  const junk = parseClientReference("<script>--<b>x</b>");
  assert.equal(junk.clientKey, "tyson");
  assert.equal(junk.keyword, null);
  assert.equal(junk.subscriberId, null);
});

test("redirect carries utm_content / utm_term + prefill", () => {
  const url = new URL(buildOnboardingRedirect({ keywordRaw: "FIT", subscriberId: "1234567890", email: "a@b.co", name: "Sam Jones", phone: "+15551234567" }));
  assert.equal(url.searchParams.get("utm_content"), "FIT");
  assert.equal(url.searchParams.get("utm_term"), "1234567890");
  assert.equal(url.searchParams.get("email"), "a@b.co");
  assert.equal(url.searchParams.get("first_name"), "Sam");
  assert.equal(url.searchParams.get("last_name"), "Jones");
  assert.ok(url.pathname.endsWith("/onboarding-call-with-the-forge"));
});
