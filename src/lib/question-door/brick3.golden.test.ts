// ─────────────────────────────────────────────────────────────────────────
// BRICK 3'S GOLDEN FILE: against the REAL database, not a fake.
//
// The fake-database tests next door pin BEHAVIOUR, which is what they are for.
// They cannot pin anything about the real world: a fake that returns what the
// code expects proves only that the code agrees with itself.
//
// This file runs the two new questions against live data and the live signed
// registry. It deliberately asserts INVARIANTS rather than specific numbers,
// because the numbers move every day and a golden file that has to be edited
// every morning gets edited without being read. The verdict NUMBERS are pinned
// separately, and permanently, by the hand-verified 2026-07-31 fixtures in
// verdict-engine.test.ts, which are immune to data drift by construction.
//
// It SKIPS, loudly, when credentials are absent, so it can never pass by not
// running.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { askQuestion } from "./service";
import { loadRuleset, loadWatchRules } from "./rulesets";
import { ZAKK_VERDICTS } from "./verdict-engine";
import { isRefusal, type DoorAnswer, type Db } from "./types";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(URL && KEY);
const skip = LIVE ? false : "no database credentials in the environment, so the live checks did NOT run";

function liveDb(): Db {
  return createClient(URL!, KEY!, { auth: { persistSession: false } }) as unknown as Db;
}

function askLive(params: Record<string, unknown>, key = "kill_scale_read") {
  return askQuestion({ question_key: key, params }, { db: liveDb(), caller: "test" });
}

/** Every string in a value, with its path, skipping verbatim proper nouns. */
function strings(value: unknown, skipVerbatim = true): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (v: unknown, p: string) => {
    if (typeof v === "string") out.push([p, v]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (skipVerbatim && k.endsWith("_verbatim")) continue;
        walk(x, `${p}.${k}`);
      }
    }
  };
  walk(value, "");
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// THE REGISTRY IS REALLY THE SOURCE OF THE THRESHOLDS.
// ─────────────────────────────────────────────────────────────────────────

test("GOLDEN: ruleset zakk_v1 assembles from the LIVE signed registry", { skip }, async () => {
  const { ruleset, definitions } = await loadRuleset(liveDb(), "zakk_v1");
  assert.equal(ruleset.key, "zakk_v1");
  assert.equal(ruleset.definition.name, "ruleset_zakk");

  // The numbers the engine applies are the ones the owner signed, read live.
  assert.equal(ruleset.evidenceFloorUsdCents, 10_000);
  assert.equal(ruleset.killRequiresExpectedBookings, 3);
  assert.equal(ruleset.protectMinRoi, 3);
  assert.equal(ruleset.kpiLineMinRoi, 2);
  assert.equal(ruleset.minDaysBeforeVerdict, 7);
  assert.equal(ruleset.minSignalAgeHours, 72);
  assert.deepEqual([...ruleset.ladder.bottomLadderUsdCents], [5_000, 10_000, 20_000]);

  // Every component it names is itself signed and was loaded.
  const loaded = new Set(definitions.map((d) => d.name));
  for (const c of ruleset.components) {
    assert.ok(loaded.has(c), `ruleset_zakk names ${c} as a component, but it is not signed in the registry`);
  }
});

test("GOLDEN: the watch-mode speaking rules come from the live signed decision_cadence", { skip }, async () => {
  const rules = await loadWatchRules(liveDb());
  assert.deepEqual(rules.forbiddenVerbs, ["reduce", "pause", "kill", "scale", "increase"]);
  assert.deepEqual(rules.allowedClosers, ["monitor", "queued for weekly decide"]);
  assert.equal(rules.decideWindowDays, 14);
});

test("GOLDEN: an unknown ruleset is refused against the real registry too", { skip }, async () => {
  const r = await askLive({ client: "tyson", mode: "decide", ruleset: "jeremy_v1" });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /zakk_v1/);
});

// ─────────────────────────────────────────────────────────────────────────
// (b) LIVE STRUCTURAL.
// ─────────────────────────────────────────────────────────────────────────

test("GOLDEN LIVE: decide mode for tyson is shape-complete, and every verdict cites a definition", { skip }, async () => {
  const r = await askLive({ client: "tyson", mode: "decide" });
  assert.ok(!isRefusal(r), `decide mode refused: ${isRefusal(r) ? r.reason : ""}`);
  const answer = r as DoorAnswer;
  const b = answer.answers as Record<string, unknown>;

  for (const key of [
    "account", "window", "run_rate_window", "units", "economics", "ads", "ad_sets",
    "budget_map", "closes_named", "counting_note", "under_ruleset", "ruleset_definition",
    "ad_verdicts", "ad_set_verdicts", "undecidable_inputs",
  ]) {
    assert.ok(b[key] !== undefined, `decide mode is missing ${key}`);
  }
  assert.equal(b.under_ruleset, "zakk_v1");

  const ads = b.ads as Array<Record<string, unknown>>;
  const verdicts = b.ad_verdicts as Array<Record<string, unknown>>;
  assert.ok(ads.length > 0, "tyson has live ads, so this must not be empty");
  assert.equal(verdicts.length, ads.length, "every ad in the pack must get a verdict, and no verdict may be orphaned");

  const adIds = new Set(ads.map((a) => a.ad_id));
  for (const v of verdicts) {
    assert.ok(adIds.has(v.ad_id), `a verdict was returned for ${v.ad_id}, which is not in the pack`);
    assert.equal(v.under_ruleset, "zakk_v1");
    assert.ok((ZAKK_VERDICTS as readonly string[]).includes(String(v.verdict)));
    // EVERY VERDICT CITES A DEFINITION, by name and by number.
    assert.ok(String(v.basis).length > 40, `verdict for ${v.keyword} has no real basis`);
    const applied = v.definitions_applied as string[];
    assert.ok(applied.length > 0, `verdict for ${v.keyword} names no definition`);
    assert.ok(
      applied.some((d) => String(v.basis).includes(d)),
      `verdict for ${v.keyword} cites ${applied.join(", ")} but its basis names none of them`,
    );
    assert.match(String(v.basis), /\$[\d,]/, `verdict for ${v.keyword} states no numbers`);
  }

  // Per-creator economics really were derived, not defaulted.
  const econ = (b.economics as Array<Record<string, unknown>>)[0];
  assert.equal(econ.client, "tyson");
  assert.equal(econ.standard_ticket_usd_cents, 240_000);
  assert.equal(econ.cac_target_usd_cents, 48_000);
  assert.ok(Number(econ.close_rate) > 0 && Number(econ.close_rate) <= 1);
  assert.equal(
    econ.cost_per_call_target_usd_cents,
    Math.round(Number(econ.cac_target_usd_cents) * Number(econ.close_rate)),
    "the target cost per call must be exactly CAC target x close rate",
  );
});

test("GOLDEN LIVE: the receipt carries coverage, and the four buckets sum exactly", { skip }, async () => {
  const answer = (await askLive({ client: "tyson", mode: "decide" })) as DoorAnswer;
  const c = answer.receipt.coverage;
  assert.ok(c, "kill_scale_read is a money answer, so it MUST carry coverage");
  const k = c.buckets;
  assert.equal(
    k.ad.wins + k.organic.wins + k.misc_chat.wins + k.awaiting_review.wins,
    c.window_wins_total,
    "the buckets must sum to the total",
  );
  assert.equal(
    k.ad.cash_usd_cents + k.organic.cash_usd_cents + k.misc_chat.cash_usd_cents + k.awaiting_review.cash_usd_cents,
    c.window_cash_usd_cents_total,
  );
  assert.equal(answer.receipt.certainty, "directional");
  assert.equal(answer.receipt.contract_version, 2);
  // A trailing window always ends inside the sales lag, so the understatement
  // caveat must be on every one of these answers, automatically.
  assert.match(answer.receipt.caveats.join(" "), /sales_lag/);
});

test("GOLDEN LIVE: the budget map reconciles, and anything that does not is REPORTED", { skip }, async () => {
  const answer = (await askLive({ client: "tyson", mode: "decide" })) as DoorAnswer;
  const map = (answer.answers as Record<string, unknown>).budget_map as {
    entities: Array<{ entity_id: string; daily_usd_cents: number | null; yesterday_spend_usd_cents: number; pace_pct_of_budget: number | null }>;
    mismatches: Array<{ entity_id: string }>;
    total_daily_usd_cents: number;
  };
  assert.ok(map.entities.length > 0, "tyson has live dials, so this must not be empty");
  assert.equal(
    map.total_daily_usd_cents,
    map.entities.reduce((s, e) => s + (e.daily_usd_cents || 0), 0),
    "the daily total must be the sum of the dials it lists",
  );

  // THE INVARIANT: every live dial either paced inside Meta's roughly 25% daily
  // flex, or it is surfaced as a mismatch. Nothing may be silently unexplained.
  // Asserted this way rather than as "everything reconciles" because a real
  // shortfall is a FINDING, not a test failure, and this brick's whole job is
  // to surface those rather than smooth them over.
  const flagged = new Set(map.mismatches.map((m) => m.entity_id));
  for (const e of map.entities) {
    if (e.pace_pct_of_budget === null) continue;
    const inFlex = e.pace_pct_of_budget >= 75 && e.pace_pct_of_budget <= 125;
    assert.ok(
      inFlex || flagged.has(e.entity_id) || e.yesterday_spend_usd_cents === 0,
      `${e.entity_id} paced at ${e.pace_pct_of_budget}% of its dial, outside Meta's flex, and was not reported as a mismatch`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────
// (a0) and (c), against REAL output.
// ─────────────────────────────────────────────────────────────────────────

test("GOLDEN LIVE: facts mode over real data leaks no verdict and no verdict vocabulary", { skip }, async () => {
  const r = await askLive({ client: "tyson", mode: "facts" });
  assert.ok(!isRefusal(r));
  const body = (r as DoorAnswer).answers;
  const json = JSON.stringify(body);
  assert.ok(!/"verdict"/.test(json));
  assert.ok(!/"under_ruleset"/.test(json));
  for (const [path, s] of strings(body)) {
    for (const v of ZAKK_VERDICTS) {
      assert.ok(!s.includes(v), `facts mode used the verdict word "${v}" at ${path}`);
    }
  }
  // Still complete enough for an advisor to judge from.
  const ads = (body as Record<string, unknown>).ads as Array<Record<string, unknown>>;
  assert.ok(ads.length > 0);
  assert.ok("history" in ads[0] && "fatigue" in ads[0] && "copy_pointer" in ads[0]);
});

test("GOLDEN LIVE: watch mode over real data uses not one forbidden verb", { skip }, async () => {
  const rules = await loadWatchRules(liveDb());
  const r = await askLive({ client: "all", mode: "watch" });
  assert.ok(!isRefusal(r));
  const body = (r as DoorAnswer).answers as Record<string, unknown>;

  for (const [path, s] of strings(body)) {
    for (const verb of rules.forbiddenVerbs) {
      assert.ok(
        !s.toLowerCase().includes(verb),
        `watch mode used the forbidden verb "${verb}" at ${path}: ${s.slice(0, 140)}`,
      );
    }
  }
  for (const f of body.flags as Array<Record<string, unknown>>) {
    assert.ok(rules.allowedClosers.includes(String(f.closer)));
  }
  assert.ok(!JSON.stringify(body).includes('"verdict"'));
});

// ─────────────────────────────────────────────────────────────────────────
// health_check, live.
// ─────────────────────────────────────────────────────────────────────────

test("GOLDEN LIVE: health_check answers per creator, and never calls an unchecked creator a go", { skip }, async () => {
  const r = await askLive({ client: "all" }, "health_check");
  assert.ok(!isRefusal(r), `health_check refused: ${isRefusal(r) ? r.reason : ""}`);
  const answer = r as DoorAnswer;
  const body = answer.answers as Record<string, unknown>;
  const creators = body.creators as Array<Record<string, unknown>>;
  assert.ok(creators.length > 0);

  const seen = new Set<string>();
  for (const c of creators) {
    // PER-CREATOR ISOLATION: each carries its own source, outcome and dials.
    assert.ok(["live_meta", "stored_fallback"].includes(String(c.source)));
    assert.ok(["go", "no_go", "unchecked"].includes(String(c.overall)));
    if (c.source === "stored_fallback") {
      assert.notEqual(c.overall, "go", "a creator we could not read is never a go");
    }
    // Each creator's dials belong to that creator alone. The first version of
    // this handed both creators the same eight dials, so this is pinned.
    const ids = (c.budget_dials as Array<{ entity_id: string }>).map((d) => d.entity_id);
    for (const id of ids) {
      assert.ok(!seen.has(id), `dial ${id} was attributed to more than one creator`);
      seen.add(id);
    }
  }
  // Delivery health touches no sale row.
  assert.equal(answer.receipt.coverage, null);
  assert.match(String(body.standing_note), /exception to touch_floor_72h/);

  // Nothing token-shaped ever leaves.
  assert.ok(!JSON.stringify(answer).includes("EAA"), "something token-shaped leaked into a live answer");
});

test("GOLDEN LIVE: both new questions are on the locked list and reachable only through the door", { skip }, async () => {
  const { describeDoor } = await import("./service");
  const keys = describeDoor().map((q) => q.question_key);
  assert.ok(keys.includes("kill_scale_read"));
  assert.ok(keys.includes("health_check"));
  // Brick 3 added two and changed none. Brick 4 added three more and changed
  // none. Brick 6 added the funnel pack's four and changed none, so the list is
  // 21. This is the ONE assertion each later brick updates in a Brick 3 golden
  // test, and it is updated because the locked list grew on purpose: it is a
  // count of certified questions, not a behaviour.
  assert.equal(keys.length, 21);
  // The pre-existing kill_scale_inputs is untouched and still answering.
  assert.ok(keys.includes("kill_scale_inputs"));
  // Brick 3's two are still here, unchanged, alongside Brick 4's three.
  for (const k of ["coverage_report", "resolution_queue", "capture_health"]) {
    assert.ok(keys.includes(k), `${k} must be on the locked list`);
  }
});
