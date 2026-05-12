#!/usr/bin/env node
/**
 * Daily Coacher — summary generation smoke test.
 *
 * Bypasses the API route and calls regenerateAndPersistSummary() directly.
 * Verifies that gathering + Claude call + persistence all work end-to-end
 * for a real client.
 *
 * Usage:
 *   npx tsx scripts/daily-coacher-summary-smoke.ts <clientId>
 *
 * Hits: Supabase (read inputs + write summary), Fathom (if transcript not
 * yet cached), Anthropic API (Claude call).
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local"), override: true });

import { gatherSummaryInputs, isSummaryStale } from "../src/lib/daily-coacher/summary-inputs";
import { regenerateAndPersistSummary } from "../src/lib/daily-coacher/summary-generator";

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npx tsx scripts/daily-coacher-summary-smoke.ts <clientId>");
    process.exit(1);
  }
  const clientId = Number(arg);
  if (!Number.isFinite(clientId)) {
    console.error(`Invalid clientId: ${arg}`);
    process.exit(1);
  }

  console.log(`\n=== Gathering inputs for client ${clientId} ===`);
  const tStart = Date.now();
  const inputs = await gatherSummaryInputs(clientId);
  if (!inputs) {
    console.error("Client not found.");
    process.exit(1);
  }

  console.log(`  Client: ${inputs.client.name} (coach: ${inputs.client.coach_name})`);
  console.log(`  Program: ${inputs.client.program} | ${inputs.client.start_date} → ${inputs.client.end_date}`);
  console.log(`  Progress: Day ${inputs.progress.daysElapsed}/${inputs.progress.programDays} (${inputs.progress.percentThrough}%) — ${inputs.progress.phase}`);
  console.log(`  Intake form:    ${inputs.intake ? "present" : "(none)"}`);
  console.log(`  Transcript:     ${inputs.transcript ? `${inputs.transcript.length} chars` : "(none)"}`);
  console.log(`  Meetings:       ${inputs.meetings.length}`);
  console.log(`  Client notes:   ${inputs.clientNotes.length}`);
  console.log(`  Live messages:  ${inputs.liveMessages.length}`);
  console.log(`  Latest input:   ${inputs.latestInputAt ?? "(none)"}`);
  console.log(`  Cached summary: ${inputs.client.daily_coacher_summary ? "exists" : "(none)"}`);
  console.log(`  Stale?          ${isSummaryStale(inputs)}`);
  console.log(`  Gather elapsed: ${Date.now() - tStart}ms`);

  console.log(`\n=== Generating + persisting summary ===`);
  const tGen = Date.now();
  const result = await regenerateAndPersistSummary(clientId);
  const elapsed = Date.now() - tGen;

  if (!result) {
    console.error("regenerateAndPersistSummary returned null (client not found).");
    process.exit(1);
  }

  console.log(`  Generation elapsed: ${elapsed}ms`);
  console.log(`  Tokens — input: ${result.inputTokens}, output: ${result.outputTokens}`);
  console.log(`  Tokens — cache write: ${result.cacheCreationInputTokens}, cache read: ${result.cacheReadInputTokens}`);

  console.log(`\n--- Summary (${result.summary.length} chars) ---`);
  console.log(result.summary);
  console.log(`\n--- End summary ---\n`);
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exit(1);
});
