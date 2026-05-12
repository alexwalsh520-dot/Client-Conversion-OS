#!/usr/bin/env node
/**
 * Daily Coacher — Fathom debug probe.
 *
 * Lists meetings from Fathom with a wide date window and prints the
 * shape of share_url / url fields so we can see how they compare to
 * what coaches paste into onboarding_fathom_link. Also searches for
 * a specific share token across all returned meetings.
 *
 * Usage:
 *   npx tsx scripts/daily-coacher-fathom-debug.ts <shareToken>
 *
 * Example:
 *   npx tsx scripts/daily-coacher-fathom-debug.ts 6e2uuTVCZxNqPguYduviU5BoVme3vG-6
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

import { listMeetings } from "../src/lib/fathom";

async function main(): Promise<void> {
  const target = process.argv[2];

  console.log("\nFetching meetings from the last 90 days...");
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const start = Date.now();
  const meetings = await listMeetings({ createdAfter: ninetyDaysAgo });
  const elapsed = Date.now() - start;

  console.log(`Got ${meetings.length} meetings in ${elapsed}ms\n`);

  if (meetings.length === 0) {
    console.log("No meetings returned. Check FATHOM_API_KEY scope.");
    return;
  }

  console.log("--- First 3 meetings (full shape) ---");
  for (const m of meetings.slice(0, 3)) {
    console.log({
      id: m.id,
      title: m.title || m.meeting_title,
      url: m.url,
      share_url: m.share_url,
      created_at: m.created_at,
      attendees: m.calendar_invitees?.map((a) => a.email).slice(0, 3),
    });
  }

  console.log("\n--- All distinct URL shapes ---");
  const urlShapes = new Set<string>();
  const shareShapes = new Set<string>();
  for (const m of meetings) {
    if (m.url) urlShapes.add(m.url.replace(/[\w\-]{8,}/, "{TOKEN}"));
    if (m.share_url) shareShapes.add(m.share_url.replace(/[\w\-]{8,}/, "{TOKEN}"));
  }
  console.log("  url shapes:      ", Array.from(urlShapes));
  console.log("  share_url shapes:", Array.from(shareShapes));

  if (target) {
    console.log(`\n--- Searching for token "${target}" ---`);
    const matches = meetings.filter(
      (m) =>
        m.url?.includes(target) ||
        m.share_url?.includes(target) ||
        m.id === target
    );
    console.log(`Found ${matches.length} match(es)`);
    matches.forEach((m) => {
      console.log({
        id: m.id,
        title: m.title || m.meeting_title,
        url: m.url,
        share_url: m.share_url,
        created_at: m.created_at,
      });
    });
  }

  console.log("\n--- Date range of returned meetings ---");
  const dates = meetings
    .map((m) => m.created_at)
    .filter(Boolean)
    .sort();
  console.log(`  oldest: ${dates[0]}`);
  console.log(`  newest: ${dates[dates.length - 1]}`);
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exit(1);
});
