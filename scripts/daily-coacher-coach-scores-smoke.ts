#!/usr/bin/env node
/**
 * Daily Coacher — coach scores smoke test.
 *
 * Computes the Daily Coacher Usage Score for every coach with at least one
 * active client and prints the breakdown so we can verify the formula
 * against the live data.
 *
 *   npx tsx scripts/daily-coacher-coach-scores-smoke.ts
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local"), override: true });

import { getCoachDailyCoacherScores, boostPctForScore, BOOST_PCT_BY_SCORE } from "../src/lib/daily-coacher/coach-scores";

async function main(): Promise<void> {
  console.log("\n=== Boost table sanity check ===");
  for (let i = 0; i <= 10; i++) {
    console.log(`  score ${i.toString().padStart(2)} -> +${BOOST_PCT_BY_SCORE[i]}% (via getter: ${boostPctForScore(i)}%)`);
  }

  console.log("\n=== Per-coach Daily Coacher Usage Score ===");
  const start = Date.now();
  const scores = await getCoachDailyCoacherScores();
  const elapsed = Date.now() - start;
  console.log(`(computed in ${elapsed}ms)\n`);

  const entries = Object.entries(scores).sort((a, b) => b[1].score - a[1].score);
  if (entries.length === 0) {
    console.log("  (no coaches have active clients)");
    return;
  }

  for (const [coach, e] of entries) {
    console.log(
      `  ${coach.padEnd(12)} score=${e.score.toString().padStart(2)}/10  +${e.boostPct.toString().padStart(2)}% boost   (${e.totalEvents} events across ${e.activeClientCount} active clients)`
    );
  }
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exit(1);
});
