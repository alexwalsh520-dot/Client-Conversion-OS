// ─────────────────────────────────────────────────────────────────────────
// VIDEO MEDIA SYNC — Meta's video source URLs EXPIRE, so we never store or
// serve the URL. During the background sync (budgeted, resumable, never in a
// request) we resolve each video ad's creative -> video id -> video source,
// DOWNLOAD the high-res thumbnail and the playable video file into our own
// storage, and record the stored URLs on ad_creative_image, keyed by ad_id.
//
// Bounded by construction: a per-run wall-clock budget, a per-run total-bytes
// budget, and a per-file size cap. Active video ads are backfilled first, then
// the newest. Already-stored ads are skipped, so a re-run is cheap. Coverage is
// logged per run. A dead/oversized/permission-blocked source simply records a
// status and moves on; it never throws the sync.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { ACTIVE_CREATORS, firstEnv, normalizeAdAccountId } from "@/lib/creators";
import { startRun, finishRun, type Db } from "./db";

const GRAPH = "https://graph.facebook.com/v21.0";
const VIDEO_BUCKET = "ad-videos";
const THUMB_BUCKET = "ad-creatives";

const RUN_BUDGET_MS = 90_000; // never approach the function ceiling
const RUN_BYTES_BUDGET = 320 * 1024 * 1024; // total download per run
const MAX_VIDEO_BYTES = 45 * 1024 * 1024; // skip anything larger (rare)
const MAX_VIDEOS_PER_RUN = 40;

interface AdCreative {
  id: string;
  name?: string;
  effective_status?: string;
  creative?: {
    id?: string;
    video_id?: string;
    thumbnail_url?: string;
    image_url?: string;
    object_story_spec?: { page_id?: string; video_data?: { video_id?: string; image_url?: string } };
  };
}

let videoBucketReady = false;
async function ensureVideoBucket(db: Db) {
  if (videoBucketReady) return;
  const { data: buckets } = await db.storage.listBuckets();
  if (!buckets?.some((b) => b.name === VIDEO_BUCKET)) {
    const { error } = await db.storage.createBucket(VIDEO_BUCKET, {
      public: true,
      allowedMimeTypes: ["video/mp4"],
      fileSizeLimit: MAX_VIDEO_BYTES,
    });
    if (error && !error.message.toLowerCase().includes("already")) {
      throw new Error(`create ${VIDEO_BUCKET}: ${error.message}`);
    }
  }
  videoBucketReady = true;
}

async function graphPage(url: string): Promise<{ data: AdCreative[]; next?: string }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Meta ads fetch ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data?: AdCreative[]; paging?: { next?: string } };
  return { data: json.data || [], next: json.paging?.next };
}

function videoIdOf(ad: AdCreative): string | null {
  return (
    ad.creative?.video_id ||
    ad.creative?.object_story_spec?.video_data?.video_id ||
    null
  );
}

function pageIdOf(ad: AdCreative): string | null {
  return ad.creative?.object_story_spec?.page_id || null;
}

// The ads token can read `source` ONLY for videos uploaded to the ad account's
// own library. Every real creator ad is built from a PAGE video (IG DM funnel),
// and Meta silently omits `source` for those — the reason the cache sat at
// "no_source" for every video ad. The page's own token CAN read it, and a
// system-user ads token with the page as an owned asset can mint one. So:
// try the ads token, then fall back to a derived page token.
const pageTokenCache = new Map<string, string | null>();

async function getPageToken(pageId: string, adsToken: string): Promise<string | null> {
  const hit = pageTokenCache.get(pageId);
  if (hit !== undefined) return hit;
  let token: string | null = null;
  try {
    const res = await fetch(`${GRAPH}/${pageId}?fields=access_token&access_token=${adsToken}`, { cache: "no-store" });
    if (res.ok) token = ((await res.json()) as { access_token?: string }).access_token || null;
  } catch {
    token = null;
  }
  pageTokenCache.set(pageId, token);
  return token;
}

// Old creatives sometimes carry a bare video_id with no object_story_spec, so
// there is no page_id to derive a token from. The token's own page list
// (me/accounts) names every page it manages — for a creator system user that
// is exactly their page — so those are tried too.
const tokenPagesCache = new Map<string, string[]>();

async function getManagedPageIds(adsToken: string): Promise<string[]> {
  const hit = tokenPagesCache.get(adsToken);
  if (hit !== undefined) return hit;
  let ids: string[] = [];
  try {
    const res = await fetch(`${GRAPH}/me/accounts?fields=id&limit=25&access_token=${adsToken}`, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { data?: { id: string }[] };
      ids = (json.data || []).map((p) => p.id);
    }
  } catch {
    ids = [];
  }
  tokenPagesCache.set(adsToken, ids);
  return ids;
}

async function fetchVideoFields(videoId: string, token: string): Promise<{ source?: string; picture?: string } | null> {
  try {
    const res = await fetch(`${GRAPH}/${videoId}?fields=source,picture&access_token=${token}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { source?: string; picture?: string };
  } catch {
    return null;
  }
}

async function resolveVideoSource(
  videoId: string,
  token: string,
  pageId?: string | null,
): Promise<{ source?: string; picture?: string } | null> {
  const direct = await fetchVideoFields(videoId, token);
  if (direct?.source) return direct;
  const candidates = pageId ? [pageId] : [];
  for (const managed of await getManagedPageIds(token)) {
    if (!candidates.includes(managed)) candidates.push(managed);
  }
  for (const candidate of candidates) {
    const pageToken = await getPageToken(candidate, token);
    if (!pageToken) continue;
    const viaPage = await fetchVideoFields(videoId, pageToken);
    if (viaPage?.source) return { source: viaPage.source, picture: viaPage.picture || direct?.picture };
  }
  return direct;
}

interface MediaResult {
  clients: string[];
  videosStored: number;
  thumbsStored: number;
  scanned: number;
  skippedAlready: number;
  bytes: number;
  budgetHit: boolean;
  perClient: Record<string, { videoAds: number; stored: number }>;
}

export async function runMediaSync(now: Date = new Date()): Promise<MediaResult> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "media");
  const started = Date.now();
  const result: MediaResult = {
    clients: [],
    videosStored: 0,
    thumbsStored: 0,
    scanned: 0,
    skippedAlready: 0,
    bytes: 0,
    budgetHit: false,
    perClient: {},
  };

  try {
    for (const creator of ACTIVE_CREATORS) {
      const token = firstEnv(creator.tokenEnv);
      const account = firstEnv(creator.adAccountEnv) || creator.defaultAdAccountId;
      if (!token || !account) continue;
      result.clients.push(creator.key);
      result.perClient[creator.key] = { videoAds: 0, stored: 0 };

      // Which of this client's ads already have a stored video (skip those).
      const { data: storedRows } = await db
        .from("ad_creative_image")
        .select("ad_id")
        .eq("client_key", creator.key)
        .not("stored_video_url", "is", null);
      const alreadyStored = new Set((storedRows || []).map((r: { ad_id: string }) => r.ad_id));

      const acct = normalizeAdAccountId(account);
      const fields =
        "id,name,effective_status,creative{id,video_id,thumbnail_url,image_url,object_story_spec{page_id,video_data{video_id,image_url}}}";
      // Active ads first (backfill priority), then everything (newest-first per
      // Meta's default order).
      const passes = [
        `${GRAPH}/${acct}/ads?fields=${fields}&effective_status=["ACTIVE"]&limit=200&access_token=${token}`,
        `${GRAPH}/${acct}/ads?fields=${fields}&limit=200&access_token=${token}`,
      ];

      for (const startUrl of passes) {
        let url: string | undefined = startUrl;
        for (let page = 0; page < 20 && url; page++) {
          if (Date.now() - started > RUN_BUDGET_MS || result.bytes > RUN_BYTES_BUDGET) {
            result.budgetHit = true;
            break;
          }
          let pageData: { data: AdCreative[]; next?: string };
          try {
            pageData = await graphPage(url);
          } catch {
            break; // this pass failed for this client; move on
          }
          for (const ad of pageData.data) {
            const vid = videoIdOf(ad);
            if (!vid) continue;
            result.perClient[creator.key].videoAds += 1;
            if (alreadyStored.has(ad.id)) {
              result.skippedAlready += 1;
              continue;
            }
            if (
              result.videosStored >= MAX_VIDEOS_PER_RUN ||
              Date.now() - started > RUN_BUDGET_MS ||
              result.bytes > RUN_BYTES_BUDGET
            ) {
              result.budgetHit = true;
              break;
            }
            result.scanned += 1;
            await storeOneVideoAd(db, creator.key, ad, vid, token, result);
            alreadyStored.add(ad.id);
          }
          if (result.budgetHit) break;
          url = pageData.next;
        }
        if (result.budgetHit) break;
      }
      if (result.budgetHit) break;
    }

    await finishRun(db, runId, {
      status: "ok",
      rows: result.videosStored,
      durationMs: Date.now() - started,
      detail: result,
    });
    return result;
  } catch (err) {
    await finishRun(db, runId, {
      status: "error",
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function storeOneVideoAd(
  db: Db,
  clientKey: string,
  ad: AdCreative,
  videoId: string,
  token: string,
  result: MediaResult,
): Promise<void> {
  const src = await resolveVideoSource(videoId, token, pageIdOf(ad));
  const thumbUrl = src?.picture || ad.creative?.thumbnail_url || ad.creative?.image_url || null;

  // High-res thumbnail (small, always try).
  let storedThumb: string | null = null;
  if (thumbUrl) storedThumb = await downloadThumb(db, ad.id, thumbUrl, result);

  // The playable video file (chunk-streamed with size guard).
  let storedVideo: string | null = null;
  let status = "no_source";
  if (src?.source) {
    const out = await downloadVideo(db, ad.id, src.source, result);
    storedVideo = out.url;
    status = out.status;
  }

  await db.from("ad_creative_image").upsert(
    {
      ad_id: ad.id,
      client_key: clientKey,
      is_video: true,
      video_id: videoId,
      stored_thumb_url: storedThumb,
      stored_video_url: storedVideo,
      media_synced_at: new Date().toISOString(),
      media_status: status,
    },
    { onConflict: "ad_id" },
  );
  if (storedVideo) {
    result.videosStored += 1;
    result.perClient[clientKey].stored += 1;
  }
  if (storedThumb) result.thumbsStored += 1;
}

// ─────────────────────────────────────────────────────────────────────────
// ON-DEMAND RESOLUTION — the hover card's guarantee that play always works.
// Stored copy first (our storage, never expires). If the video isn't stored
// yet (new ad, oversized file, sync lag) resolve a FRESH source URL from Meta
// right now and hand that back for immediate playback; the caller kicks off a
// background store so the next play is served from our storage.
// ─────────────────────────────────────────────────────────────────────────

export interface OnDemandMedia {
  isVideo: boolean;
  /** Playable right now: stored copy when we have one, else a fresh Meta source. */
  videoUrl: string | null;
  thumbUrl: string | null;
  /** Where videoUrl came from; "meta" means fresh + not yet stored. */
  source: "stored" | "meta" | "none";
}

interface MediaRow {
  client_key: string | null;
  is_video: boolean | null;
  video_id: string | null;
  stored_video_url: string | null;
  stored_thumb_url: string | null;
  stored_image_url: string | null;
}

async function fetchAdCreative(adId: string, token: string): Promise<AdCreative | null> {
  try {
    const fields =
      "creative{video_id,thumbnail_url,image_url,object_story_spec{page_id,video_data{video_id,image_url}}}";
    const res = await fetch(`${GRAPH}/${adId}?fields=${fields}&access_token=${token}`, { cache: "no-store" });
    if (!res.ok) return null;
    const ad = (await res.json()) as AdCreative;
    ad.id = adId;
    return ad;
  } catch {
    return null;
  }
}

export async function resolveAdMediaNow(
  adId: string,
  opts: { clientKeyHint?: string; skipStored?: boolean } = {},
): Promise<OnDemandMedia> {
  const db = getServiceSupabase();
  const { data } = await db
    .from("ad_creative_image")
    .select("client_key,is_video,video_id,stored_video_url,stored_thumb_url,stored_image_url")
    .eq("ad_id", adId)
    .maybeSingle();
  const row = (data as MediaRow | null) || null;
  const thumb = row?.stored_thumb_url || row?.stored_image_url || null;

  if (!opts.skipStored && row?.stored_video_url) {
    return { isVideo: true, videoUrl: row.stored_video_url, thumbUrl: thumb, source: "stored" };
  }

  const clientKey = row?.client_key || opts.clientKeyHint || null;
  const creator = ACTIVE_CREATORS.find((c) => c.key === clientKey);
  const token = creator ? firstEnv(creator.tokenEnv) : null;
  if (!token) {
    // No token to ask Meta with; the stored copy (if any) is all we have.
    return {
      isVideo: Boolean(row?.is_video),
      videoUrl: row?.stored_video_url || null,
      thumbUrl: thumb,
      source: row?.stored_video_url ? "stored" : "none",
    };
  }

  // The creative fetch also carries page_id, which unlocks `source` for
  // page-owned videos (every real creator ad) via a derived page token.
  const ad = await fetchAdCreative(adId, token);
  const videoId = row?.video_id || (ad ? videoIdOf(ad) : null);
  if (!videoId) return { isVideo: Boolean(row?.is_video), videoUrl: null, thumbUrl: thumb, source: "none" };

  const src = await resolveVideoSource(videoId, token, ad ? pageIdOf(ad) : null);
  return {
    isVideo: true,
    videoUrl: src?.source || null,
    thumbUrl: src?.picture || thumb,
    source: src?.source ? "meta" : "none",
  };
}

/**
 * Best-effort background store of one ad's video + thumb into our storage
 * (fire-and-forget from the on-demand route via `after()`). Never throws.
 */
export async function storeAdVideoInBackground(adId: string, clientKeyHint?: string): Promise<void> {
  try {
    const db = getServiceSupabase();
    const { data } = await db
      .from("ad_creative_image")
      .select("client_key,video_id,stored_video_url")
      .eq("ad_id", adId)
      .maybeSingle();
    const row = (data as Pick<MediaRow, "client_key" | "video_id" | "stored_video_url"> | null) || null;
    if (row?.stored_video_url) return; // already stored
    const clientKey = row?.client_key || clientKeyHint || null;
    const creator = ACTIVE_CREATORS.find((c) => c.key === clientKey);
    const token = creator ? firstEnv(creator.tokenEnv) : null;
    if (!token || !creator) return;
    const ad = await fetchAdCreative(adId, token);
    const videoId = row?.video_id || (ad ? videoIdOf(ad) : null);
    if (!videoId) return;
    const result: MediaResult = {
      clients: [],
      videosStored: 0,
      thumbsStored: 0,
      scanned: 0,
      skippedAlready: 0,
      bytes: 0,
      budgetHit: false,
      perClient: { [creator.key]: { videoAds: 0, stored: 0 } },
    };
    await storeOneVideoAd(db, creator.key, ad || { id: adId }, videoId, token, result);
  } catch {
    // Background convenience only; the fresh Meta URL already served playback.
  }
}

async function downloadThumb(db: Db, adId: string, url: string, result: MediaResult): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim().toLowerCase();
    const ext = ct.includes("png") ? "png" : "jpg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > 5 * 1024 * 1024) return null;
    result.bytes += buf.byteLength;
    const path = `${adId}-vthumb.${ext}`;
    const { error } = await db.storage.from(THUMB_BUCKET).upload(path, buf, {
      contentType: ct,
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) return null;
    return db.storage.from(THUMB_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

async function downloadVideo(
  db: Db,
  adId: string,
  url: string,
  result: MediaResult,
): Promise<{ url: string | null; status: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok || !res.body) return { url: null, status: `fetch_${res.status}` };
    // Reject oversized up front when the server declares a length.
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_VIDEO_BYTES) return { url: null, status: "too_large" };

    // Stream in chunks with a hard cap, so one bad file can never blow memory.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_VIDEO_BYTES) {
          await reader.cancel();
          return { url: null, status: "too_large" };
        }
        chunks.push(value);
      }
    }
    if (!total) return { url: null, status: "empty" };
    result.bytes += total;
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));

    await ensureVideoBucket(db);
    const path = `${adId}.mp4`;
    const { error } = await db.storage.from(VIDEO_BUCKET).upload(path, buf, {
      contentType: "video/mp4",
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) return { url: null, status: `upload_${error.message.slice(0, 40)}` };
    return { url: db.storage.from(VIDEO_BUCKET).getPublicUrl(path).data.publicUrl, status: "stored" };
  } catch {
    return { url: null, status: "error" };
  }
}
