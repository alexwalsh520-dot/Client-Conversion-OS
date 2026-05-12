#!/usr/bin/env node
/**
 * Daily Coacher — draft generation smoke test.
 *
 * Calls generateTopicDraft directly (bypassing the API route) so we can
 * verify the topic-generator end-to-end without needing an auth session.
 *
 * Usage:
 *   npx tsx scripts/daily-coacher-draft-smoke.ts <clientId> <topicKey>
 *
 * Example:
 *   npx tsx scripts/daily-coacher-draft-smoke.ts 31362 nutrition
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local"), override: true });

import {
  generateTopicDraft,
  TopicNotReadyError,
} from "../src/lib/daily-coacher/topic-generator";
import { TOPICS, type TopicKey } from "../src/lib/daily-coacher/topics";

async function main(): Promise<void> {
  const clientArg = process.argv[2];
  const topicArg = process.argv[3];
  if (!clientArg || !topicArg) {
    console.error("Usage: npx tsx scripts/daily-coacher-draft-smoke.ts <clientId> <topicKey>");
    process.exit(1);
  }
  const clientId = Number(clientArg);
  if (!Number.isFinite(clientId)) {
    console.error(`Invalid clientId: ${clientArg}`);
    process.exit(1);
  }
  if (!TOPICS.some((t) => t.key === topicArg)) {
    console.error(`Invalid topicKey: ${topicArg}`);
    console.error("Valid topics:", TOPICS.map((t) => t.key).join(", "));
    process.exit(1);
  }
  const topic = topicArg as TopicKey;

  console.log(`\n=== Generating ${topic} draft for client ${clientId} ===\n`);
  const tStart = Date.now();
  try {
    const result = await generateTopicDraft(clientId, topic);
    const elapsed = Date.now() - tStart;

    console.log(`Generated in ${elapsed}ms`);
    console.log(`Tokens: input=${result.inputTokens}, output=${result.outputTokens}`);
    console.log(`Cache: write=${result.cacheCreationInputTokens}, read=${result.cacheReadInputTokens}`);

    console.log(`\n--- Tips used ---`);
    result.tipsUsed.forEach((t, i) => {
      console.log(`  ${i + 1}. [tip ${t.id}] ${t.tip_text}`);
    });

    console.log(`\n--- Generated draft (${result.draft.length} chars) ---`);
    console.log(result.draft);
    console.log(`--- End draft ---`);

    // Em-dash audit
    const emDashCount = (result.draft.match(/—/g) || []).length;
    const enDashCount = (result.draft.match(/–/g) || []).length;
    if (emDashCount + enDashCount > 0) {
      console.error(
        `\n⚠️  WARNING: ${emDashCount} em-dashes and ${enDashCount} en-dashes in draft. stripDashes() should have caught these.`
      );
      process.exit(1);
    } else {
      console.log(`\n✓ Em-dash check: clean (0 em-dashes, 0 en-dashes)`);
    }
  } catch (err) {
    if (err instanceof TopicNotReadyError) {
      console.error(`\nTopic not ready: ${err.message}`);
      process.exit(2);
    }
    console.error("\nError:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
