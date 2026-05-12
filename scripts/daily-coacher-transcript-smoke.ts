#!/usr/bin/env node
/**
 * Daily Coacher — onboarding transcript fetcher smoke test.
 *
 * Verifies that getOnboardingTranscript() can resolve a Fathom share URL
 * to transcript text for a real client. Useful for confirming the URL
 * parser + resolver work against actual data.
 *
 * Usage:
 *   npx tsx scripts/daily-coacher-transcript-smoke.ts <clientId>
 *
 * Requirements:
 *   - FATHOM_API_KEY in .env.local (or env)
 *   - SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local
 *
 * Hits the live Fathom API and writes to the cache columns on the client
 * row if a transcript is successfully resolved. Safe to re-run — the
 * second run should hit the cache and skip the Fathom call.
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local before importing modules that read env vars.
config({ path: resolve(__dirname, "../.env.local"), override: true });

import { getOnboardingTranscript } from "../src/lib/daily-coacher/transcript";
import { getServiceSupabase } from "../src/lib/supabase";

async function main(): Promise<void> {
  const clientIdArg = process.argv[2];
  if (!clientIdArg) {
    console.error("Usage: npx tsx scripts/daily-coacher-transcript-smoke.ts <clientId>");
    console.error("Example: npx tsx scripts/daily-coacher-transcript-smoke.ts 31362");
    process.exit(1);
  }

  const clientId = Number(clientIdArg);
  if (!Number.isFinite(clientId)) {
    console.error(`Invalid clientId: ${clientIdArg}`);
    process.exit(1);
  }

  const supabase = getServiceSupabase();
  const { data: client, error } = await supabase
    .from("clients")
    .select(
      "id, name, onboarding_fathom_link, onboarding_date, onboarding_transcript_cached, onboarding_fathom_link_fetched_for"
    )
    .eq("id", clientId)
    .single();

  if (error || !client) {
    console.error(`Failed to load client ${clientId}:`, error?.message);
    process.exit(1);
  }

  console.log(`\n=== Client ${client.id}: ${client.name} ===`);
  console.log(`  Onboarding Fathom Link: ${client.onboarding_fathom_link || "(none)"}`);
  console.log(`  Onboarding Date:        ${client.onboarding_date || "(none)"}`);
  console.log(
    `  Cache state:            ${
      client.onboarding_transcript_cached
        ? `cached (${(client.onboarding_transcript_cached as string).length} chars), fetched_for=${client.onboarding_fathom_link_fetched_for}`
        : "empty"
    }\n`
  );

  if (!client.onboarding_fathom_link) {
    console.log("No onboarding Fathom link set — nothing to fetch. Exiting.");
    process.exit(0);
  }

  console.log("Calling getOnboardingTranscript()...\n");
  const start = Date.now();
  const transcript = await getOnboardingTranscript({
    id: client.id,
    onboardingFathomLink: client.onboarding_fathom_link,
    onboardingDate: client.onboarding_date,
  });
  const elapsed = Date.now() - start;

  console.log(`Returned in ${elapsed}ms.\n`);

  if (transcript === null) {
    console.log("Result: null (no transcript available)");
    console.log(
      "  - Could be: bad URL, Fathom hasn't processed the recording yet, or API unreachable."
    );
    console.log("  - Cache columns NOT updated — next run will retry.");
    process.exit(0);
  }

  console.log(`Result: transcript text (${transcript.length} chars)`);
  console.log("--- First 500 chars ---");
  console.log(transcript.substring(0, 500));
  console.log("--- ... ---");
  console.log(transcript.substring(Math.max(0, transcript.length - 200)));
  console.log("\nCache columns updated. Re-running this script should be a cache hit.");
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exit(1);
});
