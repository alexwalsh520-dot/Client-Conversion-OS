import { getServiceSupabase } from "@/lib/supabase";
import { getSettings, type VariationsSettings } from "./settings";
import { buildPrompts } from "./prompts";
import { getProvider } from "./provider";

// The Variations Factory engine.
//
// Input: a source (winning) ad — its reference image + its on-image copy — plus
// the live settings. It builds N prompts per the configured mix, calls the
// image-gen provider for each, stores every output in the public `ad-variations`
// Storage bucket, and records a row per image (all sharing one job_id).
//
// Cost-capped: one call generates exactly one job (~10 images by default).

const BUCKET = "ad-variations";
const MAX_BYTES = 8 * 1024 * 1024; // gpt-image-1 PNGs are larger than previews

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

  const prompts = buildPrompts({ mix: settings.mix, onImageText });
  const jobId = `${adId}-${Date.now()}`;
  const createdAt = new Date().toISOString();

  await ensureBucket(db);

  const variations: VariationRecord[] = [];
  const errors: string[] = [];
  let succeeded = 0;

  // Sequential generation. Image models are slow and rate-limited; serial keeps
  // us well under provider concurrency caps and makes per-image failures clean.
  for (let i = 0; i < prompts.length; i++) {
    const { kind, prompt } = prompts[i];
    try {
      const img = await provider.generateImage(prompt, referenceImageUrl);
      if (!img.bytes?.byteLength || img.bytes.byteLength > MAX_BYTES) {
        throw new Error("generated image empty or too large");
      }

      const ext = img.contentType.includes("jpeg") ? "jpg" : img.contentType.includes("webp") ? "webp" : "png";
      const path = `${jobId}/${String(i).padStart(2, "0")}-${kind}.${ext}`;
      const { error: upErr } = await db.storage.from(BUCKET).upload(path, img.bytes, {
        contentType: img.contentType,
        cacheControl: "31536000",
        upsert: true,
      });
      if (upErr) throw new Error(`storage upload: ${upErr.message}`);

      const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
      const imageUrl = pub.publicUrl;

      const { data: inserted, error: insErr } = await db
        .from("ad_variations")
        .insert({
          source_ad_id: adId,
          job_id: jobId,
          kind,
          prompt,
          image_url: imageUrl,
          settings_snapshot: settings,
          provider: provider.id,
          created_at: createdAt,
        })
        .select("id, source_ad_id, job_id, kind, prompt, image_url, provider, created_at")
        .single();
      if (insErr) throw new Error(`db insert: ${insErr.message}`);

      variations.push(inserted as VariationRecord);
      succeeded++;

      // Record image-gen spend against the AI budget. Fire-and-forget; we pass
      // the estimated cost through computeCost's fallback path by logging it as
      // output tokens would be wrong, so we log a dedicated estimate row.
      logImageCost(provider.id, img.costUsd);
    } catch (err) {
      errors.push(`#${i} (${kind}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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
