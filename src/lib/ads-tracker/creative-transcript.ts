// ─────────────────────────────────────────────────────────────────────────
// BRICK 7, PART A: VIDEO TRANSCRIPT CAPTURE.
//
// "What does this ad actually say" was true for stills and false for videos.
// The OCR path reads the words printed on a still image and deliberately bails
// out on anything that is not a real image, because forcing a video through it
// makes the model invent plausible copy that appears nowhere in the account.
// That bail-out was right and it left a hole: the video's own words.
//
// This closes it. For every ad whose creative is a video we resolve the video's
// playable rendition, download it, transcribe the SPOKEN AUDIO, and store the
// text in ad_creative_transcripts under its own label. The caption stays in
// ad_creative_copy.primary_text where it has always been. Nothing is conflated,
// per the 1 July law.
//
// ── A VIDEO AD'S WORDS ARE NOT ONLY ITS AUDIO ───────────────────────────
// The first real ad this was pointed at proved it. Tyson's LOADED, the 6x
// winner paused on 24 July, is SILENT b-roll: Groq answered "no audio track
// found in file". Its copy ("I'm looking for 5 servicemen stuck at the same
// body for 6-18 months...") is printed on the frames. Reading only the audio
// would have filed the single most valuable ad on the bench as a failure.
//
// So both halves are captured, separately labelled and separately graded:
//   • the SPOKEN words, from the video's audio;
//   • the PRINTED words, OCR'd from frames sampled across the WHOLE video
//     through Meta's own thumbnails edge. Not the cover thumbnail — that one
//     frame is usually blank, which is precisely why video ads read as
//     wordless before this brick.
// A row is 'ok' when either half is known, because either one answers "what
// does this ad say". Silence is recorded as silence, not as a failure to read.
//
// ── HOW THE VIDEO IS ACTUALLY REACHED, which cost a day to find ──────────
// GET /{video_id}?fields=source with the creator's USER token returns the video
// with the source field SILENTLY ABSENT. Not an error, not a permission
// message: the id comes back and the field is simply gone. That is why every
// one of the 215 video ads in ad_creative_image carries media_status
// 'no_source' — the media sync asked the only way it knew and believed the
// answer. The same call with a PAGE token, obtained from /me/accounts with the
// same user token, returns the source. So the resolver tries the page token
// first and keeps the user token as a fallback rather than trusting either one.
//
// ── ISOLATION (warehouse hard law 14) ───────────────────────────────────
// Every step has its own timeout and every ad is processed independently. One
// video that hangs on download, or that Meta will not resolve, costs exactly
// itself: it gets a failed row with the reason written down and the run
// continues. A video that cannot be transcribed is COUNTED, never skipped
// silently, because an invisible failure reads as coverage.
// ─────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import { getServiceSupabase } from "@/lib/supabase";
import { transcribeBytes, transcriberConfigured } from "@/lib/transcribe";
import { logAiUsage } from "@/lib/ai-usage";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION?.trim() || "v24.0"}`;

/** Per-step wall-clock budgets. A step that overruns is abandoned, never left
 *  to block the ad behind it. */
const RESOLVE_TIMEOUT_MS = 15_000;
// 90s, not 45s. The first backfill pass timed out on Jake's two biggest videos
// at 45s, and one of them is a $1,882 ad: a download budget that quietly fails
// the highest-spend creatives is worse than a slower run. The real ceiling is
// the per-run budget the caller sets, which is checked between ads.
const DOWNLOAD_TIMEOUT_MS = 90_000;
const TRANSCRIBE_TIMEOUT_MS = 90_000;

/** Groq's upload ceiling. Bigger than this is refused BEFORE the upload rather
 *  than discovered as an opaque API error. */
export const MAX_VIDEO_BYTES = 24 * 1024 * 1024;

/** After this many failed attempts an ad stops being re-queued. Its row stays,
 *  and stays failed, so it keeps being counted against coverage. */
export const MAX_ATTEMPTS = 3;

/** Whisper hallucinates canned filler ("Thanks for watching.") over silent or
 *  music-only video. Below this word count the text is not treated as the ad's
 *  words; the row records what it found and says the video carried no speech. */
const MIN_WORDS = 8;

const WORD_RE = /[A-Za-z0-9]+/g;
function wordCount(t: string): number {
  return (t.match(WORD_RE) || []).length;
}

/**
 * WHISPER ECHOES ITS OWN PROMPT BACK ON SILENT AUDIO. Four of Tyson's video ads
 * came back with the transcript "Spoken words only." — a fragment of the
 * anti-hallucination prompt src/lib/transcribe.ts sends ("Instagram fitness
 * reel. Spoken words only."). Stored unchecked, four ads would have carried
 * that sentence as their copy.
 *
 * The word floor caught all four. This guard is the belt to that pair of
 * braces: a longer prompt would echo back longer, clear the floor, and read as
 * real speech. An echo is never the ad's words, at any length.
 */
const PROMPT_ECHOES = ["instagram fitness reel", "spoken words only"];

function isPromptEcho(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  return PROMPT_ECHOES.some((e) => t === e || t.replace(e, "").trim() === "");
}

/** Abandon a step that overruns its budget. The label goes into the stored
 *  failure reason, so "which step gave up" is never a guess. */
async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} ran past its ${Math.round(ms / 1000)}s budget`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function graphJson(url: string, timeoutMs: number, label: string): Promise<Record<string, unknown>> {
  const res = await withTimeout(fetch(url, { cache: "no-store" }), timeoutMs, label);
  if (!res.ok) throw new Error(`${label} returned ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────
// PAGE TOKENS. Fetched once per creator per run and held in memory only.
// Never logged, never stored, never returned to a caller.
// ─────────────────────────────────────────────────────────────────────────

export interface TokenSet {
  /** The creator's user token. */
  user: string;
  /** Page tokens belonging to that user, best-first. Empty is normal and not
   *  an error; the resolver simply falls back to the user token. */
  pages: string[];
}

export async function tokensFor(userToken: string): Promise<TokenSet> {
  const set: TokenSet = { user: userToken, pages: [] };
  try {
    const json = await graphJson(
      `${GRAPH}/me/accounts?fields=access_token&limit=25&access_token=${encodeURIComponent(userToken)}`,
      RESOLVE_TIMEOUT_MS,
      "page token lookup",
    );
    for (const p of (json.data as Array<{ access_token?: string }>) || []) {
      if (p?.access_token) set.pages.push(p.access_token);
    }
  } catch {
    // No page tokens is a degraded resolver, not a broken one. The user token
    // still resolves some videos, and the ones it cannot get an honest failed
    // row naming the reason.
  }
  return set;
}

export interface VideoSource {
  url: string;
  durationS: number | null;
  /** Which token unlocked it. Recorded because "the user token cannot see
   *  source" is the whole finding behind this file. */
  via: "page_token" | "user_token";
}

/**
 * The playable rendition for one video id. Page token first, user token second.
 * Throws with a plain reason when neither returns a source, so the caller can
 * write that reason onto the row.
 */
export async function resolveVideoSource(videoId: string, tokens: TokenSet): Promise<VideoSource> {
  const attempts: Array<{ token: string; via: VideoSource["via"] }> = [
    ...tokens.pages.map((t) => ({ token: t, via: "page_token" as const })),
    { token: tokens.user, via: "user_token" as const },
  ];
  let lastError = "no token returned a source field";
  for (const a of attempts) {
    try {
      const json = await graphJson(
        `${GRAPH}/${videoId}?fields=source,length&access_token=${encodeURIComponent(a.token)}`,
        RESOLVE_TIMEOUT_MS,
        "video source lookup",
      );
      const url = typeof json.source === "string" ? json.source : "";
      if (!url) {
        // The id came back without the field. This is Meta's actual behaviour
        // for a token that may not read the rendition, and it is why we try
        // more than one token before believing there is no video.
        lastError = "Meta returned the video with no source field for this token";
        continue;
      }
      const len = Number(json.length);
      return { url, durationS: Number.isFinite(len) ? len : null, via: a.via };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError);
}

/** Download with a hard size cap, so one oversized file can never blow memory
 *  or be discovered as an opaque upload error later. */
async function downloadVideo(url: string): Promise<ArrayBuffer> {
  const res = await withTimeout(fetch(url, { cache: "no-store" }), DOWNLOAD_TIMEOUT_MS, "video download");
  if (!res.ok) throw new Error(`video download returned ${res.status}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > MAX_VIDEO_BYTES) {
    throw new Error(`video is ${Math.round(declared / 1024 / 1024)}MB, over the ${MAX_VIDEO_BYTES / 1024 / 1024}MB transcription ceiling`);
  }
  const bytes = await withTimeout(res.arrayBuffer(), DOWNLOAD_TIMEOUT_MS, "video download body");
  if (!bytes.byteLength) throw new Error("video download returned an empty file");
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    throw new Error(`video is ${Math.round(bytes.byteLength / 1024 / 1024)}MB, over the ${MAX_VIDEO_BYTES / 1024 / 1024}MB transcription ceiling`);
  }
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────
// THE PRINTED HALF: the words ON the video.
//
// Meta's thumbnails edge returns full-resolution frames sampled across the
// whole video (nineteen of them for a seventeen-second ad). Those are read in
// ONE vision call, in time order, so a line that persists across frames is
// written once and the reading order matches the ad's own order.
//
// The transcriber prompt is deliberately the same shape as the still-image OCR
// in creative-copy.ts, and for the same reason: a vision model asked loosely
// about an ad will compose plausible marketing copy that appears NOWHERE in the
// account. Everything here pushes the other way — transcribe only, never
// describe, an empty answer always beats a guess, and a low-confidence read is
// dropped to empty rather than stored.
// ─────────────────────────────────────────────────────────────────────────

export const ON_SCREEN_MODEL = "claude-sonnet-4-6";

/** How many frames are read per video. Six across the full length catches a
 *  hook, its body lines and the call to action without paying for near-
 *  duplicate frames. */
const FRAMES_SAMPLED = 6;
const MAX_FRAME_BYTES = 5 * 1024 * 1024;

const ON_SCREEN_SYSTEM = `You are an OCR transcriber. You are given FRAMES sampled in time order from ONE video advertisement. You copy out the words PRINTED on those frames, character for character. You are not a copywriter and you never compose, guess, paraphrase, complete or describe.

ABSOLUTE RULES — breaking these makes the data worthless:
- Transcribe ONLY words you can actually SEE rendered on a frame, verbatim, including odd capitalisation and punctuation.
- The frames are from ONE ad in time order. A line that appears on several frames is written ONCE, at the point it first appears.
- If the frames carry no printed words at all (a plain filmed shot, a logo, a blank frame), return has_text:false and an empty string. An empty answer is ALWAYS better than a guess.
- NEVER invent or fill in generic marketing copy. Phrases like "Unlock your potential", "Transform your life", "Limited time offer" are FORBIDDEN unless those exact words are visibly printed. If you find yourself producing a slogan you are not certain you can see, stop and return has_text:false.
- Do not describe the video, the person, the setting or what the ad is "about". Only literal visible text.

Return ONLY valid JSON, no markdown:
{
  "on_screen_text": "<every distinct printed line, in the order it appears, joined with ' / '. empty string if none>",
  "has_text": <true ONLY if you can clearly read printed text, false otherwise>,
  "confidence": <0-100: how sure you are every transcribed word is genuinely printed. Use a LOW number if you are guessing>
}`;

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

/** Frame URIs for one video, sampled evenly across everything Meta offers. */
export async function frameUrisFor(videoId: string, tokens: TokenSet): Promise<string[]> {
  const attempts = [...tokens.pages, tokens.user];
  let lastError = "no token returned frames";
  for (const token of attempts) {
    try {
      const json = await graphJson(
        `${GRAPH}/${videoId}/thumbnails?access_token=${encodeURIComponent(token)}`,
        RESOLVE_TIMEOUT_MS,
        "video frame lookup",
      );
      const all = ((json.data as Array<{ uri?: string }>) || []).map((t) => t?.uri).filter((u): u is string => !!u);
      if (!all.length) {
        lastError = "Meta returned no frames for this video";
        continue;
      }
      if (all.length <= FRAMES_SAMPLED) return all;
      const step = all.length / FRAMES_SAMPLED;
      const picked: string[] = [];
      for (let i = 0; i < FRAMES_SAMPLED; i++) picked.push(all[Math.min(all.length - 1, Math.floor(i * step))]);
      return picked;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError);
}

export interface OnScreenRead {
  text: string;
  framesRead: number;
}

/** Read the printed words off a video's frames. Throws only when the frames
 *  could not be fetched or the model could not be reached; a genuine "this
 *  video has no printed words" comes back as an empty string. */
export async function readOnScreenText(videoId: string, tokens: TokenSet): Promise<OnScreenRead> {
  const uris = await frameUrisFor(videoId, tokens);

  const images: Anthropic.ImageBlockParam[] = [];
  for (const uri of uris) {
    try {
      const res = await withTimeout(fetch(uri, { cache: "no-store" }), DOWNLOAD_TIMEOUT_MS, "frame download");
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.byteLength || buf.byteLength > MAX_FRAME_BYTES) continue;
      images.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") },
      });
    } catch {
      // One unreachable frame is not a failed read. The others still carry the
      // ad's words, and how many were actually read is recorded on the row.
    }
  }
  if (!images.length) throw new Error("none of the video's frames could be downloaded");

  const response = await withTimeout(
    anthropic().messages.create({
      model: ON_SCREEN_MODEL,
      max_tokens: 900,
      system: ON_SCREEN_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...images,
            { type: "text", text: "These are frames from one video ad, in time order. Transcribe the printed on-screen text. Return JSON only." },
          ],
        },
      ],
    }),
    TRANSCRIBE_TIMEOUT_MS,
    "on-screen text read",
  );

  logAiUsage({ feature: "ads-creative-on-screen", model: ON_SCREEN_MODEL, usage: response.usage });

  const textContent = response.content.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") return { text: "", framesRead: images.length };

  let jsonStr = textContent.text.trim();
  if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(jsonStr) as { on_screen_text?: string; has_text?: boolean; confidence?: number };
    if (parsed?.has_text === false) return { text: "", framesRead: images.length };
    const confidence = Number(parsed?.confidence);
    // A shaky read is dropped to empty rather than stored as the ad's words.
    if (Number.isFinite(confidence) && confidence < 70) return { text: "", framesRead: images.length };
    return { text: String(parsed?.on_screen_text || "").trim(), framesRead: images.length };
  } catch {
    // A non-JSON reply means the model wandered off the format. Its free text is
    // never trusted as real ad copy.
    return { text: "", framesRead: images.length };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// THE PIPELINE, one ad at a time.
// ─────────────────────────────────────────────────────────────────────────

export interface TranscribeAdInput {
  adId: string;
  videoId: string;
  clientKey: string;
  tokens: TokenSet;
}

export interface TranscribeAdResult {
  adId: string;
  /** ok when EITHER half is known. Either one answers "what does this ad say". */
  status: "ok" | "failed";
  audioStatus: "ok" | "no_audio" | "failed";
  onScreenStatus: "ok" | "no_text" | "failed";
  /** Spoken words stored. Zero for a silent ad, which is a fact, not a gap. */
  words: number;
  onScreenWords: number;
  reason: string | null;
  via: VideoSource["via"] | null;
}

/** The transcriber, named once. Whisper large-v3, served by Groq: the same
 *  model family the ad-library research skill proved locally with
 *  faster-whisper, at the size the repo already runs for reel audio, and the
 *  only one of the two that a serverless cron can actually call. */
export const TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL?.trim() || "whisper-large-v3";

/**
 * Read ONE ad's video, both halves, and store the result. Never throws: every
 * outcome, including every failure, becomes a stored row. That is the honest
 * failure surface — a video we could not read is a counted gap, not an absence.
 *
 * The two halves are attempted INDEPENDENTLY. A video with no audio track still
 * gets its printed words read; frames that cannot be fetched do not cost the
 * spoken words. Whichever half succeeds, the ad's words are known and the row
 * says which half they came from.
 */
export async function transcribeOneAd(input: TranscribeAdInput): Promise<TranscribeAdResult> {
  const db = getServiceSupabase();
  const { adId, videoId, clientKey } = input;

  const { data: existing } = await db
    .from("ad_creative_transcripts")
    .select("attempts")
    .eq("ad_id", adId)
    .maybeSingle();
  const attempts = Number((existing as { attempts?: number } | null)?.attempts ?? 0) + 1;

  // ── The SPOKEN half ────────────────────────────────────────────────────
  let audioStatus: TranscribeAdResult["audioStatus"] = "failed";
  let audioReason: string | null = null;
  let spoken = "";
  let durationS: number | null = null;
  let via: VideoSource["via"] | null = null;

  if (!transcriberConfigured()) {
    audioReason = "no transcription key configured (GROQ_API_KEY), so the audio was not attempted";
  } else {
    try {
      const src = await resolveVideoSource(videoId, input.tokens);
      via = src.via;
      durationS = src.durationS;
      const bytes = await downloadVideo(src.url);
      const out = await withTimeout(transcribeBytes(bytes), TRANSCRIBE_TIMEOUT_MS, "transcription");
      if (!out.ok || !out.text) {
        const reason = out.reason || "no text returned";
        // "no audio track" is a FACT ABOUT THE AD, not a failure to read it.
        // Tyson's LOADED is exactly this: silent b-roll whose words are all
        // printed on the frames. Grading it as a failure would bury the single
        // most valuable ad on the bench under a false error.
        if (/no audio track/i.test(reason)) {
          audioStatus = "no_audio";
          audioReason = "the video has no audio track: this ad says nothing out loud";
        } else {
          audioReason = `transcription failed: ${reason}`;
        }
      } else {
        const text = out.text.trim();
        if (isPromptEcho(text)) {
          spoken = text;
          audioStatus = "no_audio";
          audioReason = `the transcriber echoed its own prompt back ("${text}"), which it does on silent audio. Never stored as the ad's words.`;
        } else if (wordCount(text) < MIN_WORDS) {
          // Whisper hallucinates canned filler over silence. Under the floor the
          // text is kept for inspection but never graded as the ad's words.
          spoken = text;
          audioStatus = "no_audio";
          audioReason = `only ${wordCount(text)} words came back, under the ${MIN_WORDS}-word speech floor. Treated as no usable speech rather than as the ad's copy.`;
        } else {
          spoken = text;
          audioStatus = "ok";
        }
      }
    } catch (err) {
      audioReason = err instanceof Error ? err.message : String(err);
    }
  }

  // ── The PRINTED half ───────────────────────────────────────────────────
  let onScreenStatus: TranscribeAdResult["onScreenStatus"] = "failed";
  let onScreenReason: string | null = null;
  let printed = "";
  let framesRead = 0;
  try {
    const read = await readOnScreenText(videoId, input.tokens);
    framesRead = read.framesRead;
    printed = read.text;
    if (printed) {
      onScreenStatus = "ok";
    } else {
      onScreenStatus = "no_text";
      onScreenReason = `${read.framesRead} frames were read and carried no printed words`;
    }
  } catch (err) {
    onScreenReason = `on-screen text could not be read: ${err instanceof Error ? err.message : String(err)}`;
  }

  const known = audioStatus === "ok" || onScreenStatus === "ok";
  const reason = [audioReason, onScreenReason].filter(Boolean).join(" | ") || null;

  await db.from("ad_creative_transcripts").upsert(
    {
      ad_id: adId,
      client_key: clientKey,
      video_id: videoId,
      source: "meta_video",
      transcript_text: spoken || null,
      on_screen_text: printed || null,
      frames_read: framesRead || null,
      duration_s: durationS,
      language: audioStatus === "ok" ? "en" : null,
      transcribed_at: new Date().toISOString(),
      model: TRANSCRIBE_MODEL,
      on_screen_model: ON_SCREEN_MODEL,
      audio_status: audioStatus,
      on_screen_status: onScreenStatus,
      status: known ? "ok" : "failed",
      // The reason is kept even on an 'ok' row. "We know this ad's words, and
      // here is the half we could not get" is a more useful truth than either
      // half of it alone.
      failure_reason: reason ? reason.slice(0, 600) : null,
      attempts,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "ad_id" },
  );

  return {
    adId,
    status: known ? "ok" : "failed",
    audioStatus,
    onScreenStatus,
    words: wordCount(spoken),
    onScreenWords: wordCount(printed),
    reason,
    via,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE WORK LIST.
// ─────────────────────────────────────────────────────────────────────────

export interface VideoAdRow {
  ad_id: string;
  video_id: string;
  client_key: string;
}

/**
 * Video ads for one creator that still need a transcript: never attempted, or
 * failed with attempts left. PAUSED ADS ARE INCLUDED ON PURPOSE — the bench is
 * where LOADED and STRENGTH wait, and a paused winner's words are the most
 * valuable thing on it.
 */
export async function findVideoAdsNeedingTranscript(clientKey: string, limit = 500): Promise<VideoAdRow[]> {
  const db = getServiceSupabase();
  const { data: videos, error } = await db
    .from("ad_creative_image")
    .select("ad_id, video_id, client_key")
    .eq("client_key", clientKey)
    .eq("is_video", true)
    .not("video_id", "is", null);
  if (error) throw new Error(`could not list video ads: ${error.message}`);

  const rows = ((videos || []) as VideoAdRow[]).filter((r) => r.ad_id && r.video_id);
  if (!rows.length) return [];

  const done = new Set<string>();
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => r.ad_id);
    const { data } = await db
      .from("ad_creative_transcripts")
      .select("ad_id, status, attempts, audio_status, on_screen_status")
      .in("ad_id", chunk);
    for (const r of (data || []) as Array<{
      ad_id: string;
      status: string;
      attempts: number;
      audio_status: string | null;
      on_screen_status: string | null;
    }>) {
      if (Number(r.attempts) >= MAX_ATTEMPTS) {
        done.add(r.ad_id);
        continue;
      }
      // A HALF-READ AD IS NOT A FINISHED AD. Nineteen of Jake's videos came out
      // of the first backfill with their printed words captured and their spoken
      // words lost to a download timeout: status 'ok', and a real gap. Judging
      // this list on the row's overall status would have left those nineteen
      // half-known forever, which is exactly the kind of quiet incompleteness
      // this brick exists to stop.
      //
      // 'no_audio' and 'no_text' are FINISHED — they are facts about the ad.
      // Only 'failed' is unfinished.
      const halfFailed = r.audio_status === "failed" || r.on_screen_status === "failed";
      if (r.status === "ok" && !halfFailed) done.add(r.ad_id);
    }
  }
  return rows.filter((r) => !done.has(r.ad_id)).slice(0, limit);
}

export interface TranscriptRunResult {
  attempted: number;
  ok: number;
  failed: number;
  /** Rows that ARE known but where one of the two halves could not be read.
   *  Surfaced separately so a partial read never hides inside a green count. */
  partial: number;
  remaining: number;
  perCreator: Record<string, { attempted: number; ok: number; failed: number; left: number }>;
  failures: Array<{ ad_id: string; client: string; reason: string }>;
  note: string;
}

/**
 * One bounded pass of the transcript pipeline. Called by the EXISTING two-hourly
 * creative cron (no new cron was added), and by the backfill script.
 *
 * Bounded by construction: a per-run ad cap and a wall-clock budget, both
 * checked between ads, so the run always ends inside the caller's ceiling. Ads
 * are processed with a small concurrency and settled independently, so one bad
 * video costs itself and nothing else.
 */
export async function runTranscriptPass(opts: {
  creators: ReadonlyArray<{ key: string; token: string }>;
  perRun?: number;
  budgetMs?: number;
  concurrency?: number;
}): Promise<TranscriptRunResult> {
  const perRun = opts.perRun ?? 12;
  const budgetMs = opts.budgetMs ?? 240_000;
  const concurrency = opts.concurrency ?? 3;
  const started = Date.now();

  const result: TranscriptRunResult = {
    attempted: 0,
    ok: 0,
    failed: 0,
    partial: 0,
    remaining: 0,
    perCreator: {},
    failures: [],
    note: "",
  };

  for (const creator of opts.creators) {
    const todo = await findVideoAdsNeedingTranscript(creator.key);
    const budgetLeft = Math.max(0, perRun - result.attempted);
    const batch = todo.slice(0, budgetLeft);
    result.perCreator[creator.key] = { attempted: 0, ok: 0, failed: 0, left: Math.max(0, todo.length - batch.length) };
    result.remaining += Math.max(0, todo.length - batch.length);
    if (!batch.length) continue;

    const tokens = await tokensFor(creator.token);

    for (let i = 0; i < batch.length; i += concurrency) {
      if (Date.now() - started > budgetMs) {
        const undone = batch.length - i;
        result.remaining += undone;
        result.perCreator[creator.key].left += undone;
        break;
      }
      const slice = batch.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        slice.map((row) =>
          transcribeOneAd({ adId: row.ad_id, videoId: row.video_id, clientKey: creator.key, tokens }),
        ),
      );
      for (let j = 0; j < settled.length; j++) {
        const s = settled[j];
        result.attempted += 1;
        result.perCreator[creator.key].attempted += 1;
        if (s.status === "fulfilled" && s.value.status === "ok") {
          result.ok += 1;
          result.perCreator[creator.key].ok += 1;
          if (s.value.audioStatus === "failed" || s.value.onScreenStatus === "failed") result.partial += 1;
        } else {
          result.failed += 1;
          result.perCreator[creator.key].failed += 1;
          const reason =
            s.status === "fulfilled"
              ? s.value.reason || "failed"
              : s.reason instanceof Error
                ? s.reason.message
                : String(s.reason);
          result.failures.push({ ad_id: slice[j].ad_id, client: creator.key, reason });
        }
      }
    }
  }

  result.note = `Read ${result.ok} of ${result.attempted} attempted (${result.partial} of those with one half unread); ${result.failed} failed with a written reason and ${result.remaining} still queued. Failures are stored as rows, not dropped, so coverage counts them. An ad counts as read when EITHER its spoken words or its printed on-screen words are known.`;
  return result;
}
