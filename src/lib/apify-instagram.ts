// Apify-based Instagram ingestion — the FALLBACK when a creator's IG Graph token
// is dead/expired (e.g. Tyson). Scrapes the public profile's posts/reels via the
// apify/instagram-scraper actor and upserts into `creator_content` in the exact
// same shape as the Graph path (instagram-content.ts), so transcribe + mine just work.
//
// Cost: instagram-scraper bills ~$2.30 per 1,000 results. At resultsLimit 300 that's
// well under $1 per full pull. Server-side only (uses APIFY_API_TOKEN).
import { getServiceSupabase } from "@/lib/supabase";
import type { ContentCreator, IngestResult } from "@/lib/instagram-content";

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR = "apify~instagram-scraper";

const WORD_RE = /[a-z']{3,}/g;
const STOP = new Set(
  "the and for you your with that this have are was but not from they will all can get how out who why one two get got like just now new our out can't don't your you're".split(/\s+/)
);
function countWords(text: string): number {
  const m = (text || "").toLowerCase().match(WORD_RE);
  return m ? m.filter((w) => !STOP.has(w)).length : 0;
}

interface ApifyPost {
  id?: string;
  shortCode?: string;
  type?: string;             // Image | Video | Sidecar
  productType?: string;      // clips (reel) | feed | igtv
  caption?: string;
  url?: string;
  commentsCount?: number;
  likesCount?: number;
  videoViewCount?: number;
  timestamp?: string;
  displayUrl?: string;
  videoUrl?: string;
}

async function getUsername(slug: string): Promise<string | null> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("instagram_connections")
    .select("instagram_username")
    .eq("client_slug", slug)
    .maybeSingle();
  return (data?.instagram_username as string) || null;
}

/** Scrape one creator's posts/reels via Apify and upsert into creator_content. */
export async function ingestViaApify(
  slug: ContentCreator,
  opts: { resultsLimit?: number; username?: string } = {}
): Promise<IngestResult> {
  try {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) return { creator: slug, ok: false, pulled: 0, upserted: 0, error: "APIFY_API_TOKEN not set" };

    const username = opts.username || (await getUsername(slug));
    if (!username) return { creator: slug, ok: false, pulled: 0, upserted: 0, error: "no instagram_username on record" };

    const input = {
      directUrls: [`https://www.instagram.com/${username}/`],
      resultsType: "posts",
      resultsLimit: opts.resultsLimit ?? 300,
      addParentData: false,
    };

    // Run synchronously and get the dataset items back in one call.
    const res = await fetch(
      `${APIFY_BASE}/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { creator: slug, ok: false, pulled: 0, upserted: 0, error: `apify ${res.status}: ${txt.slice(0, 200)}` };
    }
    const items = (await res.json()) as ApifyPost[];
    const posts = Array.isArray(items) ? items.filter((p) => p && (p.id || p.shortCode)) : [];

    const rows = posts.map((m) => {
      const isVideo = (m.type || "").toLowerCase() === "video" || (m.productType || "").toLowerCase() === "clips";
      return {
        client_key: slug,
        ig_media_id: String(m.id || m.shortCode),
        media_type: m.productType === "clips" ? "REELS" : (m.type || null),
        permalink: m.url || (m.shortCode ? `https://www.instagram.com/p/${m.shortCode}/` : null),
        caption: m.caption || null,
        thumbnail_url: m.displayUrl || null,
        video_url: isVideo ? m.videoUrl || null : null,
        like_count: typeof m.likesCount === "number" ? m.likesCount : null,
        comment_count: typeof m.commentsCount === "number" ? m.commentsCount : null,
        taken_at: m.timestamp || null,
        transcript_words: m.caption ? countWords(m.caption) : 0,
        raw: m as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      };
    });

    const sb = getServiceSupabase();
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await sb
        .from("creator_content")
        .upsert(chunk, { onConflict: "client_key,ig_media_id", ignoreDuplicates: false });
      if (error) throw new Error(`upsert failed: ${error.message}`);
      upserted += chunk.length;
    }
    return { creator: slug, ok: true, pulled: posts.length, upserted };
  } catch (e) {
    return { creator: slug, ok: false, pulled: 0, upserted: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
