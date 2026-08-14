#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// PHASE 4: the ManyChat identity backfill.
//
// Roughly two thirds of the people who sent a magic word cannot be tied to a
// readable Instagram thread, because ManyChat's subscriber ids and Instagram's
// scoped ids are different id spaces. ManyChat's own subscriber record carries
// both. This asks for it, one subscriber at a time, and files the pairing as
// hard evidence.
//
// WHAT IT WILL NOT DO
//   It never writes to ManyChat. getInfo is a read.
//   It never overwrites an existing link. Pairings go into
//   registry_person_link_queue and through the normal link path, so a pairing
//   that disagrees with what is already known lands in the conflict log instead
//   of quietly winning.
//   It never asks about the same subscriber twice, across any number of runs.
//
// HOW IT BEHAVES WHEN THINGS GO WRONG
//   Rate limited (HTTP 429, or Facebook error code 17): STOP the whole run,
//   cleanly, and say when to come back. Not a retry storm.
//   Any other error on one subscriber: record it and move on. One bad row must
//   not end a run of thousands.
//   Interrupted for any reason: the cursor is in the database, so the next run
//   picks up exactly where this one stopped.
//
// USAGE
//   node scripts/manychat-identity-backfill.mjs --dry-run            plan only, no calls
//   node scripts/manychat-identity-backfill.mjs --client tyson --limit 50
//   node scripts/manychat-identity-backfill.mjs --client tyson       the full run
//
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the creator's
// ManyChat key in the environment. Run it with --env-file=.env.local.
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const MANYCHAT_BASE = process.env.MANYCHAT_BASE || "https://api.manychat.com/fb";

// ManyChat publishes a limit of 10 requests a second per token. Two a second is
// a deliberately generous margin: this job is not in a hurry and a throttled
// account would cost far more than the time saved.
const REQUESTS_PER_SECOND = 2;
const GAP_MS = Math.ceil(1000 / REQUESTS_PER_SECOND);

// Per-call ceiling, so one hanging request cannot stall a run of thousands.
const CALL_TIMEOUT_MS = 15_000;

// Backoff for transient failures on a single subscriber, before giving up on it
// and moving to the next. Rate limits are NOT handled here: those stop the run.
const RETRY_DELAYS_MS = [1_000, 4_000, 16_000];

const KEY_ENV = {
  tyson: ["MANYCHAT_API_KEY_TYSON", "MANYCHAT_API_KEY"],
  jake: ["MANYCHAT_API_KEY_JAKE_DIVLJAK", "MANYCHAT_API_KEY_JAKE"],
  keith: ["MANYCHAT_API_KEY_KEITH"],
  lucy: ["MANYCHAT_API_KEY_LUCY_HUBBARD", "MANYCHAT_API_KEY_LUCY"],
  antwan: ["MANYCHAT_API_KEY_ANTWAN_RARCUS", "MANYCHAT_API_KEY_ANTWAN"],
};

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const DRY_RUN = args.includes("--dry-run");
const CLIENT = flag("client");
const LIMIT = Number(flag("limit", "0")) || 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function keyFor(client) {
  for (const name of KEY_ENV[client] || []) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("no database credentials in the environment");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * One batch of keyword senders with no Instagram link and no previous attempt.
 * Computed in the database rather than here, because the "already linked" test
 * spans three tables and pulling them all into node to intersect would be silly.
 *
 * A BATCH, not the whole list, and that distinction cost a bug: the API in front
 * of the database caps any single response at 1,000 rows, so asking for "all of
 * them" quietly returns 1,000 and a run would look complete while thousands were
 * still waiting. The caller loops instead, and because every subscriber asked
 * about is recorded, the next batch is always the next unasked thousand.
 */
const BATCH = 1000;

async function targetBatch(sb, client, limit) {
  const { data, error } = await sb.rpc("manychat_backfill_targets", {
    p_client: client || null,
    p_limit: Math.min(limit || BATCH, BATCH),
  });
  if (error) throw new Error(`could not read the work list: ${error.message}`);
  return data || [];
}

/** How many are actually outstanding, counted in the database, not guessed. */
async function outstandingCount(sb, client) {
  const { data, error } = await sb.rpc("manychat_backfill_target_count", { p_client: client || null });
  if (error) throw new Error(`could not count the work list: ${error.message}`);
  return Number(data) || 0;
}

/** ManyChat's own record of a subscriber. Read only: this changes nothing there. */
async function getInfo(key, subscriberId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${MANYCHAT_BASE}/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`,
      { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: controller.signal },
    );
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: res.status, rateLimited: res.status === 429, data: null, error: "non_json" };
    }
    // Facebook error code 17 is "user request limit reached". It means stop, not retry.
    const fbCode = parsed?.details?.messages?.[0]?.code ?? parsed?.error?.code ?? null;
    return {
      status: res.status,
      rateLimited: res.status === 429 || Number(fbCode) === 17,
      data: parsed?.data ?? null,
      error: parsed?.status === "error" ? JSON.stringify(parsed).slice(0, 300) : undefined,
    };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return { status: 0, rateLimited: false, data: null, error: aborted ? "timeout" : String(err).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const sb = db();
  const clients = CLIENT ? [CLIENT] : ["tyson", "jake", "keith", "lucy", "antwan"];

  for (const client of clients) {
    const outstanding = await outstandingCount(sb, client);
    const key = keyFor(client);

    console.log(`\n${client}: ${outstanding} subscriber${outstanding === 1 ? "" : "s"} to ask about`);
    if (!outstanding) continue;

    if (!key) {
      console.log(`  no ManyChat key for ${client} in this environment, so these are recorded as no_key and skipped`);
      if (!DRY_RUN) {
        let batch;
        while ((batch = await targetBatch(sb, client, 0)).length) {
          await sb.schema("warehouse").from("manychat_identity_backfill").upsert(
            batch.map((w) => ({ manychat_id: String(w.manychat_id), client_key: client, outcome: "no_key" })),
            { onConflict: "manychat_id" },
          );
        }
      }
      continue;
    }

    if (DRY_RUN) {
      const planned = LIMIT ? Math.min(LIMIT, outstanding) : outstanding;
      console.log(`  dry run: would make ${planned} read-only calls at ${REQUESTS_PER_SECOND}/s, about ${Math.ceil((planned * GAP_MS) / 60000)} minutes`);
      continue;
    }

    const tally = { paired: 0, no_ig_on_record: 0, not_found: 0, error: 0 };
    let done = 0;
    const ceiling = LIMIT ? Math.min(LIMIT, outstanding) : outstanding;

    // Page through. Because every subscriber asked about is recorded, the next
    // batch is always the next unasked thousand, with no offset to keep track of.
    let work = await targetBatch(sb, client, ceiling - done);
    while (work.length && done < ceiling) {
    for (const [i, w] of work.entries()) {
      if (done >= ceiling) break;
      const id = String(w.manychat_id);
      let info = null;

      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        info = await getInfo(key, id);
        if (info.rateLimited) {
          console.log(
            `\n  RATE LIMITED after ${i} of ${work.length}. Stopping cleanly rather than pushing.` +
              `\n  Everything done so far is recorded, so re-running later picks up exactly here.`,
          );
          console.table(tally);
          return;
        }
        if (!info.error || attempt === RETRY_DELAYS_MS.length) break;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }

      const igId = info.data?.ig_id != null ? String(info.data.ig_id) : null;
      const igUsername = info.data?.ig_username != null ? String(info.data.ig_username) : null;

      let outcome;
      if (info.error) outcome = "error";
      else if (info.status === 404 || !info.data) outcome = "not_found";
      else if (!igId) outcome = "no_ig_on_record";
      else outcome = "paired";
      tally[outcome] = (tally[outcome] || 0) + 1;

      let queued = false;
      if (outcome === "paired") {
        // The pairing goes through the ordinary link path, which is what applies
        // the conflict rules. Nothing here writes registry_persons directly.
        const { error: qErr } = await sb.schema("warehouse").from("registry_person_link_queue").insert({
          system_a: "manychat",
          id_a: id,
          system_b: "instagram",
          id_b: igId,
          source: "manychat_subscriber_record",
          confidence: "hard",
          display_name: igUsername,
          client_key: client,
        });
        queued = !qErr;
        if (qErr) console.log(`  could not queue the pairing for ${id}: ${qErr.message}`);
      }

      await sb.schema("warehouse").from("manychat_identity_backfill").upsert(
        {
          manychat_id: id,
          client_key: client,
          outcome,
          ig_id: igId,
          ig_username: igUsername,
          http_status: info.status || null,
          error: info.error || null,
          queued_link: queued,
        },
        { onConflict: "manychat_id" },
      );

      done += 1;
      if (done % 100 === 0) console.log(`  ${done}/${ceiling}  ${JSON.stringify(tally)}`);
      await sleep(GAP_MS);
    }
      work = done < ceiling ? await targetBatch(sb, client, ceiling - done) : [];
    }

    console.log(`  ${client} done: ${done} asked,`, JSON.stringify(tally));
  }

  if (!DRY_RUN) {
    // Hand everything queued to the existing resolver, which is the only thing
    // allowed to decide what a person is.
    const { error } = await sb.rpc("registry_person_drain_queue");
    console.log(error ? `\ndraining the queue failed: ${error.message}` : "\nqueue drained into registry_persons");
  }
}

run().catch((err) => {
  console.error("the backfill stopped:", err.message);
  process.exitCode = 1;
});
