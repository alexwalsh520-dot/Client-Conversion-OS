import crypto from "crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { getSettings, type VariationsSettings } from "./settings";
import { buildPrompts } from "./prompts";
import { getProvider, type ImageProvider } from "./provider";

// The Variations Factory engine.
//
// Input: a source (winning) ad — its reference image + its on-image copy — plus
// the live settings. It builds N prompts per the configured mix, calls the
// image-gen provider for each, stores every output in the public `ad-variations`
// Storage bucket, and records a row per image (all sharing one job_id).
//
// Cost-capped: one call generates exactly one job (~10 images by default).

const BUCKET = "ad-variations";
const MAX_BYTES = 8 * 1024 * 1024; // Higgsfield 2k images are larger than previews

type Db = ReturnType<typeof getServiceSupabase>;

let bucketReady = false;
async function ensureBucket(db: Db) {
  if (bucketReady) return;
  const { data: buckets } = await db.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await db.storage.createBucket(BUCKET, {
      public: true,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      fileSizeLimit: MAX_BYTES,
    });
    if (error && !error.message.toLowerCase().includes("already")) {
      throw new Error(`create bucket: ${error.message}`);
    }
  }
  bucketReady = true;
}

// Resolves the winning ad's reference image + on-image copy from the durable
// tables the rest of the dashboard already populates.
async function loadSource(
  db: Db,
  adId: string
): Promise<{ referenceImageUrl: string | null; onImageText: string }> {
  const [{ data: img }, { data: copy }] = await Promise.all([
    db
      .from("ad_creative_image")
      .select("stored_image_url, source_image_url")
      .eq("ad_id", adId)
      .maybeSingle(),
    db
      .from("ad_creative_copy")
      .select("on_image_text")
      .eq("ad_id", adId)
      .maybeSingle(),
  ]);

  const referenceImageUrl =
    (img?.stored_image_url as string | undefined) ||
    (img?.source_image_url as string | undefined) ||
    null;
  const onImageText = (copy?.on_image_text as string | undefined) || "";

  return { referenceImageUrl, onImageText };
}

export type VariationRecord = {
  id: string;
  source_ad_id: string;
  job_id: string;
  kind: string;
  prompt: string;
  image_url: string | null;
  provider: string;
  created_at: string;
};

export type GenerateJobResult = {
  jobId: string;
  sourceAdId: string;
  requested: number;
  succeeded: number;
  failed: number;
  variations: VariationRecord[];
  errors: string[];
};

export type GenerateJobOptions = {
  // Override the stored settings for this run (used by tests / single-image
  // smoke checks). Falls back to the live settings.
  settings?: VariationsSettings;
};

// Generates ONE job of variations for a single source ad. Returns the recorded
// rows. Per-image failures are isolated — one bad generation never aborts the
// rest of the batch.
export async function generateVariationsJob(
  sourceAdId: string,
  opts: GenerateJobOptions = {}
): Promise<GenerateJobResult> {
  const adId = String(sourceAdId || "").trim();
  if (!adId) throw new Error("Missing sourceAdId");

  const db = getServiceSupabase();
  const settings = opts.settings ?? (await getSettings());
  const provider = getProvider(settings.provider);

  const { referenceImageUrl, onImageText } = await loadSource(db, adId);
  if (!referenceImageUrl) {
    throw new Error(
      `No stored creative image found for ad ${adId} — cannot generate variations without a reference.`
    );
  }

  const prompts = buildPrompts({ mix: settings.mix, onImageText, sop: settings.sop });
  const jobId = `${adId}-${Date.now()}`;
  const createdAt = new Date().toISOString();

  await ensureBucket(db);

  const variations: VariationRecord[] = [];
  const errors: string[] = [];

  // Sequential generation. Image models are slow and rate-limited; serial keeps
  // us well under provider concurrency caps and makes per-image failures clean.
  for (let i = 0; i < prompts.length; i++) {
    const { kind, prompt } = prompts[i];
    try {
      const row = await renderVariation(db, {
        adId,
        kind,
        prompt,
        jobId,
        index: i,
        referenceImageUrl,
        settings,
        provider,
        createdAt,
      });
      variations.push(row);
    } catch (err) {
      errors.push(`#${i} (${kind}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const succeeded = variations.length;
  return {
    jobId,
    sourceAdId: adId,
    requested: prompts.length,
    succeeded,
    failed: prompts.length - succeeded,
    variations,
    errors,
  };
}

// The three kinds the ad_variations.kind CHECK constraint allows. Custom/freeform
// interactive prompts are stored as "background" (a cosmetic tag only).
const ALLOWED_KINDS = ["background", "highlightWord", "copyTweak"];
function normalizeKind(kind: string | undefined | null): string {
  return ALLOWED_KINDS.includes(String(kind)) ? String(kind) : "background";
}

type RenderVariationOptions = {
  adId: string;
  kind: string;
  prompt: string; // full prompt already built
  jobId: string; // shared across one batch/job
  index?: number; // for filename ordering within a job
  referenceImageUrl: string; // the winning ad (primary reference)
  extraReferenceUrls?: string[]; // user-added references (e.g. a desired background)
  settings: VariationsSettings;
  provider: ImageProvider;
  createdAt?: string;
};

// Generates ONE image (winning ad + any extra references → provider), stores it
// in the bucket, records the row, and returns it. Shared by the batch job and
// the interactive single-image endpoint so both paths produce identical rows.
async function renderVariation(db: Db, o: RenderVariationOptions): Promise<VariationRecord> {
  const refs = [o.referenceImageUrl, ...(o.extraReferenceUrls || [])];
  const img = await o.provider.generateImage(o.prompt, refs);
  if (!img.bytes?.byteLength || img.bytes.byteLength > MAX_BYTES) {
    throw new Error("generated image empty or too large");
  }

  const ext = img.contentType.includes("jpeg") ? "jpg" : img.contentType.includes("webp") ? "webp" : "png";
  const idx = typeof o.index === "number" ? o.index : 0;
  const path = `${o.jobId}/${String(idx).padStart(2, "0")}-${o.kind}-${crypto.randomBytes(3).toString("hex")}.${ext}`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, img.bytes, {
    contentType: img.contentType,
    cacheControl: "31536000",
    upsert: true,
  });
  if (upErr) throw new Error(`storage upload: ${upErr.message}`);

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);

  const { data: inserted, error: insErr } = await db
    .from("ad_variations")
    .insert({
      source_ad_id: o.adId,
      job_id: o.jobId,
      kind: o.kind,
      prompt: o.prompt,
      image_url: pub.publicUrl,
      settings_snapshot: o.settings,
      provider: o.provider.id,
      created_at: o.createdAt || new Date().toISOString(),
    })
    .select("id, source_ad_id, job_id, kind, prompt, image_url, provider, created_at")
    .single();
  if (insErr) throw new Error(`db insert: ${insErr.message}`);

  logImageCost(o.provider.id, img.costUsd);
  return inserted as VariationRecord;
}

// ── Interactive single-image generation (the Generate popup) ────────────────
// The popup fires one of these per requested image so results can stream in
// independently. Builds the prompt from a preset/custom instruction + the house
// SOP, attaches the winning ad plus any user-chosen reference images.
export type GenerateOneInput = {
  adId: string;
  // The full instruction for this image (preset text and/or the user's chat
  // prompt). The house SOP is appended automatically.
  prompt: string;
  kind?: string; // background | highlightWord | copyTweak (else stored as background)
  jobId?: string; // group several popup images under one job
  index?: number;
  extraReferenceUrls?: string[]; // user-added references beyond the winning ad
  // Refine mode: edit THIS image (a prior variation) instead of the winning ad.
  baseImageUrl?: string;
  settings?: VariationsSettings;
};

export async function generateOneVariation(input: GenerateOneInput): Promise<VariationRecord> {
  const adId = String(input.adId || "").trim();
  if (!adId) throw new Error("Missing adId");
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("Missing prompt");

  const db = getServiceSupabase();
  const settings = input.settings ?? (await getSettings());
  const provider = getProvider(settings.provider);

  // Refine mode: when a baseImageUrl is given, that image (e.g. a previously
  // generated variation the owner wants to tweak) is the primary reference to
  // edit — we do NOT reload the original winning ad. Otherwise the winning ad's
  // stored creative is the base.
  let referenceImageUrl = String(input.baseImageUrl || "").trim();
  if (!referenceImageUrl) {
    const src = await loadSource(db, adId);
    referenceImageUrl = src.referenceImageUrl || "";
    if (!referenceImageUrl) {
      throw new Error(
        `No stored creative image found for ad ${adId} — cannot generate variations without a reference.`
      );
    }
  }
  await ensureBucket(db);

  // The house SOP rides along on every image, same as the batch path.
  const sop = (settings.sop || "").trim();
  const fullPrompt = sop ? `${prompt} House creative rules (follow these): ${sop}` : prompt;

  return renderVariation(db, {
    adId,
    kind: normalizeKind(input.kind),
    prompt: fullPrompt,
    jobId: input.jobId || `${adId}-${Date.now()}`,
    index: input.index,
    referenceImageUrl,
    extraReferenceUrls: input.extraReferenceUrls,
    settings,
    provider,
  });
}

// Logs an estimated image-generation cost into ai_usage. The ai-usage helper is
// token-based (built for Anthropic text calls), so here we insert a minimal
// estimate row directly: feature tagged so it's filterable, cost_usd set to the
// per-image estimate, token columns zero. Fire-and-forget; never throws.
function logImageCost(providerId: string, costUsd: number): void {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;
  void (async () => {
    try {
      const db = getServiceSupabase();
      const { error } = await db.from("ai_usage").insert({
        feature: "ads-variations-image",
        model: `${providerId}:image`,
        input_tokens: 0,
        output_tokens: 0,
        cache_write_tokens: 0,
        cache_read_tokens: 0,
        cost_usd: Number(costUsd.toFixed(6)),
      });
      if (error) console.error("[ads-variations] ai_usage insert failed (non-fatal):", error.message);
    } catch (err) {
      console.error("[ads-variations] cost log failed (non-fatal):", err);
    }
  })();
}
