#!/usr/bin/env node
/**
 * Probe Fathom API endpoints to find the correct way to fetch a transcript.
 * Faith's meeting: recording_id=137261913, call_id=634002411
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });

const KEY = process.env.FATHOM_API_KEY_ONBOARDING || process.env.FATHOM_API_KEY!;
const BASE = "https://api.fathom.ai/external/v1";

const recordingId = "137261913";
const callId = "634002411";

async function probe(path: string): Promise<void> {
  console.log(`\n→ GET ${path}`);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { "X-Api-Key": KEY } });
    console.log(`  status: ${res.status} ${res.statusText}`);
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const data = await res.json();
      const preview = JSON.stringify(data).substring(0, 300);
      console.log(`  body (json): ${preview}${preview.length >= 300 ? "..." : ""}`);
    } else {
      const text = await res.text();
      console.log(`  body (${ct}, first 150 chars): ${text.substring(0, 150).replace(/\s+/g, " ")}`);
    }
  } catch (err) {
    console.log(`  ERROR:`, err);
  }
}

(async () => {
  // Different paths and IDs to try
  await probe(`/meetings/${recordingId}/transcript`);
  await probe(`/meetings/${callId}/transcript`);
  await probe(`/recordings/${recordingId}/transcript`);
  await probe(`/recordings/${callId}/transcript`);
  await probe(`/recordings/${recordingId}`);
  await probe(`/meetings/${recordingId}`);
  // Maybe an include param?
  await probe(`/meetings?recording_id=${recordingId}&include_transcript=true`);
  await probe(`/meetings?include=transcript&created_after=2026-04-12T00:00:00Z&created_before=2026-04-13T00:00:00Z`);
})();
