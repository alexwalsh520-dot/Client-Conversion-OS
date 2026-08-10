#!/usr/bin/env node
// Reference enumeration sweep for the Semantic Layer consolidation.
//
// Law 2 of the build: nothing moves until its references are enumerated. This is
// the repo half of that sweep. For every candidate table it finds every file that
// names it, and splits the supabase-js call sites into readers and writers, because
// a writer that upserts must be repointed in the same phase as the move (law 6:
// a Postgres view cannot take INSERT ... ON CONFLICT).
//
// Usage: node scripts/reference-sweep.mjs > docs/fixtures/reference-sweep.json

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const TARGETS = {
  floor2: [
    "ads_meta_insights_daily", "ads_keyword_events", "dm_conversation_messages", "ghl_appointments",
    "sales_tracker_rows", "manychat_origin_checks", "manychat_tag_events", "instagram_lead_links",
    "fx_rates", "fathom_calls", "fathom_call_links", "creator_content", "creator_account_snapshots",
  ],
  floor3: [
    "adsv2_dm_facts", "adsv2_booking_facts", "adsv2_sale_facts", "adsv2_sale_resolutions",
    "adsv2_booking_resolutions", "adsv2_window_snapshots", "adsv2_budget_snapshots", "adsv2_targeting_snapshots",
    "adsv2_alerts", "adsv2_sync_runs", "adsv2_meta", "ad_creative_copy", "ad_creative_image",
    "ad_creative_transcripts", "ad_set_targeting", "ads_dashboard_snapshots", "sale_attribution_facts",
  ],
  floor4: [
    "registry_entities", "registry_persons", "registry_person_merges", "registry_person_link_queue",
    "registry_person_link_conflicts", "registry_keywords", "registry_definitions", "organic_keywords",
  ],
  door: ["door_ask_log", "door_miss_log", "door_freshness_thresholds"],
  shrink_candidates: [
    "ads_attribution_exceptions", "ads_attribution_facts", "ads_keyword_backfill_runs",
    "ads_keyword_backfill_rows", "attribution_summary", "dm_identity", "manychat_contact_links", "dm_ad_links",
  ],
};

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", "fixtures"]);
const KEEP_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".json", ".md"]);

async function walkFiles(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".claude") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walkFiles(full, acc);
    } else if (KEEP_EXT.has(path.extname(e.name))) {
      const s = await stat(full);
      if (s.size < 4_000_000) acc.push(full);
    }
  }
  return acc;
}

// A supabase-js write is an upsert, insert, update or delete anywhere in the same
// chained expression as .from("<table>"). The chain can run either way round
// (.from(t).upsert(...) or .upsert(...) after a filter), so both sides are scanned
// within a window of the call site rather than assuming an order.
function classifyCallSites(text, table) {
  const readers = [];
  const writers = [];
  const rpcs = [];
  const fromRe = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]`, "g");
  let m;
  while ((m = fromRe.exec(text)) !== null) {
    const line = text.slice(0, m.index).split("\n").length;
    const window = text.slice(m.index, m.index + 400);
    const isWrite = /\.(upsert|insert|update|delete)\s*\(/.test(window);
    const upsert = /\.upsert\s*\(/.test(window);
    (isWrite ? writers : readers).push({ line, upsert });
  }
  // A raw SQL string naming the table, which a schema move would also break.
  const sqlRe = new RegExp(`(from|join|into|update|table)\\s+(public\\.)?${table}\\b`, "gi");
  while ((m = sqlRe.exec(text)) !== null) {
    rpcs.push({ line: text.slice(0, m.index).split("\n").length, snippet: m[0] });
  }
  return { readers, writers, rpcs };
}

const root = process.cwd();
const files = await walkFiles(path.join(root, "src"));
files.push(...(await walkFiles(path.join(root, "scripts"))));
files.push(...(await walkFiles(path.join(root, "supabase"))));
files.push(...(await walkFiles(path.join(root, "mcp-utari"))));

const contents = new Map();
for (const f of files) contents.set(f, await readFile(f, "utf8"));

const report = {};
for (const [floor, tables] of Object.entries(TARGETS)) {
  for (const table of tables) {
    const hits = [];
    for (const [f, text] of contents) {
      if (!text.includes(table)) continue;
      const rel = path.relative(root, f);
      const { readers, writers, rpcs } = classifyCallSites(text, table);
      const mentions = text.split(table).length - 1;
      hits.push({
        file: rel,
        mentions,
        supabase_readers: readers.length,
        supabase_writers: writers.length,
        upsert_writers: writers.filter((w) => w.upsert).length,
        sql_text_refs: rpcs.length,
        is_migration: rel.startsWith("supabase/migrations/"),
        is_test: /\.test\.|\.golden\./.test(rel),
      });
    }
    const live = hits.filter((h) => !h.is_migration);
    report[table] = {
      floor,
      files_total: hits.length,
      files_excluding_migrations: live.length,
      supabase_writers: live.reduce((n, h) => n + h.supabase_writers, 0),
      upsert_writers: live.reduce((n, h) => n + h.upsert_writers, 0),
      supabase_readers: live.reduce((n, h) => n + h.supabase_readers, 0),
      sql_text_refs: live.reduce((n, h) => n + h.sql_text_refs, 0),
      writer_files: live.filter((h) => h.supabase_writers > 0).map((h) => h.file),
      reader_files: live.filter((h) => h.supabase_readers > 0 && h.supabase_writers === 0).map((h) => h.file),
      other_mention_files: live.filter((h) => h.supabase_readers === 0 && h.supabase_writers === 0).map((h) => h.file),
    };
  }
}

console.log(JSON.stringify({ scanned_files: files.length, tables: report }, null, 2));
