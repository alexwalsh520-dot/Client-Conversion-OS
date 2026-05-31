import { getServiceSupabase } from "@/lib/supabase";

// Facebook's ad preview URLs (external-*.fbcdn.net/emg1/...) expire within days,
// so the Deep Dive can show blanks on older date ranges. This module downloads
// each ad's preview image while Meta's URL is still fresh (at sync time) and
// stores the bytes in our own public bucket, keyed by ad_id. The dashboard then
// serves the stable stored URL, falling back to the live Facebook URL.

const BUCKET = "ad-creatives";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — preview creatives are far smaller
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

type Db = ReturnType<typeof getServiceSupabase>;

let bucketReady = false;
async function ensureBucket(db: Db) {
  if (bucketReady) return;
  const { data: buckets } = await db.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    const { error } = await db.storage.createBucket(BUCKET, {
      public: true,
      allowedMimeTypes: Object.keys(EXT_BY_TYPE),
      fileSizeLimit: MAX_BYTES,
    });
    if (error && !error.message.toLowerCase().includes("already")) {
      throw new Error(`create bucket: ${error.message}`);
    }
  }
  bucketReady = true;
}

export type StoreImageInput = {
  adId: string;
  imageUrl?: string | null;
  clientKey?: string | null;
};

// Given a roster of ads, returns the ad_ids that do NOT yet have a stored image,
// so a sync only fetches images it hasn't captured before (cheap on re-runs).
export async function findUnstoredAdIds(adIds: string[]): Promise<Set<string>> {
  const db = getServiceSupabase();
  const unique = Array.from(new Set(adIds.filter(Boolean)));
  const stored = new Set<string>();
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data } = await db
      .from("ad_creative_image")
      .select("ad_id")
      .in("ad_id", chunk)
      .not("stored_image_url", "is", null);
    (data || []).forEach((r: { ad_id: string }) => stored.add(r.ad_id));
  }
  return new Set(unique.filter((id) => !stored.has(id)));
}

// Returns the stored public URL for an ad, downloading + storing the image if we
// don't have it yet. Best-effort: a dead/expired source URL, a video creative, or
// any failure simply returns null and leaves the ad unstored so the next sync
// (with a fresh URL) can retry. `force` re-downloads even if already stored.
export async function getOrStoreCreativeImage(
  input: StoreImageInput,
  opts: { force?: boolean } = {}
): Promise<string | null> {
  const db = getServiceSupabase();
  const adId = String(input.adId || "").trim();
  if (!adId) return null;
  const imageUrl = String(input.imageUrl || "").trim();

  if (!opts.force) {
    const { data: existing } = await db
      .from("ad_creative_image")
      .select("stored_image_url")
      .eq("ad_id", adId)
      .maybeSingle();
    if (existing?.stored_image_url) return existing.stored_image_url as string;
  }
  if (!imageUrl) return null;

  let res: Response;
  try {
    res = await fetch(imageUrl);
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const contentType = (res.headers.get("content-type") || "image/jpeg")
    .split(";")[0]
    .trim()
    .toLowerCase();
  // Only store real still images. A video creative has no single frame here.
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;

  try {
    await ensureBucket(db);
    const path = `${adId}.${ext}`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, buf, {
      contentType,
      cacheControl: "31536000",
      upsert: true,
    });
    if (upErr) return null;
    const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
    const storedUrl = pub.publicUrl;

    await db.from("ad_creative_image").upsert(
      {
        ad_id: adId,
        client_key: input.clientKey ? String(input.clientKey).trim() : null,
        source_image_url: imageUrl,
        stored_image_url: storedUrl,
        stored_at: new Date().toISOString(),
      },
      { onConflict: "ad_id" }
    );
    return storedUrl;
  } catch {
    return null;
  }
}

// Stores any not-yet-stored images for a batch of ads. Concurrency-bounded so a
// large roster never overwhelms the sync. Returns how many were newly stored.
export async function storeCreativeImagesBatch(inputs: StoreImageInput[]): Promise<number> {
  const todo = inputs.filter((i) => i.adId && i.imageUrl);
  if (todo.length === 0) return 0;

  const unstored = await findUnstoredAdIds(todo.map((i) => i.adId));
  const pending = todo.filter((i) => unstored.has(i.adId));

  let stored = 0;
  for (let i = 0; i < pending.length; i += 6) {
    const chunk = pending.slice(i, i + 6);
    const results = await Promise.allSettled(chunk.map((c) => getOrStoreCreativeImage(c)));
    results.forEach((r) => {
      if (r.status === "fulfilled" && r.value) stored += 1;
    });
  }
  return stored;
}
