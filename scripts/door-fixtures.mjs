#!/usr/bin/env node
// Door fixture capture for the Semantic Layer consolidation.
//
// Law 3 of the build: before any change, capture the full JSON answers of a fixed
// panel of door questions with fixed params. After every phase, re-ask and diff.
// Anything non-identical beyond the documented volatile fields means stop and revert.
//
// Usage:
//   node scripts/door-fixtures.mjs capture <label>     writes docs/fixtures/door/<label>/
//   node scripts/door-fixtures.mjs diff <a> <b>        compares two captured labels
//
// The door url and token come from the environment so nothing secret lands in the repo:
//   DOOR_URL    defaults to the deployed door
//   DOOR_TOKEN  required
//
// Two files are written per question:
//   <key>.raw.json    exactly what the door said
//   <key>.norm.json   the same answer with the documented volatile fields blanked
// The gate compares the .norm.json files. The .raw.json files are kept so a
// surprising diff can be read back to the real timestamps it came from.

import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const DOOR_URL = process.env.DOOR_URL || "https://client-conversion-os.vercel.app/api/mcp/utari";
const DOOR_TOKEN = process.env.DOOR_TOKEN || "";

// The window is pinned on purpose. A trailing-window default would move at midnight
// Eastern and every diff across a day boundary would be noise instead of signal.
const WINDOW = { date_from: "2026-07-27", date_to: "2026-08-09" };

// A person who carries all three id systems, so the timeline answer exercises the bridge.
const FIXTURE_PERSON = "00012017-7324-4a2f-ac99-91113c1baf81";

const PANEL = [
  { name: "kill_scale_read_tyson_decide", key: "kill_scale_read", params: { client: "tyson", mode: "decide", ...WINDOW } },
  { name: "kill_scale_read_jake_decide", key: "kill_scale_read", params: { client: "jake", mode: "decide", ...WINDOW } },
  { name: "creator_funnel_tyson", key: "creator_funnel", params: { client: "tyson", ...WINDOW } },
  { name: "creator_funnel_all", key: "creator_funnel", params: { client: "all", ...WINDOW } },
  { name: "budget_map_all", key: "budget_map", params: { client: "all" } },
  { name: "coverage_report_all", key: "coverage_report", params: { client: "all", ...WINDOW } },
  { name: "person_timeline_fixture", key: "person_timeline", params: { person: FIXTURE_PERSON } },
  { name: "ad_copy_tyson_loaded", key: "ad_copy", params: { client: "tyson", keyword: "LOADED" } },
  { name: "health_check_all", key: "health_check", params: { client: "all" } },
  { name: "scale_headroom_tyson", key: "scale_headroom", params: { client: "tyson", ...WINDOW } },
  { name: "portfolio_pace_all", key: "portfolio_pace", params: { client: "all", trend_weeks: 8 } },
  { name: "capture_health_all", key: "capture_health", params: { client: "all", days: 14, sample: 5 } },
  { name: "lead_quality_tyson", key: "lead_quality_read", params: { client: "tyson", ...WINDOW, cohort: "keyword" } },
  { name: "creative_bench_tyson", key: "creative_bench", params: { client: "tyson", ...WINDOW } },
  { name: "attribution_share", key: "attribution_share", params: { ...WINDOW } },
  { name: "leak_map", key: "leak_map", params: { ...WINDOW } },
  { name: "resolution_queue", key: "resolution_queue", params: { limit: 100 } },
  { name: "data_health", key: "data_health", params: {} },
  { name: "define_all", key: "define", params: {} },
];

// Fields that move purely with the clock, with the reason each one moves.
// Anything NOT on this list must be identical between two captures of the same
// data_version. Proven empirically on 2026-08-10 by capturing the panel twice.
const VOLATILE = {
  asked_at: "the clock time the question was asked",
  last_written_at: "when a source table was last written by the hourly sync",
  data_version: "the sync run counter, which advances every hourly refresh",
  generated_at: "the clock time an answer body was generated",
  as_of_time: "the clock time a live read was taken",
  checked_at: "the clock time a health read was taken",
  captured_at: "when a stored snapshot was taken",
  fetched_at: "when a live Meta read was taken",
  ran_at: "when a check ran",
  updated_at: "row write time",
  created_at: "row write time",
  hours_since_last: "hours since a source was last written, which grows by the minute",
  age_hours: "how old a stored photo is, which grows by the hour",
  age_minutes: "how old a stored photo is, which grows by the minute",
  age_days: "how old a stored photo is, which grows by the day",
  snapshot_age_hours: "how old the stored budget photo is",
  snapshot_age_minutes: "how old the stored budget photo is",
  // The receipt's stale list and its matching caveats are produced by comparing a
  // write time against a threshold, so they flip on the clock alone. Proven on
  // 2026-08-10: two captures 51 seconds apart disagreed only because the budget
  // photo crossed its 26 hour line between them.
  stale: "the list of sources past their freshness threshold, which the clock alone can flip",
};

// Two questions in the panel are clock-threshold reads: they compare a write time
// against a freshness line and change their verdict the moment the line is crossed,
// with no data change at all. Proven on 2026-08-10: two captures 29 seconds apart,
// same sync run, disagreed only because the stored budget photo aged from 26.0 to
// 26.1 hours and crossed its 26 hour threshold, flipping seven dials to stale and
// the overall verdict from degraded to no_go. Their VALUES therefore cannot be
// gated. Their SHAPE is gated instead: every key path the answer contains must
// still be there after a move, which is what a schema move could actually break.
const SHAPE_ONLY = new Set(["budget_map_all", "capture_health_all"]);

// The key skeleton of an answer, with array positions collapsed so a list that
// grows by one row does not read as a structural change.
function shape(value, prefix = "", out = new Set()) {
  if (Array.isArray(value)) {
    for (const v of value) shape(v, `${prefix}[]`, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) shape(v, `${prefix}.${k}`, out);
  } else {
    out.add(`${prefix}:${value === null ? "null" : typeof value}`);
  }
  return out;
}

// Ages and timestamps also appear inside written sentences, for example the
// capture_health evidence line "jake 3.5h ago". Blank them the same way.
function normalizeString(s) {
  return s
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})/g, "<ts>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:h|hours?|minutes?|mins?)\b/gi, "<age>");
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = Object.prototype.hasOwnProperty.call(VOLATILE, k) ? `<volatile:${k}>` : normalize(v);
    }
    return out;
  }
  return typeof value === "string" ? normalizeString(value) : value;
}

// Stable key order so two captures of the same answer serialize identically.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

async function ask(key, params) {
  const res = await fetch(DOOR_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${DOOR_TOKEN}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "ask_question", arguments: key ? { question_key: key, params } : {} },
    }),
  });
  if (!res.ok) throw new Error(`door http ${res.status} for ${key}`);
  const json = await res.json();
  const text = json?.result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error(`door gave no text for ${key}: ${JSON.stringify(json).slice(0, 300)}`);
  return JSON.parse(text);
}

async function capture(label) {
  if (!DOOR_TOKEN) throw new Error("DOOR_TOKEN is not set, so no fixture can be captured");
  const dir = path.join("docs", "fixtures", "door", label);
  await mkdir(dir, { recursive: true });
  const summary = [];
  for (const item of PANEL) {
    let answer;
    try {
      answer = await ask(item.key, item.params);
    } catch (e) {
      answer = { __capture_error: e instanceof Error ? e.message : String(e) };
    }
    await writeFile(path.join(dir, `${item.name}.raw.json`), JSON.stringify(answer, null, 2) + "\n");
    const gated = SHAPE_ONLY.has(item.name)
      ? [...shape(normalize(answer))].sort().join("\n")
      : stableStringify(normalize(answer));
    await writeFile(path.join(dir, `${item.name}.norm.json`), gated + "\n");
    const failed = Boolean(answer && answer.__capture_error);
    summary.push({
      name: item.name,
      question_key: item.key,
      params: item.params,
      ok: !failed,
      data_version: answer?.receipt?.data_version ?? null,
      error: failed ? answer.__capture_error : null,
    });
    console.log(`${failed ? "FAILED " : "captured"} ${item.name}`);
  }
  await writeFile(
    path.join(dir, "_manifest.json"),
    JSON.stringify({ label, door_url: DOOR_URL, window: WINDOW, fixture_person: FIXTURE_PERSON, volatile_fields: VOLATILE, shape_only: [...SHAPE_ONLY], panel: summary }, null, 2) + "\n",
  );
  const bad = summary.filter((s) => !s.ok);
  console.log(`\n${summary.length - bad.length} of ${summary.length} captured into ${dir}`);
  if (bad.length) {
    console.log("failed:", bad.map((b) => b.name).join(", "));
    process.exitCode = 1;
  }
}

async function diff(a, b) {
  const dirA = path.join("docs", "fixtures", "door", a);
  const dirB = path.join("docs", "fixtures", "door", b);
  for (const d of [dirA, dirB]) if (!existsSync(d)) throw new Error(`no fixture directory at ${d}`);
  // A capture is only comparable with another taken against the same sync run.
  // The door recomputes its answers from data that keeps arriving, so an answer
  // about a closed historical window can legitimately change when the hourly sync
  // lands new evidence. Proven on 2026-08-10: two captures 51 seconds apart
  // straddled sync run 455 to 456 and a past window's shown count moved 4 to 5.
  // Comparing across that line would report a data arrival as a consolidation
  // regression, so the gate refuses to rule instead of ruling wrongly.
  const [manA, manB] = await Promise.all([
    readFile(path.join(dirA, "_manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(dirB, "_manifest.json"), "utf8").then(JSON.parse),
  ]);
  const versions = (m) => [...new Set(m.panel.map((p) => p.data_version).filter((v) => v !== null))];
  const [va, vb] = [versions(manA), versions(manB)];
  console.log(`data_version in ${a}: ${va.join(", ") || "none"}`);
  console.log(`data_version in ${b}: ${vb.join(", ") || "none"}`);
  const sameVersion = va.length === 1 && vb.length === 1 && va[0] === vb[0];
  if (!sameVersion) {
    console.log(
      "\nGATE INCONCLUSIVE: these two captures were not taken against the same sync run, " +
        "so a difference cannot be told apart from data that arrived in between. " +
        "Re-capture the pair inside one hour, away from the :25 past the hour sync.",
    );
    process.exitCode = 2;
  }

  const names = (await readdir(dirA)).filter((f) => f.endsWith(".norm.json"));
  let identical = 0;
  const differing = [];
  for (const n of names) {
    const pb = path.join(dirB, n);
    if (!existsSync(pb)) {
      differing.push({ name: n, why: "missing from the later capture" });
      continue;
    }
    const [ta, tb] = await Promise.all([readFile(path.join(dirA, n), "utf8"), readFile(pb, "utf8")]);
    if (ta === tb) identical += 1;
    else differing.push({ name: n, why: `answers differ (${ta.length} vs ${tb.length} characters)` });
  }
  console.log(`identical: ${identical} of ${names.length}`);
  if (differing.length) {
    console.log("DIFFERING:");
    for (const d of differing) console.log(`  ${d.name}: ${d.why}`);
    process.exitCode = 1;
  } else if (sameVersion) {
    console.log("GATE PASS: every door answer is identical once the documented clock-driven fields are blanked.");
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "capture") await capture(rest[0] || "unlabelled");
else if (cmd === "diff") await diff(rest[0], rest[1]);
else {
  console.log("usage: door-fixtures.mjs capture <label> | diff <labelA> <labelB>");
  process.exitCode = 1;
}
