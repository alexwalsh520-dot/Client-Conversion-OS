// ─────────────────────────────────────────────────────────────────────────
// BRICK 7 RESCUE: the spoken half of a video too big to upload.
//
// Sixteen of the fleet's videos are 25-47MB, over the 24MB ceiling the
// transcription API accepts. Their PRINTED words were read fine, so the ads are
// not unknown — but one group of them carries $1,164.75 of spend, and "we know
// what it shows and not what it says" is a real gap, not a rounding error.
//
// The video is the problem; the audio is not. Stripping the audio track turns a
// 47MB file into a couple of megabytes, which uploads without complaint. That
// needs ffmpeg, which a Vercel serverless cron cannot run, so this is a LOCAL
// rescue rather than a change to the pipeline. The production path keeps failing
// these honestly (audio_status 'failed', reason written) instead of pretending.
//
// The SAME model transcribes the rescued audio as everything else in the store,
// so no ad ends up with text from a different transcriber than its neighbours.
//
// Usage: npx tsx scripts/rescue-oversized-transcripts.mts
// ─────────────────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const MIN_WORDS = 8;
const WORD_RE = /[A-Za-z0-9]+/g;

const { createClient } = await import("@supabase/supabase-js");
const { tokensFor, resolveVideoSource, TRANSCRIBE_MODEL } = await import(
  "../src/lib/ads-tracker/creative-transcript.js"
);
const { transcribeBytes } = await import("../src/lib/transcribe.js");
const { ACTIVE_CREATORS, firstEnv } = await import("../src/lib/creators.js");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const { data: rows, error } = await db
  .from("ad_creative_transcripts")
  .select("ad_id, client_key, video_id, failure_reason")
  .eq("audio_status", "failed");
if (error) throw new Error(error.message);

const targets = (rows || []).filter((r) => /over the .*MB transcription ceiling/.test(String(r.failure_reason || "")));
console.log(`${targets.length} videos have unread audio because they were too large to upload`);

const tokenCache = new Map<string, Awaited<ReturnType<typeof tokensFor>>>();
async function tokensForClient(client: string) {
  if (tokenCache.has(client)) return tokenCache.get(client)!;
  const creator = ACTIVE_CREATORS.find((c: { key: string }) => c.key === client);
  const token = creator ? firstEnv(creator.tokenEnv) : null;
  if (!token) throw new Error(`no token for ${client}`);
  const t = await tokensFor(token);
  tokenCache.set(client, t);
  return t;
}

let rescued = 0;
let stillFailed = 0;

for (const row of targets) {
  const adId = String(row.ad_id);
  const videoPath = join(tmpdir(), `brick7-${adId}.mp4`);
  const audioPath = join(tmpdir(), `brick7-${adId}.m4a`);
  try {
    const tokens = await tokensForClient(String(row.client_key));
    const src = await resolveVideoSource(String(row.video_id), tokens);

    const res = await fetch(src.url, { cache: "no-store" });
    if (!res.ok) throw new Error(`download returned ${res.status}`);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(videoPath, Buffer.from(await res.arrayBuffer()));

    // Audio only, mono, 64kbps. A three-minute ad lands around 1.5MB.
    await run("ffmpeg", ["-y", "-i", videoPath, "-vn", "-ac", "1", "-b:a", "64k", audioPath], {
      maxBuffer: 1024 * 1024 * 32,
    });
    const audio = readFileSync(audioPath);
    console.log(
      `${adId}: ${(statSync(videoPath).size / 1024 / 1024).toFixed(1)}MB video -> ${(audio.byteLength / 1024 / 1024).toFixed(2)}MB audio`,
    );

    const out = await transcribeBytes(
      audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer,
    );
    if (!out.ok || !out.text) throw new Error(`transcription failed: ${out.reason || "no text"}`);
    const text = out.text.trim();
    const words = (text.match(WORD_RE) || []).length;
    if (words < MIN_WORDS) throw new Error(`only ${words} words came back, under the ${MIN_WORDS}-word floor`);

    await db
      .from("ad_creative_transcripts")
      .update({
        transcript_text: text,
        audio_status: "ok",
        language: "en",
        // Honest about HOW this row was read: same model, but reached by
        // stripping the audio locally because the video would not upload.
        model: `${TRANSCRIBE_MODEL} (audio extracted locally: the video exceeded the upload ceiling)`,
        failure_reason: null,
        transcribed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("ad_id", adId);
    rescued += 1;
    console.log(`  rescued: ${words} spoken words`);
  } catch (err) {
    stillFailed += 1;
    console.log(`  FAILED ${adId}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    for (const p of [videoPath, audioPath]) {
      try {
        rmSync(p, { force: true });
      } catch {
        /* nothing to clean up */
      }
    }
  }
}

console.log(`rescue complete: ${rescued} rescued, ${stillFailed} still unread`);
