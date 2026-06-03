// Pluggable image-generation provider abstraction for the Variations Factory.
//
// Every provider implements a single function:
//   generateImage(prompt, referenceImageUrl?) -> { bytes, contentType, costUsd }
//
// The default provider is Higgsfield (gpt_image_2), reusing the exact CLI path
// the Studio 2.0 generator already uses. Higgsfield is asynchronous: we submit a
// generation, get a job id, poll until it finishes, then download the result
// image bytes ready to upload to Storage.
//
// To swap in OpenAI / any other model later, add a new entry to PROVIDERS keyed
// by its id and set `provider` in the Variations Factory settings — no engine
// changes needed.

import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  cleanupTempPaths,
  getHiggsfieldJobId,
  getHiggsfieldResultUrl,
  getStoredHiggsfieldCredentialStatus,
  type HiggsfieldJob,
  runHiggsfieldJson,
} from "@/lib/higgsfield-cli";

export type GeneratedImage = {
  bytes: Buffer;
  contentType: string; // e.g. "image/png"
  // Best-effort USD cost of this single generation (for the ai_usage meter).
  costUsd: number;
};

export type ImageProvider = {
  id: string;
  // Throws a clear, actionable Error if its credential is missing — never a
  // raw crash. Returns image bytes ready to upload to Storage.
  generateImage(prompt: string, referenceImageUrl?: string | null): Promise<GeneratedImage>;
};

// ---------------------------------------------------------------------------
// Higgsfield (gpt_image_2)
// ---------------------------------------------------------------------------
// Higgsfield generation is ASYNCHRONOUS and runs through the bundled Higgsfield
// CLI (same path Studio 2.0 uses). The flow is:
//   1. `generate create gpt_image_2 --prompt <p> [--image <ref>]` -> returns a job id.
//      gpt_image_2 supports image-to-image: when we have a reference image of the
//      winning ad we pass it as a local `--image` file so the variation is based
//      on that ad. With no reference it is plain text->image.
//   2. Poll `generate get <jobId>` until status is completed/failed (or timeout).
//   3. Download the result URL's bytes and return them for Storage upload.
//
// Credentials come from `studio2_secure_settings.higgsfield_credentials` (set via
// the Studio 2.0 "connect Higgsfield" flow) and/or the env tokens
// HIGGSFIELD_ACCESS_TOKEN/HIGGSFIELD_REFRESH_TOKEN — handled entirely inside
// higgsfield-cli.ts. We only check presence here for a clear up-front error.
//
// Pricing note: Higgsfield bills generations in its own credit system, not a USD
// invoice we can read back. We record a flat per-image USD estimate against the
// AI budget so the meter still moves; this is an ESTIMATE only.
const HIGGSFIELD_MODEL = "gpt_image_2";
const HIGGSFIELD_ASPECT_RATIO = "9:16";
const HIGGSFIELD_QUALITY = "high";
const HIGGSFIELD_RESOLUTION = "2k";
const HIGGSFIELD_EST_COST_PER_IMAGE = 0.05;

// Async submit + poll budget. Higgsfield image jobs typically finish in well
// under a minute, but we allow generous headroom. Each poll runs the CLI once.
const SUBMIT_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 4_000;
const MAX_POLL_MS = 5 * 60_000; // give up after 5 minutes

const higgsfieldProvider: ImageProvider = {
  id: "higgsfield",
  async generateImage(prompt, referenceImageUrl) {
    const status = await getStoredHiggsfieldCredentialStatus();
    if (!status.connected) {
      throw new Error("Higgsfield needs a fresh login token before it can generate.");
    }

    const tempPaths: string[] = [];
    try {
      const mediaArgs: string[] = [];
      if (referenceImageUrl) {
        // gpt_image_2 image-to-image: pass the winning ad as a local file so the
        // CLI uploads it as the reference. The CLI takes a file path, not a URL,
        // so we download the reference and stage it in a temp file.
        const refPath = await downloadToTempImage(referenceImageUrl, "reference");
        tempPaths.push(refPath);
        mediaArgs.push("--image", refPath);
      }

      // 1. Submit the generation.
      const { json: createJson } = await runHiggsfieldJson<HiggsfieldJob>(
        [
          "generate",
          "create",
          HIGGSFIELD_MODEL,
          "--prompt",
          prompt,
          "--aspect_ratio",
          HIGGSFIELD_ASPECT_RATIO,
          "--quality",
          HIGGSFIELD_QUALITY,
          "--resolution",
          HIGGSFIELD_RESOLUTION,
          "--batch_size",
          "1",
          ...mediaArgs,
        ],
        SUBMIT_TIMEOUT_MS
      );

      const jobId = getHiggsfieldJobId(createJson);
      if (!jobId) {
        throw new Error("Higgsfield started but Studio could not read the job id from its response.");
      }

      // 2. Poll until the job completes (or fails / times out).
      const resultUrl = await pollForResult(jobId);

      // 3. Download the result bytes for Storage upload.
      const imgRes = await fetch(resultUrl);
      if (!imgRes.ok) {
        throw new Error(`Could not download Higgsfield result (${imgRes.status})`);
      }
      const contentType = normalizeImageContentType(imgRes.headers.get("content-type"), resultUrl);
      const bytes = Buffer.from(await imgRes.arrayBuffer());
      if (!bytes.length) throw new Error("Higgsfield returned an empty image");

      return { bytes, contentType, costUsd: HIGGSFIELD_EST_COST_PER_IMAGE };
    } finally {
      await cleanupTempPaths(tempPaths);
    }
  },
};

// Polls `generate get <jobId>` until the job is completed (returns the result
// URL) or failed (throws). Times out after MAX_POLL_MS.
async function pollForResult(jobId: string): Promise<string> {
  const deadline = Date.now() + MAX_POLL_MS;
  let lastStatus = "";

  for (;;) {
    const { json } = await runHiggsfieldJson<HiggsfieldJob>(["generate", "get", jobId], POLL_TIMEOUT_MS);
    const status = normalizeStatus(json.status || "");
    lastStatus = status;

    if (status === "completed") {
      const url = getHiggsfieldResultUrl(json);
      if (!url) {
        throw new Error("Higgsfield finished but returned no result image.");
      }
      return url;
    }
    if (status === "failed") {
      const detail = typeof json.error === "string" && json.error ? `: ${json.error}` : "";
      throw new Error(`Higgsfield generation failed${detail}`);
    }

    if (Date.now() >= deadline) {
      throw new Error(`Higgsfield generation timed out (last status: ${lastStatus || "unknown"}).`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function normalizeStatus(status: unknown): string {
  const value = String(status || "").toLowerCase();
  if (["completed", "complete", "succeeded", "success"].includes(value)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(value)) return "failed";
  if (["queued", "pending", "created", "starting", "in_progress", "processing", "running"].includes(value)) {
    return "queued";
  }
  return value || "queued";
}

// Downloads an image from a URL into a temp file and returns its path. The
// Higgsfield CLI accepts a local file path for `--image`. Caller is responsible
// for cleanup (via cleanupTempPaths, which removes the temp dir).
async function downloadToTempImage(url: string, label: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not load reference image (${res.status})`);
  }
  const contentType = normalizeImageContentType(res.headers.get("content-type"), url);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("Reference image was empty");
  if (buffer.length > 18 * 1024 * 1024) throw new Error("Reference image is too large");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccos-adsvar-image-"));
  const filePath = path.join(
    dir,
    `${sanitizeFilename(label)}-${crypto.randomBytes(5).toString("hex")}.${extensionForContentType(contentType)}`
  );
  await fs.writeFile(filePath, buffer);
  return filePath;
}

function normalizeImageContentType(contentType: string | null, url: string): string {
  const clean = contentType?.split(";")[0]?.trim().toLowerCase();
  if (clean?.startsWith("image/")) return clean;
  if (/\.webp($|\?)/i.test(url)) return "image/webp";
  if (/\.jpe?g($|\?)/i.test(url)) return "image/jpeg";
  return "image/png";
}

function sanitizeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "image";
}

function extensionForContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Registry of available providers. Higgsfield is the default; add others here.
const PROVIDERS: Record<string, ImageProvider> = {
  higgsfield: higgsfieldProvider,
};

// Returns the provider for the given id, falling back to Higgsfield for an
// unknown id (so a stale settings value never hard-crashes the engine).
export function getProvider(id: string): ImageProvider {
  return PROVIDERS[id] ?? higgsfieldProvider;
}
