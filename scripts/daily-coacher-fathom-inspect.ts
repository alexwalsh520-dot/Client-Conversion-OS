#!/usr/bin/env node
/**
 * One-off: walk paginated listing to find Faith's onboarding meeting
 * and confirm whether the inline `transcript` field is populated.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });

const KEY = process.env.FATHOM_API_KEY_ONBOARDING || process.env.FATHOM_API_KEY!;
const TARGET_TOKEN = "6e2uuTVCZxNqPguYduviU5BoVme3vG-6";

interface ListResp {
  items?: Array<Record<string, unknown>>;
  next_cursor?: string;
}

(async () => {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const base = `https://api.fathom.ai/external/v1/meetings?created_after=${since}`;

  let cursor: string | undefined;
  let pageCount = 0;
  let totalMeetings = 0;
  let match: Record<string, unknown> | undefined;

  while (true) {
    pageCount++;
    const url = cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
    const res = await fetch(url, { headers: { "X-Api-Key": KEY } });
    const data: ListResp = await res.json();
    const items = data.items || [];
    totalMeetings += items.length;

    for (const m of items) {
      const shareUrl = m.share_url as string | undefined;
      if (shareUrl?.includes(TARGET_TOKEN)) {
        match = m;
        break;
      }
    }
    if (match) break;
    if (!data.next_cursor || items.length === 0) break;
    cursor = data.next_cursor;
  }

  console.log(`Walked ${pageCount} pages, ${totalMeetings} total meetings`);

  if (!match) {
    console.log("Faith's meeting NOT found in 60-day listing.");
    process.exit(1);
  }

  console.log("\n--- Faith's meeting (top-level fields) ---");
  console.log({
    title: match.title,
    url: match.url,
    share_url: match.share_url,
    recording_id: match.recording_id,
    created_at: match.created_at,
    transcript_language: match.transcript_language,
    transcript_present: match.transcript !== null && match.transcript !== undefined,
    transcript_type: Array.isArray(match.transcript)
      ? `array of ${(match.transcript as unknown[]).length}`
      : typeof match.transcript,
  });

  console.log("\n--- transcript field (full value) ---");
  console.log(JSON.stringify(match.transcript, null, 2));

  console.log("\n--- transcript field keys (if object) ---");
  if (match.transcript && typeof match.transcript === "object" && !Array.isArray(match.transcript)) {
    console.log(Object.keys(match.transcript));
  }
})();
