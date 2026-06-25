// Instagram content ingestion — pulls a creator's reels/posts via their connected
// Instagram-Login token (the same connection that powers DMs) and stores them in
// `creator_content`. Runs SERVER-SIDE only (the token-decryption key is a Vercel
// sensitive var injected at runtime). No Apify, no extra cost — Meta's own Graph API.
//
// Scope note: the connections currently hold `instagram_business_basic`, which returns
// caption / media / like_count / comments_count / permalink / timestamp. View / play
// counts need `instagram_business_manage_insights` (a re-auth) and are fetched best-effort.
import { getServiceSupabase } from "@/lib/supabase";
import { getDecryptedTokenForClient } from "@/lib/instagram-connections";

const GRAPH = "https://graph.instagram.com/v21.0";

// Active creators only (Alex 2026-06-25: ONLY Tyson + Antwan are clients).
// Keyed by the short creator key; the IG connection row is looked up by client_slug.
export const CONTENT_CREATORS = ["tyson", "antwan"] as const;
export type ContentCreator = (typeof CONTENT_CREATORS)[number];

interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

async function getConnection(slug: string) {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("instagram_connections")
    .select("client_key, client_slug, instagram_username, instagram_user_id, status")
    .eq("client_slug", slug)
    .maybeSingle();
  return data;
}

/** Fetch one creator's media list (paginated) from the Instagram Graph API. */
async function fetchAllMedia(token: string, maxPages = 12): Promise<IgMedia[]> {
  const fields =
    "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count";
  let url: string | null = `${GRAPH}/me/media?fields=${fields}&limit=50&access_token=${token}`;
  const out: IgMedia[] = [];
  for (let page = 0; page < maxPages && url; page++) {
    const res: Response = await fetch(url, { cache: "no-store" });
    const json: { data?: IgMedia[]; paging?: { next?: string }; error?: { message?: string } } = await res.json();
    if (json.error) {
      throw new Error(`IG media fetch failed: ${json.error.message || JSON.stringify(json.error)}`);
    }
    for (const m of json.data || []) out.push(m as IgMedia);
    url = json.paging?.next || null;
  }
  return out;
}

const WORD_RE = /[a-z']{3,}/g;
const STOP = new Set(
  "the and for you your with that this have are was but not from they will all can get how out who why one two get got like just now new our out can't don't your you're".split(/\s+/)
);
function countWords(text: string): number {
  const m = (text || "").toLowerCase().match(WORD_RE);
  return m ? m.filter((w) => !STOP.has(w)).length : 0;
}

export interface IngestResult {
  creator: string;
  ok: boolean;
  pulled: number;
  upserted: number;
  error?: string;
}

/** Pull + upsert all media for one creator. Returns a small summary. */
export async function ingestCreatorContent(slug: ContentCreator): Promise<IngestResult> {
  try {
    const conn = await getConnection(slug);
    if (!conn || conn.status !== "connected") {
      return { creator: slug, ok: false, pulled: 0, upserted: 0, error: "no connected IG account" };
    }
    const token = await getDecryptedTokenForClient(conn.client_key as string);
    if (!token) return { creator: slug, ok: false, pulled: 0, upserted: 0, error: "token decrypt failed" };

    const media = await fetchAllMedia(token);
    const rows = media.map((m) => ({
      client_key: slug,
      ig_media_id: m.id,
      media_type: m.media_product_type || m.media_type || null,
      permalink: m.permalink || null,
      caption: m.caption || null,
      thumbnail_url: m.thumbnail_url || m.media_url || null,
      video_url: m.media_type === "VIDEO" ? m.media_url || null : null,
      like_count: typeof m.like_count === "number" ? m.like_count : null,
      comment_count: typeof m.comments_count === "number" ? m.comments_count : null,
      taken_at: m.timestamp || null,
      transcript_words: m.caption ? countWords(m.caption) : 0,
      raw: m as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    }));

    const sb = getServiceSupabase();
    let upserted = 0;
    // Chunked upsert so a large back-catalog doesn't blow the request size.
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await sb
        .from("creator_content")
        .upsert(chunk, { onConflict: "client_key,ig_media_id", ignoreDuplicates: false });
      if (error) throw new Error(`upsert failed: ${error.message}`);
      upserted += chunk.length;
    }
    return { creator: slug, ok: true, pulled: media.length, upserted };
  } catch (e) {
    return { creator: slug, ok: false, pulled: 0, upserted: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ingest every active creator. */
export async function ingestAllContent(): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const c of CONTENT_CREATORS) results.push(await ingestCreatorContent(c));
  return results;
}
