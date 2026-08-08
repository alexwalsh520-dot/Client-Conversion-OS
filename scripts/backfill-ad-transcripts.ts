// ─────────────────────────────────────────────────────────────────────────
// BRICK 7 BACKFILL: transcribe the whole video fleet, once.
//
// The two-hourly creative cron keeps transcripts CURRENT as new ads launch; it
// is deliberately bounded and would take days to chew through the standing
// fleet. This runs the SAME pipeline, unbounded, so the backlog is cleared in
// one pass and the cron only ever has new work.
//
// PAUSED ADS ARE INCLUDED. That is the point of the exercise: LOADED (6x when
// it was paused on 24 July) and STRENGTH (paused 7 August) are the bench, and a
// paused winner whose words nobody can read is a winner nobody can relaunch.
//
// Usage:
//   npx tsx scripts/backfill-ad-transcripts.ts            # every active creator
//   npx tsx scripts/backfill-ad-transcripts.ts tyson      # one creator
// ─────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

async function main(): Promise<void> {
  const { ACTIVE_CREATORS, firstEnv } = await import("../src/lib/creators");
  const { runTranscriptPass, findVideoAdsNeedingTranscript } = await import("../src/lib/ads-tracker/creative-transcript");

  const only = process.argv[2]?.trim().toLowerCase() || null;
  const creators = ACTIVE_CREATORS.filter((c) => (!only || c.key === only) && firstEnv(c.tokenEnv)).map((c) => ({
    key: c.key,
    token: firstEnv(c.tokenEnv)!,
  }));
  if (!creators.length) {
    console.error(`no creator with a usable token${only ? ` matched "${only}"` : ""}. Nothing was attempted.`);
    process.exit(1);
  }

  for (const c of creators) {
    const todo = await findVideoAdsNeedingTranscript(c.key, 10_000);
    console.log(`${c.key}: ${todo.length} video ads need a transcript`);
  }

  // Loop the bounded pass until it stops making progress, so the run is
  // resumable and one hung video can never strand the rest.
  let round = 0;
  for (;;) {
    round += 1;
    const res = await runTranscriptPass({
      creators,
      perRun: 25,
      budgetMs: 15 * 60_000,
      concurrency: 3,
    });
    console.log(
      `round ${round}: attempted ${res.attempted}, ok ${res.ok}, failed ${res.failed}, remaining ${res.remaining}`,
    );
    for (const f of res.failures) console.log(`  FAILED ${f.client} ${f.ad_id}: ${f.reason}`);
    if (res.attempted === 0) break;
  }

  console.log("backfill complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
