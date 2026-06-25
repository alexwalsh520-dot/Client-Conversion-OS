// Factory generator — produce finished 9:16 IG-story DM ad creatives for Tyson
// using the SAME proven Higgsfield gpt_image_2 image-to-image pipeline the CCOS
// Variations Factory uses (src/lib/ads-variations/provider.ts), then wire the
// results into the Factory board (factory_items).
//
// What it does, per item in ITEMS below:
//   1. Reads the item's exact copy_text from factory_items (source of truth).
//   2. Builds a finished-ad prompt (IG-native story text rendered word-for-word).
//   3. Runs the Higgsfield CLI: generate create gpt_image_2 with the local
//      reference photo passed as --image (image-to-image, keeps Tyson's face).
//   4. Polls `generate get <jobId>` until completed, downloads the result.
//   5. Uploads the result to the public `ad-variations` Storage bucket.
//   6. Sets factory_items.image_url = public URL and stage = 'image_generated'.
//   7. Saves a local copy into the campaign folder.
//
// Run the PROOF SET (default = B19, B7, B1):
//   node scripts/factory-generate.mjs
//
// Run a custom set:
//   node scripts/factory-generate.mjs B2 B3 C5
//
// Run the full batch (every copy_written item in the project):
//   node scripts/factory-generate.mjs --all
//
// Auth: reads Higgsfield creds from HIGGSFIELD_CREDENTIALS_PATH if set, else
// /tmp/hfauth/credentials.json, else the studio2_secure_settings row. Supabase
// service role + URL come from .env.local.

import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// Defaults preserve the original Tyson run. Any project can be targeted with
//   --project "<name>" --client <client> [--outdir <dir>]
// and the generator resolves each item's reference image(s) + mode from the DB
// (factory_items.reference_paths / prompt_mode), so it is no longer hardcoded to
// one project. Items WITHOUT reference_paths fall back to the legacy in-script
// Tyson resolution below, keeping the original sprint reproducible.
const DEFAULT_PROJECT_NAME = "Tyson 100-Ad Sprint";
const DEFAULT_PROJECT_CLIENT = "tyson";
const STORAGE_BUCKET = "ad-variations";
const RAW_PICS_DIR = "/Users/alexwalsh/Documents/All/Agency/Tyson/00_RAW_LIBRARY/Tyson Raw Pics";
const DEFAULT_CAMPAIGN_DIR =
  "/Users/alexwalsh/Documents/All/Agency/Tyson/01_CAMPAIGNS/06:22:2026 - Tyson - 100 Ad Sprint";

const slugify = (s) =>
  String(s || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";

const HIGGSFIELD_MODEL = "gpt_image_2";
const HIGGSFIELD_ASPECT_RATIO = "9:16";
const HIGGSFIELD_QUALITY = "high";
const HIGGSFIELD_RESOLUTION = "2k";

const POLL_INTERVAL_MS = 4_000;
const MAX_POLL_MS = 5 * 60_000;
const SUBMIT_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 60_000;

// Reference photo per label. Items not listed fall back to image_direction in DB
// (if it names an img) or are skipped with a warning so the full batch can grow
// just by adding rows here. Each value is a filename inside RAW_PICS_DIR.
const REFERENCE_BY_LABEL = {
  B19: "IMG_0148.JPG", // clean shredded selfie
  B7: "IMG_0851.JPG", // wide-eyed shaker face
  B1: "464F4AB6-AC83-4F48-BCAE-F63009382954.JPG", // REAL phone screenshot (85,875 views / 853 replies)
};

// Labels whose reference is a real on-image artifact (screenshot UI) that MUST be
// preserved exactly — the prompt is told not to alter numbers/UI.
const PRESERVE_SCREENSHOT_LABELS = new Set(["B1", "B2", "B3", "B4", "B5", "B6", "C1", "C2", "C3", "C4", "C5"]);

const PROOF_SET = ["B19", "B7", "B1"];

// Winning-ad STYLE references: for ads meant to MATCH our proven IG-native look,
// feed a REAL winning ad as the reference so gpt_image_2 copies its exact font +
// dark rounded text boxes + red emphasis, instead of inventing a style.
// Verified winning ads used as STYLE references (rotated for layout variety; all
// share our proven IG-native look).
const CAMPAIGNS_DIR = "/Users/alexwalsh/Documents/All/Agency/Tyson/01_CAMPAIGNS";
const WINNER_STYLE_REF = `${CAMPAIGNS_DIR}/05:06:2026 - Tyson - Summer Shred/LEAN.png`;
const STYLE_REFS = [
  `${CAMPAIGNS_DIR}/05:06:2026 - Tyson - Summer Shred/LEAN.png`,
  `${CAMPAIGNS_DIR}/06:07:2026 - Tyson - Direct CTA Winners/Tyson-fit-var-01.png`,
];
// Fresh Tyson subject photos, rotated so the matching-style ads don't look samey.
const SUBJECT_PHOTOS = [
  "IMG_0148.JPG", "IMG_0851.JPG", "IMG_0835.JPG", "IMG_6346.JPG", "IMG_6948.JPG",
  "IMG_0840.JPG", "IMG_0841.JPG", "IMG_0842.JPG", "IMG_0843.JPG", "IMG_0845.JPG",
  "IMG_0846.JPG", "IMG_0863.JPG", "IMG_0864.JPG", "IMG_0865.JPG", "IMG_0866.JPG",
  "IMG_0867.JPG", "IMG_0869.JPG", "IMG_0901.JPG", "IMG_0902.JPG", "IMG_0903.JPG",
  "IMG_2456.jpg", "IMG_4239.jpg", "IMG_5664.jpg", "IMG_4156.JPG",
];
// Optional per-label overrides (else rotation by index).
const STYLE_REF_BY_LABEL = {};
const SUBJECT_PHOTO_BY_LABEL = {};
// Stat/chart ads: matching style + a clean chart/figure graphic in the middle band.
const CHART_NOTE_BY_LABEL = {
  B16: "Also include a simple, clean, minimal pie/donut chart in the middle band illustrating the breakdown referenced in the copy. Flat and legible, styled to match. A graphic element, not a photo.",
  B18: "Also include a simple, clean stat/figure graphic in the middle band that visualizes the statistic in the copy. Flat, minimal, legible, styled to match.",
  // B17 chart removed per revision ("get rid of the stat chart").
};
// Revisions: rebuild these from the man's PHOTO alone (single ref) so the photo's
// own background is kept (the two-ref version blended in the winning ad's tank bg).
const REVISION_SINGLE_REF = new Set(["C31", "C34", "C39"]);
const REVISION_PHOTO = { C31: "IMG_0148.JPG", C34: "IMG_0835.JPG", C39: "IMG_0851.JPG" };
// Copy was already corrected in the DB for these; don't also append the note to the
// prompt (would make the model re-edit copy that's already fixed).
const COPY_ONLY_REVISIONS = new Set(["B21", "B25", "B30", "C26", "C40"]);

// Frame-safe layout (Alex HARD RULE, from the proven Antwan generations): Instagram
// overlays the account name at the very top and the Send Message button at the bottom.
const FRAMING_RULE =
  "CRITICAL SAFE-ZONE LAYOUT: keep the TOP 13% of the frame and the BOTTOM 22% of the frame completely EMPTY of text. Instagram overlays the account name at the top and the 'Send Message' button at the bottom. ALL text must sit inside the middle band, between 15% and 76% of the image height. Never place any words in the top 13% or bottom 22%.";
// Proven look — do NOT let the model invent a generic/blocky font.
const STYLE_RULE =
  "Text style: the bold Instagram-Story font, each text block sitting on its own semi-transparent near-black rounded rectangle bar, clean line spacing, highly legible. Do NOT use a blocky or all-caps display font. Premium and clean.";

// Controlled red emphasis: pick at most TWO exact phrases to color red (the offer
// token + the CTA). Everything else stays white. Never let the model auto-red.
function pickRedPhrases(copy) {
  const reds = [];
  if (/\$0\b/.test(copy)) reds.push("$0");
  else if (/Zero dollars/i.test(copy)) reds.push("Zero dollars");
  else if (/\bFree\b/.test(copy)) reds.push("Free");
  const ctaLine = (copy.split(/\n/).map((s) => s.trim()).find((l) => /\bDM me\b/i.test(l)) || "").replace(/[.]+$/, "");
  if (ctaLine) reds.push(ctaLine);
  return reds.slice(0, 2);
}

// ---------------------------------------------------------------------------
// .env.local loader (same pattern as other scripts)
// ---------------------------------------------------------------------------
const envText = fs.readFileSync(".env.local", "utf8");
function env(key) {
  const line = envText.split(/\r?\n/).find((x) => x.startsWith(key + "="));
  if (!line) return "";
  let v = line.slice(key.length + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Higgsfield credential staging
// ---------------------------------------------------------------------------
// The CLI reads HIGGSFIELD_CREDENTIALS_PATH. Prefer an explicit path, else the
// fresh CLI-login creds, else fall back to the secure-settings row in Supabase.
async function resolveCredentialsPath() {
  const explicit = process.env.HIGGSFIELD_CREDENTIALS_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) return { path: explicit, cleanup: async () => {} };

  const fresh = "/tmp/hfauth/credentials.json";
  if (fs.existsSync(fresh)) return { path: fresh, cleanup: async () => {} };

  // Fall back to studio2_secure_settings.higgsfield_credentials.
  const { data } = await sb
    .from("studio2_secure_settings")
    .select("value")
    .eq("key", "higgsfield_credentials")
    .maybeSingle();
  if (!data?.value) {
    throw new Error("No Higgsfield credentials found (env path, /tmp/hfauth, or studio2_secure_settings).");
  }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "factory-hfauth-"));
  const p = path.join(dir, "credentials.json");
  await fsp.writeFile(p, String(data.value), { mode: 0o600 });
  return { path: p, cleanup: async () => fsp.rm(dir, { recursive: true, force: true }) };
}

const cliBin = path.join(process.cwd(), "node_modules", "@higgsfield", "cli", "bin", "higgsfield.js");

async function runHF(args, timeoutMs, credPath) {
  const { stdout } = await execFileAsync(process.execPath, [cliBin, ...args, "--json", "--no-color"], {
    env: {
      ...process.env,
      HIGGSFIELD_CREDENTIALS_PATH: credPath,
      HIGGSFIELD_DISABLE_TELEMETRY: "1",
    },
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 12,
  });
  return parseJson(stdout);
}

function parseJson(stdout) {
  const t = (stdout || "").trim();
  if (!t) throw new Error("Higgsfield returned no JSON output");
  try {
    return JSON.parse(t);
  } catch {
    const start = Math.min(...["{", "["].map((c) => (t.indexOf(c) === -1 ? Infinity : t.indexOf(c))));
    if (!Number.isFinite(start)) throw new Error(`Non-JSON Higgsfield output: ${t.slice(0, 300)}`);
    return JSON.parse(t.slice(start));
  }
}

// --- job id / result url extraction (mirrors higgsfield-cli.ts) ---
const JOB_ID_KEYS = ["id", "job_id", "jobId", "uuid", "generation_id", "generationId", "jobID"];
const JOB_CONTAINER_KEYS = ["data", "job", "jobs", "generation", "generations", "result", "results", "item", "items"];
const RESULT_URL_KEYS = ["result_url", "resultUrl", "output_url", "outputUrl", "image_url", "imageUrl", "download_url", "downloadUrl"];
const RESULT_CONTAINER_KEYS = ["data", "job", "generation", "output", "outputs", "result", "results", "image", "images", "asset", "assets"];

function isLikelyJobId(v) {
  const t = String(v).trim();
  return t.length >= 8 && /^[a-zA-Z0-9_-]+$/.test(t);
}
function findJobId(value, seen = new Set()) {
  if (!value) return "";
  if (Array.isArray(value)) {
    for (const it of value) {
      if (typeof it === "string" && isLikelyJobId(it)) return it.trim();
      const id = findJobId(it, seen);
      if (id) return id;
    }
    return "";
  }
  if (typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  for (const k of JOB_ID_KEYS) if (typeof value[k] === "string" && isLikelyJobId(value[k])) return value[k].trim();
  for (const k of JOB_CONTAINER_KEYS) {
    const id = findJobId(value[k], seen);
    if (id) return id;
  }
  for (const nested of Object.values(value)) {
    if (nested && (Array.isArray(nested) || typeof nested === "object")) {
      const id = findJobId(nested, seen);
      if (id) return id;
    }
  }
  return "";
}
function findResultUrl(value, seen = new Set(), allowGeneric = false) {
  if (!value) return "";
  if (Array.isArray(value)) {
    for (const it of value) {
      const u = findResultUrl(it, seen, allowGeneric);
      if (u) return u;
    }
    return "";
  }
  if (typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  for (const k of RESULT_URL_KEYS) if (typeof value[k] === "string" && /^https?:\/\//.test(value[k])) return value[k];
  if (allowGeneric && typeof value.url === "string" && /^https?:\/\//.test(value.url)) return value.url;
  for (const k of RESULT_CONTAINER_KEYS) {
    if (!value[k]) continue;
    const u = findResultUrl(value[k], seen, true);
    if (u) return u;
  }
  return "";
}
function normalizeStatus(s) {
  const v = String(s || "").toLowerCase();
  if (["completed", "complete", "succeeded", "success"].includes(v)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(v)) return "failed";
  return "queued";
}

async function pollForResult(jobId, credPath) {
  const deadline = Date.now() + MAX_POLL_MS;
  let last = "";
  for (;;) {
    const json = await runHF(["generate", "get", jobId], POLL_TIMEOUT_MS, credPath);
    const status = normalizeStatus(json.status);
    last = status;
    if (status === "completed") {
      const url = findResultUrl(json);
      if (!url) throw new Error("Completed but no result URL in response");
      return url;
    }
    if (status === "failed") throw new Error(`Generation failed: ${json.error || "unknown"}`);
    if (Date.now() >= deadline) throw new Error(`Timed out (last status: ${last})`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------
function buildPrompt(item, preserveScreenshot) {
  const copy = item.copy_text.trim();
  if (preserveScreenshot) {
    return [
      "Create a finished 9:16 vertical Instagram Story DM ad.",
      "The reference image is a REAL phone screenshot showing an Instagram story's view/reply stats panels (for example '85,875 Views' and '853 Replies').",
      "CRITICAL: Preserve that phone screenshot UI EXACTLY as it appears in the reference — do NOT alter, redraw, re-render, or change any of the numbers, labels, avatars, or layout. Keep the original screenshot intact and recognizable in the upper portion of the frame.",
      "In the lower portion of the frame, add the following ad copy as native Instagram Story text, not overlapping the screenshot stats. " + STYLE_RULE,
      pickRedPhrases(copy).length
        ? `Color ONLY these exact phrases red, keep EVERY other added word white: ${pickRedPhrases(copy).map((r) => `"${r}"`).join(", ")}. Do not make any other words red.`
        : "Keep all added text white.",
      "IMPORTANT: IGNORE the colors inside the screenshot (its pink/magenta ring) when styling the text. The text highlight bars must be semi-transparent near-black. NEVER use pink, magenta, or purple for the text or its bars.",
      FRAMING_RULE,
      "Render this copy WORD FOR WORD, exactly as written, with no changes, no added words, no removed words, and no invented statistics or claims:",
      "",
      copy,
      "",
      "No before/after body comparison. Do not fabricate any numbers beyond what is in the reference screenshot and the copy above.",
    ].join("\n");
  }
  return [
    "Create a finished 9:16 vertical Instagram Story DM ad.",
    "Use the reference photo as the man in the ad. Keep his real face, physique, skin tone, and tattoos exactly as in the reference — do not distort, slim, inflate, or beautify him, and do not show a before/after comparison.",
    "Render the following ad copy as native Instagram Story text: clean white sans-serif lettering with the key phrases sitting on solid colored highlight bars (the Instagram 'story text' look). The text must be well-composed, balanced in the frame, and highly legible against the photo.",
    "Render the copy WORD FOR WORD, exactly as written below — no changes, no added words, no removed words, correct spelling, and no invented statistics or claims:",
    "",
    copy,
    "",
    "Keep it clean and premium. No fabricated stats or claims beyond the copy above.",
    FRAMING_RULE,
  ].join("\n");
}

// Match-style prompt: reproduce a proven winning ad's exact look with new copy.
function buildMatchPrompt(item, chartNote, refMode) {
  const copy = item.copy_text.trim();
  const reds = pickRedPhrases(copy);
  const redLine = reds.length
    ? `Color ONLY these exact phrases red, and keep EVERY other word white: ${reds.map((r) => `"${r}"`).join(", ")}. Do not make any other words red.`
    : "Keep all text white.";
  const refLine =
    refMode === "photo"
      ? "The reference image is a PHOTO of the man. Use HIM as the subject and keep his real face, physique, skin tone, tattoos, and his ORIGINAL background and setting exactly as in the photo. Do NOT composite, swap, or invent a different background. No before/after comparison."
      : refMode === "two"
        ? "You are given TWO reference images. Reference image 1 is one of our PROVEN finished ads — copy its EXACT visual style: same bold Instagram-Story font, line spacing, semi-transparent near-black rounded highlight bars, layout, and composition. Reference image 2 is a PHOTO of the man — feature HIM as the subject (his real face, physique, skin tone, tattoos). Put the man from image 2 into the ad style of image 1. Do not distort or beautify him; no before/after comparison."
        : "The reference image is one of our PROVEN finished ads — copy its EXACT visual style and keep the man in it. No before/after comparison.";
  return [
    "Create a finished 9:16 vertical Instagram Story DM ad.",
    refLine,
    STYLE_RULE,
    redLine,
    chartNote || "",
    FRAMING_RULE,
    "Render the following ad copy WORD FOR WORD exactly as written (correct spelling, no added or removed words, no invented statistics):",
    "",
    copy,
    "",
    "Clean and premium.",
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Evergreen prompt (DB-driven) — used for any project whose items carry their
// own reference_paths + prompt_mode. Generic red-phrase picker so new copy sets
// ("5 men", "5 spots", "DM me", "$0", "Free") get the proven emphasis without
// per-project tuning. Tyson items (no reference_paths) never hit this path.
// ---------------------------------------------------------------------------
function pickRedsEvergreen(copy) {
  const reds = [];
  if (/\$0\b/.test(copy)) reds.push("$0");
  else if (/Zero dollars/i.test(copy)) reds.push("Zero dollars");
  else if (/\bFree\b/.test(copy)) reds.push("Free");
  for (const m of copy.matchAll(/\b\d+\s+(?:men|women|people|spots?|guys|moms|dads|coaches)\b/gi)) {
    if (!reds.includes(m[0])) reds.push(m[0]);
  }
  if (/\bDM me\b/i.test(copy) && !reds.includes("DM me")) reds.push("DM me");
  return reds.slice(0, 4);
}

function buildEvergreenPrompt(item) {
  const copy = item.copy_text.trim();
  const mode = item.prompt_mode || "photo";
  const reds = pickRedsEvergreen(copy);
  const redLine = reds.length
    ? `Color ONLY these exact phrases red, and keep EVERY other word white: ${reds.map((r) => `"${r}"`).join(", ")}. Do not make any other words red.`
    : "Keep all text white.";

  if (mode === "screenshot") return buildPrompt(item, true);

  const refLine =
    mode === "two_ref"
      ? "You are given TWO reference images. Reference image 1 is one of our PROVEN finished ads — copy its EXACT visual style: same bold Instagram-Story font, line spacing, semi-transparent near-black rounded highlight bars, layout, and composition. Reference image 2 is a PHOTO of the person — feature THEM as the subject (their real face, physique, skin tone, tattoos). Do not distort or beautify them; no before/after comparison."
      : mode === "finished_ad"
        ? "The reference image is one of our PROVEN finished ads. Copy its EXACT visual style: same bold Instagram-Story font, line spacing, semi-transparent near-black rounded highlight bars, layout, and composition. Keep the SAME person from the reference exactly as they are — real face, physique, skin tone, tattoos, pose, clothing, and the original background — do not distort, slim, inflate, beautify, or replace them or the setting. No before/after comparison."
        : "The reference image is a PHOTO of the person. Use THEM as the subject and keep their real face, physique, skin tone, tattoos, and their ORIGINAL background and setting exactly as in the photo. Do NOT composite, swap, or invent a different background. No before/after comparison.";

  return [
    "Create a finished 9:16 vertical Instagram Story DM ad.",
    refLine,
    STYLE_RULE,
    redLine,
    FRAMING_RULE,
    "Render the following ad copy WORD FOR WORD exactly as written (correct spelling, no added or removed words, no invented statistics):",
    "",
    copy,
    "",
    "Clean and premium.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Storage + DB wiring
// ---------------------------------------------------------------------------
async function uploadToStorage(slug, label, bytes, contentType) {
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const objectPath = `factory/${slug}/${label}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(objectPath, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

async function getProject(name, client) {
  let q = sb.from("factory_projects").select("id, name, client").eq("name", name);
  if (client) q = q.eq("client", client);
  const { data } = await q.maybeSingle();
  if (!data?.id) throw new Error(`Project "${name}"${client ? ` (${client})` : ""} not found.`);
  return data;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const revisionsMode = args.includes("--revisions");
  // Flag values: --project "<name>", --client <key>, --outdir <dir>.
  const flagValue = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };
  const projectName = flagValue("--project") || DEFAULT_PROJECT_NAME;
  const clientKey = flagValue("--client") || (flagValue("--project") ? null : DEFAULT_PROJECT_CLIENT);
  const FLAG_NAMES = new Set(["--all", "--revisions", "--project", "--client", "--outdir"]);
  const explicitLabels = args.filter(
    (a, i) => !a.startsWith("--") && !FLAG_NAMES.has(args[i - 1])
  );

  const { path: credPath, cleanup } = await resolveCredentialsPath();
  console.log(`Higgsfield creds: ${credPath}`);

  // Sanity-check auth + credits up front.
  try {
    const acct = await runHF(["account", "status"], 30_000, credPath);
    console.log(`Account: ${acct.email} | plan: ${acct.subscription_plan_type} | credits: ${acct.credits}`);
  } catch (e) {
    console.warn("Could not read account status (continuing):", e.message);
  }

  const project = await getProject(projectName, clientKey);
  const projectId = project.id;
  const projectSlug = slugify(project.name);
  const outDir = flagValue("--outdir") ||
    (projectSlug === slugify(DEFAULT_PROJECT_NAME) ? DEFAULT_CAMPAIGN_DIR : `/tmp/factory/${projectSlug}`);
  console.log(`Project: "${project.name}" (${project.client || "—"}) | out: ${outDir}`);
  await fsp.mkdir(outDir, { recursive: true });

  let labels;
  if (revisionsMode) {
    const { data } = await sb
      .from("factory_items")
      .select("label")
      .eq("project_id", projectId)
      .eq("stage", "revision")
      .order("sort_order", { ascending: true });
    labels = (data || []).map((r) => r.label);
  } else if (all) {
    const { data } = await sb
      .from("factory_items")
      .select("label")
      .eq("project_id", projectId)
      .eq("stage", "copy_written")
      .order("sort_order", { ascending: true });
    labels = (data || []).map((r) => r.label);
  } else {
    labels = explicitLabels.length ? explicitLabels : PROOF_SET;
  }
  console.log(`Generating ${labels.length} item(s): ${labels.join(", ")}\n`);

  const results = [];
  for (let genIndex = 0; genIndex < labels.length; genIndex++) {
    const label = labels[genIndex];
    console.log(`\n===== ${label} =====`);
    try {
      const { data: item, error } = await sb
        .from("factory_items")
        .select("*")
        .eq("project_id", projectId)
        .eq("label", label)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!item) throw new Error("Item not found in factory_items");

      // Resolve reference(s) + prompt by style.
      let refPaths, prompt, refLabel;
      if (Array.isArray(item.reference_paths) && item.reference_paths.length) {
        // EVERGREEN PATH: the item carries its own reference image(s) + mode in the
        // DB, so any project works without per-project code. Refs are local files.
        for (const p of item.reference_paths) {
          if (!fs.existsSync(p)) throw new Error(`Reference file missing: ${p}`);
        }
        refPaths = item.reference_paths;
        prompt = buildEvergreenPrompt(item);
        refLabel = `${item.prompt_mode || "photo"} :: ${item.reference_paths.map((p) => path.basename(p)).join(" + ")}`;
      } else if (!PRESERVE_SCREENSHOT_LABELS.has(label)) {
        if (item.stage === "revision" && REVISION_SINGLE_REF.has(label)) {
          // Revision: rebuild from the man's PHOTO alone, keeping its own background
          // (the two-ref version was blending the winning ad's tank background in).
          const subjFile = REVISION_PHOTO[label] || SUBJECT_PHOTOS[genIndex % SUBJECT_PHOTOS.length];
          const subjPath = path.join(RAW_PICS_DIR, subjFile);
          if (!fs.existsSync(subjPath)) throw new Error(`Subject photo missing: ${subjPath}`);
          refPaths = [subjPath];
          prompt = buildMatchPrompt(item, undefined, "photo");
          refLabel = `photo-only=${subjFile} (REVISION)`;
        } else {
          // Match style = TWO references (the Antwan recipe): a winning ad supplies the
          // style/font/layout, a fresh Tyson photo supplies the new subject. Rotated by
          // index so the matching ads use different winners + photos (variety).
          const styleRef = STYLE_REF_BY_LABEL[label] || STYLE_REFS[genIndex % STYLE_REFS.length];
          if (!fs.existsSync(styleRef)) throw new Error(`Style reference missing: ${styleRef}`);
          const subjFile = SUBJECT_PHOTO_BY_LABEL[label] || SUBJECT_PHOTOS[genIndex % SUBJECT_PHOTOS.length];
          const subjPath = path.join(RAW_PICS_DIR, subjFile);
          if (!fs.existsSync(subjPath)) throw new Error(`Subject photo missing: ${subjPath}`);
          refPaths = [styleRef, subjPath];
          prompt = buildMatchPrompt(item, CHART_NOTE_BY_LABEL[label], "two");
          refLabel = `style=${path.basename(styleRef)} + subject=${subjFile} (MATCH)`;
        }
      } else {
        let refFile = REFERENCE_BY_LABEL[label];
        if (!refFile && /img\s+([A-Z0-9_-]+)/i.test(item.image_direction || "")) {
          const token = item.image_direction.match(/img\s+([A-Z0-9_-]+)/i)[1];
          const files = await fsp.readdir(RAW_PICS_DIR);
          refFile = files.find((f) => f.toUpperCase().includes(token.toUpperCase()));
        }
        if (!refFile) throw new Error(`No reference photo mapped for ${label} (add to REFERENCE_BY_LABEL).`);
        const p = path.join(RAW_PICS_DIR, refFile);
        if (!fs.existsSync(p)) throw new Error(`Reference file missing: ${p}`);
        refPaths = [p];
        const preserve = PRESERVE_SCREENSHOT_LABELS.has(label);
        prompt = buildPrompt(item, preserve);
        refLabel = `${refFile}${preserve ? " (PRESERVE screenshot UI)" : ""}`;
      }
      console.log(`References: ${refLabel}`);

      // Revisions: fold the user's note into the prompt (except copy-only edits,
      // whose copy_text was already corrected in the DB).
      if (item.stage === "revision" && item.revision_note && !COPY_ONLY_REVISIONS.has(label)) {
        prompt += `\n\nREVISION REQUESTED — apply this exact change while keeping everything else the same: ${item.revision_note}`;
        console.log(`  revision note applied: ${item.revision_note.slice(0, 80)}`);
      }

      // 1-3. Submit, poll, download — retry transient Higgsfield errors (502s,
      // timeouts, CDN hiccups) so one blip never loses an ad.
      let bytes, ct;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const createJson = await runHF(
            [
              "generate", "create", HIGGSFIELD_MODEL,
              "--prompt", prompt,
              "--aspect_ratio", HIGGSFIELD_ASPECT_RATIO,
              "--quality", HIGGSFIELD_QUALITY,
              "--resolution", HIGGSFIELD_RESOLUTION,
              "--batch_size", "1",
              ...refPaths.flatMap((p) => ["--image", p]),
            ],
            SUBMIT_TIMEOUT_MS,
            credPath
          );
          const jobId = findJobId(createJson);
          if (!jobId) throw new Error(`No job id in create response: ${JSON.stringify(createJson).slice(0, 200)}`);
          console.log(`Submitted job ${jobId} (attempt ${attempt}), polling...`);
          const resultUrl = await pollForResult(jobId, credPath);
          const res = await fetch(resultUrl);
          if (!res.ok) throw new Error(`Download failed (${res.status})`);
          ct = (res.headers.get("content-type") || "").split(";")[0].trim() ||
            (/\.png/i.test(resultUrl) ? "image/png" : "image/jpeg");
          bytes = Buffer.from(await res.arrayBuffer());
          if (!bytes.length) throw new Error("Empty result image");
          break;
        } catch (e) {
          if (attempt === 3) throw e;
          console.warn(`  attempt ${attempt} failed (${e.message}); retrying in 6s...`);
          await new Promise((r) => setTimeout(r, 6000));
        }
      }
      console.log(`Completed. Downloading result...`);

      // 4. Save local copy.
      const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
      const localPath = path.join(outDir, `${label}.${ext}`);
      await fsp.writeFile(localPath, bytes);
      console.log(`Saved local: ${localPath}`);

      // 5. Upload to public Storage.
      const publicUrl = await uploadToStorage(projectSlug, label, bytes, ct);
      console.log(`Public URL: ${publicUrl}`);

      // 6. Update factory_items.
      const upd = { image_url: publicUrl, stage: "image_generated", updated_at: new Date().toISOString() };
      // Clear the note once a revision has been applied (history keeps it on the version row).
      if (item.stage === "revision") upd.revision_note = null;
      const { error: upErr } = await sb
        .from("factory_items")
        .update(upd)
        .eq("id", item.id);
      if (upErr) throw new Error(`DB update failed: ${upErr.message}`);
      console.log(`Updated factory_items: stage=image_generated`);

      // 6b. Record a version-history row (additive — keeps every past image).
      const { data: maxV } = await sb
        .from("factory_item_versions")
        .select("version")
        .eq("item_id", item.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextV = ((maxV && maxV.version) || 0) + 1;
      const { error: verErr } = await sb.from("factory_item_versions").insert({
        item_id: item.id,
        version: nextV,
        image_url: publicUrl,
        revision_note: item.revision_note || null,
      });
      if (verErr) console.warn(`version insert failed (non-fatal): ${verErr.message}`);
      else console.log(`Recorded version v${nextV}`);

      results.push({ label, ok: true, publicUrl, localPath });
    } catch (e) {
      console.error(`FAILED ${label}: ${e.message}`);
      results.push({ label, ok: false, error: e.message });
    }
  }

  await cleanup();

  console.log("\n\n========== SUMMARY ==========");
  for (const r of results) {
    if (r.ok) console.log(`${r.label}: OK -> ${r.publicUrl}`);
    else console.log(`${r.label}: FAILED -> ${r.error}`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
