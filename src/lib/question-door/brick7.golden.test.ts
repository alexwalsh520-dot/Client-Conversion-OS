// ─────────────────────────────────────────────────────────────────────────
// BRICK 7 GOLDEN FIXTURES: against the REAL database, not a fake.
//
// Same discipline as Bricks 2, 3 and 4: a constructed database is right for
// pinning BEHAVIOUR (see ad-copy.test.ts) and useless for pinning CONTENT,
// because a fake that returns what the code expects proves only that the code
// agrees with itself. What this brick claims is that a specific paused winner's
// words are now readable, so the fixture has to be that ad's actual words.
//
// THE FIXTURE PHRASE BELOW WAS HUMAN-VERIFIED. Tyson's LOADED was read by hand
// on 31 July 2026 and its on-screen callout recorded as the "5 servicemen stuck
// at the same body" family. On 8 August the pipeline read the same ad from its
// own frames and returned "I'm looking for / 5 servicemen / stuck at the same
// body for 6-18 months...". The phrase asserted here was taken from THAT stored
// transcript after checking it against the hand read, and it is recorded in
// docs/truthlayer-brick7-report.md verbatim.
//
// SKIPS LOUDLY without credentials, so it can never pass by not running.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { askQuestion, describeDoor } from "./service";
import { isRefusal, type Db, type DoorAnswer } from "./types";

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
const skip = LIVE ? false : "no database credentials in the environment, so the Brick 7 goldens were NOT checked";

function liveDb(): Db {
  return createClient(URL!, KEY!, { auth: { persistSession: false } }) as unknown as Db;
}

const CLIENTS = ["tyson", "jake"] as const;

function answerOf(r: unknown): DoorAnswer {
  assert.ok(!isRefusal(r as never), `expected an answer, got a refusal: ${JSON.stringify(r).slice(0, 600)}`);
  return r as DoorAnswer;
}

// ─────────────────────────────────────────────────────────────────────────
// THE GOLDEN AD. Tyson's LOADED: 6.84x collected ROI over the lookback,
// paused on 24 July, and a SILENT b-roll video, which is why its words were
// unreachable until this brick read its frames.
// ─────────────────────────────────────────────────────────────────────────

const LOADED_AD_ID = "52581821002664";
const LOADED_VIDEO_ID = "1568382338182019";
/** Human-verified 31 July 2026, re-read from the ad's own frames 8 August. */
const LOADED_PHRASE = "5 servicemen";
const LOADED_PHRASE_2 = "stuck at the same body";

// ─────────────────────────────────────────────────────────────────────────
// (a) LOADED'S WORDS EXIST, AND THEY ARE THE WORDS A HUMAN READ OFF THE AD.
// ─────────────────────────────────────────────────────────────────────────

test("(a) GOLDEN: LOADED's stored creative read carries the hand-verified servicemen callout", { skip }, async () => {
  const db = liveDb();
  const { data, error } = await db
    .from("ad_creative_transcripts")
    .select("ad_id, video_id, status, audio_status, on_screen_status, on_screen_text, transcript_text, frames_read, duration_s, model, on_screen_model")
    .eq("ad_id", LOADED_AD_ID)
    .maybeSingle();
  assert.equal(error, null, `reading LOADED's transcript failed: ${error?.message}`);
  assert.ok(data, "LOADED has no row in ad_creative_transcripts at all: the backfill did not reach it");

  const row = data as Record<string, unknown>;
  assert.equal(row.video_id, LOADED_VIDEO_ID);
  assert.equal(row.status, "ok", `LOADED was not read successfully: ${JSON.stringify(row).slice(0, 400)}`);

  // The ad is silent b-roll. That is a FACT about it, recorded as such, and it
  // is the whole reason an audio-only pipeline would have filed the best ad on
  // the bench as a failure.
  assert.equal(row.audio_status, "no_audio");
  assert.equal(row.on_screen_status, "ok");

  const printed = String(row.on_screen_text || "");
  assert.ok(
    printed.toLowerCase().includes(LOADED_PHRASE),
    `LOADED's on-screen text does not contain "${LOADED_PHRASE}". Stored text was: ${printed.slice(0, 300)}`,
  );
  assert.ok(
    printed.toLowerCase().includes(LOADED_PHRASE_2),
    `LOADED's on-screen text does not contain "${LOADED_PHRASE_2}". Stored text was: ${printed.slice(0, 300)}`,
  );
  assert.ok(Number(row.frames_read) >= 3, "fewer than three frames were read, which is not a read of the whole video");
});

test("(a) the door itself returns LOADED's words, labelled, through ad_copy", { skip }, async () => {
  const r = await askQuestion(
    { question_key: "ad_copy", params: { client: "tyson", ad_id: LOADED_AD_ID } },
    { db: liveDb(), clients: [...CLIENTS], caller: "test" },
  );
  const a = answerOf(r);
  const body = a.answers as { ads: Array<Record<string, unknown>> };
  assert.equal(body.ads.length, 1);
  const ad = body.ads[0];
  assert.equal(ad.creative_type, "video");
  assert.equal(ad.content_known, true);

  const blocks = ad.what_the_ad_says as Array<{ label: string; text: string | null }>;
  const printed = blocks.find((b) => b.label === "words_printed_on_the_video");
  assert.ok(
    String(printed?.text || "").toLowerCase().includes(LOADED_PHRASE),
    "the door did not return LOADED's printed on-screen words",
  );

  // And the caption is somewhere else entirely, which is the point.
  const caption = ad.caption as { label: string; text: string | null };
  assert.equal(caption.label, "caption_above_the_creative");
  for (const b of blocks) {
    assert.notEqual(b.text, caption.text, `the caption came back under "${b.label}"`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// (b) JAKE'S VIDEO FLEET IS KNOWN.
//
// Jake's ads were proven video-only with empty thumbnail OCR on 31 July. If
// this brick works, his copy coverage BY SPEND is high; if it does not, the
// failure message lists every ad that is still unknown and what it spent, so a
// failure explains itself rather than just going red.
// ─────────────────────────────────────────────────────────────────────────

test("(b) jake's copy coverage by spend clears 90%, or names every miss", { skip }, async () => {
  const r = await askQuestion(
    { question_key: "ad_copy", params: { client: "jake" } },
    { db: liveDb(), clients: [...CLIENTS], caller: "test" },
  );
  const a = answerOf(r);
  const body = a.answers as {
    copy_coverage: { coverage_pct_by_spend: number; spend_usd_cents: number; ads_in_window: number };
    unknown_content: Array<{ ad_id: string; keyword: string | null; spend_usd_cents: number | null; why: string | null }>;
  };

  const misses = body.unknown_content
    .slice()
    .sort((x, y) => (y.spend_usd_cents ?? 0) - (x.spend_usd_cents ?? 0))
    .map((u) => `  ${u.keyword ?? u.ad_id}: $${((u.spend_usd_cents ?? 0) / 100).toFixed(2)} — ${u.why}`)
    .join("\n");

  assert.ok(
    body.copy_coverage.coverage_pct_by_spend >= 90,
    `jake's copy coverage by spend is ${body.copy_coverage.coverage_pct_by_spend}% over ${body.copy_coverage.ads_in_window} ads and $${(body.copy_coverage.spend_usd_cents / 100).toFixed(2)} of spend. Every ad whose content is still unknown:\n${misses}`,
  );
});

test("(b) jake's video ads specifically are known, not just his stills", { skip }, async () => {
  const r = await askQuestion(
    { question_key: "ad_copy", params: { client: "jake" } },
    { db: liveDb(), clients: [...CLIENTS], caller: "test" },
  );
  const a = answerOf(r);
  const body = a.answers as {
    by_creative_type: Array<{ creative_type: string; ads: number; known_ads: number; coverage_pct_by_spend: number }>;
  };
  const video = body.by_creative_type.find((t) => t.creative_type === "video");
  assert.ok(video, "jake has no video ads in the window, which contradicts everything known about his fleet");
  assert.ok(video!.ads > 0, "jake's video ad count is zero");
  assert.ok(
    video!.coverage_pct_by_spend >= 90,
    `jake's VIDEO coverage by spend is ${video!.coverage_pct_by_spend}% across ${video!.ads} video ads (${video!.known_ads} known)`,
  );
});

// ─────────────────────────────────────────────────────────────────────────
// (d) THE BENCH KNOWS ABOUT LOADED AND STRENGTH.
// ─────────────────────────────────────────────────────────────────────────

test("(d) creative_bench shelves LOADED and STRENGTH as paused-proven with real prior windows", { skip }, async () => {
  const r = await askQuestion(
    { question_key: "creative_bench", params: { client: "tyson" } },
    { db: liveDb(), clients: [...CLIENTS], caller: "test" },
  );
  const a = answerOf(r);
  const body = a.answers as {
    paused_proven: Array<Record<string, unknown>>;
    thresholds_applied: Record<string, unknown>;
    bench_depth: number;
  };

  const byKeyword = new Map(body.paused_proven.map((p) => [String(p.keyword).toLowerCase(), p]));
  const loaded = byKeyword.get("loaded");
  const strength = byKeyword.get("strength");

  assert.ok(loaded, `LOADED is not on the paused-proven shelf. Shelf held: ${[...byKeyword.keys()].join(", ")}`);
  assert.ok(strength, `STRENGTH is not on the paused-proven shelf. Shelf held: ${[...byKeyword.keys()].join(", ")}`);

  // Real numbers, not placeholders: each cleared the signed ROI line on real
  // spend, and each carries the window that claim was measured over.
  for (const [name, item] of [["LOADED", loaded!], ["STRENGTH", strength!]] as const) {
    const roi = Number(item.collected_roi);
    assert.ok(roi >= 2, `${name} is on the proven shelf with a collected ROI of ${roi}, under the signed 2x line`);
    assert.ok(Number(item.spend_usd_cents) >= 10000, `${name} did not clear the $100 evidence floor`);
    assert.ok(Number(item.collected_usd_cents) > 0, `${name} is on the proven shelf with no cash behind it`);
    const w = item.best_prior_window as { from: string; to: string };
    assert.match(w.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(w.to, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(item.delivery_state, "not_active", `${name} is on the paused shelf but reads as delivering`);
    assert.ok(String(item.why_it_stopped).length > 10, `${name} does not say what stopped it`);
    // The one input the signed tree needs and this system does not record is
    // stated as unrecorded, never defaulted.
    const inputs = item.signed_tree_inputs as Record<string, unknown>;
    assert.match(String(inputs.fresh_creative_tested), /UNRECORDED/);
    assert.equal(inputs.cleared_kpi_line_before, true);
  }

  // Thresholds came from the registry, not from code.
  assert.equal(body.thresholds_applied.from, "registry_definitions, at answer time");
  assert.equal(Number(body.thresholds_applied.paused_proven_min_collected_roi), 2);
});

test("(d) bench thinness fires only when the shelf behind a live winner is empty", { skip }, async () => {
  const db = liveDb();
  for (const client of CLIENTS) {
    const r = await askQuestion(
      { question_key: "creative_bench", params: { client } },
      { db, clients: [...CLIENTS], caller: "test" },
    );
    const a = answerOf(r);
    const body = a.answers as {
      bench_depth: number;
      bench_thinness: Array<Record<string, unknown>>;
      live: Array<Record<string, unknown>>;
      thresholds_applied: { kpi_line_min_collected_roi: number; evidence_floor_usd_cents: number };
    };

    const kpi = Number(body.thresholds_applied.kpi_line_min_collected_roi);
    const floor = Number(body.thresholds_applied.evidence_floor_usd_cents);
    const liveWinners = body.live.filter(
      (l) => Number(l.collected_roi ?? 0) >= kpi && Number(l.spend_usd_cents) >= floor,
    );

    if (body.bench_depth > 0) {
      assert.equal(
        body.bench_thinness.length,
        0,
        `${client} has a bench ${body.bench_depth} deep, so no live ad should be flagged as having an empty one`,
      );
    } else {
      assert.equal(
        body.bench_thinness.length,
        liveWinners.length,
        `${client} has an empty bench and ${liveWinners.length} live ads at or above the ${kpi}x line, so every one of them should be flagged`,
      );
    }
    // Whatever it flags, it never prescribes.
    for (const f of body.bench_thinness) {
      assert.equal(f.flag, "live_winner_with_an_empty_bench");
    }
  }
});

test("(d) creative_bench returns FACTS only: no verdict, no recommendation", { skip }, async () => {
  const r = await askQuestion(
    { question_key: "creative_bench", params: { client: "tyson" } },
    { db: liveDb(), clients: [...CLIENTS], caller: "test" },
  );
  const a = answerOf(r);
  const serialized = JSON.stringify(a.answers).toLowerCase();
  // No verdict FIELD, under any of the names this codebase uses for one.
  for (const field of ['"verdict"', '"verdicts"', '"ad_verdicts"', '"under_ruleset"', '"recommendation"']) {
    assert.equal(
      serialized.includes(field),
      false,
      `creative_bench is signed verdict-free and its answer carries the field ${field}`,
    );
  }
  // And no prescription in its prose either.
  for (const phrase of ["we recommend", "you should", "should be relaunched", "should be killed", "turn this back on"]) {
    assert.equal(serialized.includes(phrase), false, `creative_bench prescribes: it says "${phrase}"`);
  }
  // What it DOES do is name the signed tree those facts feed.
  assert.ok(
    serialized.includes("verdict_floors_kill_tree"),
    "the bench must cite the signed decision tree its facts feed, even though it applies none of it",
  );
});

// ─────────────────────────────────────────────────────────────────────────
// (e) PIPELINE ISOLATION. One bad video costs itself and nothing else.
// ─────────────────────────────────────────────────────────────────────────

test("(e) a video that cannot be resolved writes a failed row and never throws", { skip }, async () => {
  const { transcribeOneAd } = await import("@/lib/ads-tracker/creative-transcript");
  const db = liveDb();

  // Two synthetic ads with video ids Meta will not resolve. The first proves a
  // failure is RECORDED rather than raised; the second proves the run carries
  // on afterwards, which is the property warehouse law 14 actually asks for.
  const synthetic = ["brick7_synthetic_failure_a", "brick7_synthetic_failure_b"];
  const tokens = { user: "not-a-real-token", pages: [] as string[] };

  try {
    const first = await transcribeOneAd({
      adId: synthetic[0],
      videoId: "000000000000000",
      clientKey: "tyson",
      tokens,
    });
    assert.equal(first.status, "failed");
    assert.ok(first.reason && first.reason.length > 10, "a failure must carry a written reason");

    const second = await transcribeOneAd({
      adId: synthetic[1],
      videoId: "000000000000001",
      clientKey: "tyson",
      tokens,
    });
    assert.equal(second.status, "failed", "the second ad did not run, so one bad video stopped the run");

    const { data } = await db
      .from("ad_creative_transcripts")
      .select("ad_id, status, failure_reason, attempts")
      .in("ad_id", synthetic);
    const rows = (data || []) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 2, "a failed video must leave a counted row, not disappear");
    for (const row of rows) {
      assert.equal(row.status, "failed");
      assert.ok(String(row.failure_reason || "").length > 10, "the stored row must say why");
      assert.ok(Number(row.attempts) >= 1, "the attempt must be counted");
    }
  } finally {
    // These two ad ids are test fixtures, not facts about the business, so they
    // are removed. Nothing real is ever deleted from this table.
    await db.from("ad_creative_transcripts").delete().in("ad_id", synthetic);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// THE LOCKED LIST GREW BY EXACTLY TWO.
// ─────────────────────────────────────────────────────────────────────────

test("(f) the locked list is twenty-five questions, and the two new ones are on it", { skip }, () => {
  const door = describeDoor();
  // 23 when Brick 7 started (Bricks 5 and 6 landed first); 25 with ad_copy and
  // creative_bench. Brick 7 added two and changed none.
  assert.equal(door.length, 25, `the locked list should hold twenty-five questions, it holds ${door.length}`);
  const keys = door.map((q) => q.question_key);
  assert.ok(keys.includes("ad_copy"));
  assert.ok(keys.includes("creative_bench"));
  // Every question from Bricks 1 to 6 is still here, by name.
  for (const earlier of [
    "metric_value",
    "yesterday_summary",
    "change_history",
    "why_unattributed",
    "ad_setup",
    "person_lookup",
    "sales_cycle",
    "attribution_share",
    "leak_map",
    "kill_scale_inputs",
    "kill_scale_read",
    "health_check",
    "coverage_report",
    "resolution_queue",
    "capture_health",
    "creator_funnel",
    "portfolio_pace",
    "budget_map",
    "scale_headroom",
    "person_timeline",
    "lead_quality_read",
    "data_health",
    "define",
  ]) {
    assert.ok(keys.includes(earlier), `Brick 7 lost an earlier question: ${earlier}`);
  }
});

test("(f) an unknown creative question is refused in writing, not improvised", { skip }, async () => {
  const r = await askQuestion(
    { question_key: "what_does_this_ad_look_like", params: { client: "tyson" } },
    { db: liveDb(), clients: [...CLIENTS], caller: "test" },
  );
  assert.ok(isRefusal(r));
  if (isRefusal(r)) {
    assert.ok(r.allowed_questions.includes("ad_copy"));
    assert.equal(r.allowed_questions.length, 25);
  }
});
