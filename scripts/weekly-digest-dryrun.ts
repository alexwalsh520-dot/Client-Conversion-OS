#!/usr/bin/env node
/**
 * Dry run of the Sunday weekly check-in + meetings report.
 *
 * Gathers the real data, generates the real Claude summary, and renders
 * the real Slack blocks, then prints everything to stdout. It NEVER
 * opens a Slack DM and never sends anything, so it is safe to run any
 * time against production data.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/weekly-digest-dryrun.ts
 *   npx tsx --env-file=.env.local scripts/weekly-digest-dryrun.ts --no-ai
 *   npx tsx --env-file=.env.local scripts/weekly-digest-dryrun.ts --at=2026-08-16T11:00:00Z
 *
 * --no-ai skips the Claude call (no token spend) and stubs the summary,
 * which is enough to eyeball the structured sections.
 *
 * --at=<ISO> pretends the cron fired at that instant, so you can replay a
 * past Sunday 4 PM PKT (11:00 UTC) and see a full week of data instead of
 * whatever slice of the current week has accumulated so far.
 */

import {
  gatherDigestData,
  generateSummaryWithClaude,
  buildDigestSlackBlocks,
} from "../src/lib/check-in/weekly-digest";

const skipAi = process.argv.includes("--no-ai");

function renderBlocks(blocks: Array<Record<string, unknown>>): string {
  return blocks
    .map((b) => {
      const type = b.type as string;
      if (type === "divider") return "-".repeat(60);
      if (type === "header") {
        return `\n### ${(b.text as { text: string }).text}`;
      }
      if (type === "context") {
        return (b.elements as Array<{ text: string }>)
          .map((e) => e.text)
          .join(" ");
      }
      if (type === "actions") return "[button: Open Client Progress]";
      const fields = b.fields as Array<{ text: string }> | undefined;
      if (fields) return fields.map((f) => f.text).join("   |   ");
      return (b.text as { text: string } | undefined)?.text ?? `(${type})`;
    })
    .join("\n\n");
}

function resolveNow(): Date {
  const flag = process.argv.find((a) => a.startsWith("--at="));
  if (!flag) return new Date();
  const at = new Date(flag.slice("--at=".length));
  if (Number.isNaN(at.getTime())) {
    throw new Error(`--at is not a valid date: ${flag}`);
  }
  return at;
}

async function main(): Promise<void> {
  const now = resolveNow();
  console.log(`Dry run at ${now.toISOString()} (no Slack send)\n`);

  const digest = await gatherDigestData(now);

  console.log("=== GATHERED ===");
  console.log(`week start (UTC):     ${digest.weekStartPkt.toISOString()}`);
  console.log(`week end (UTC):       ${digest.weekEndPkt.toISOString()}`);
  console.log(`check-in submissions: ${digest.submissions.length}`);
  console.log(`meetings logged:      ${digest.meetings.total}`);
  console.log(`meetings window:      ${digest.meetings.startDate}..${digest.meetings.endDate}`);
  console.log(`meetings per coach:   ${JSON.stringify(digest.meetings.perCoach)}`);
  console.log(`attention needed:     ${digest.attentionClients.length}`);
  console.log(`missing check-ins:    ${digest.totalMissingClients}/${digest.totalActiveClientsWithDaysLeft}`);

  const summary = skipAi
    ? "(--no-ai: summary generation skipped)"
    : await generateSummaryWithClaude(digest);

  const blocks = buildDigestSlackBlocks(digest, summary);

  console.log(`\n=== RENDERED SLACK MESSAGE (${blocks.length} blocks) ===`);
  console.log(renderBlocks(blocks));

  // Guardrails worth failing loudly on.
  const rendered = JSON.stringify(blocks);
  const problems: string[] = [];
  if (rendered.includes("Farrukh")) {
    problems.push("'Farrukh' leaked into the rendered report (should read 'Mark')");
  }
  // Only the Claude-written summary is held to the no-dash rule. The
  // structured sections below it use "—" as a deliberate layout
  // separator and always have.
  if (/[—–]/.test(summary)) {
    problems.push("an em-dash or en-dash survived into the Claude summary");
  }
  if (blocks.length > 50) {
    problems.push(`${blocks.length} blocks exceeds Slack's 50-block limit`);
  }

  console.log("\n=== CHECKS ===");
  if (problems.length === 0) {
    console.log("all clear: no 'Farrukh', no em-dashes, block count within limit");
  } else {
    for (const p of problems) console.log(`FAIL: ${p}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
