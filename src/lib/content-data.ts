// Shared content read layer — used by the authed /api/content route AND the public
// /p/content/[token] page, so both render identical data with one source of truth.
import { getServiceSupabase } from "@/lib/supabase";

export interface ContentReel {
  id: string;
  ig_media_id: string | null;
  media_type: string | null;
  permalink: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  like_count: number | null;
  comment_count: number | null;
  taken_at: string | null;
  transcript: string | null;
  transcript_status: string;
}

export interface ContentIdea {
  id: string;
  title: string;
  angle: string | null;
  hook: string | null;
  evidence: string | null;
  source: string | null;
  status: string;
  created_at: string;
}

export interface WordStat { word: string; count: number }

export interface CreatorContent {
  creator: string;
  name: string;
  reels: ContentReel[];
  ideas: ContentIdea[];
  words: WordStat[];
  summary: {
    posts: number;
    totalLikes: number;
    totalComments: number;
    avgLikes: number;
    avgComments: number;
    transcribed: number;
    withCaption: number;
    firstAt: string | null;
    lastAt: string | null;
  };
}

const NAMES: Record<string, string> = { tyson: "Tyson", antwan: "Antwan" };

const STOP = new Set(
  ("a an and the of to in is it for you your with that this have are was but not from they will all can get how out who why one two new our out i im i'm me my we us so do does did just now like then than them their there here what when where which while have has had been being would could should youre you're dont don't really thing things lot get got want need make made go going gonna let lets let's about into over your you yall y'all every most more some any his her him she he them they're were also because been being doing said say says see seen look looking come comes came take takes day days time way ways people person").split(/\s+/)
);

function topWords(texts: string[], limit = 50): WordStat[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const toks = (t || "").toLowerCase().match(/[a-z][a-z']{2,}/g) || [];
    for (const w of toks) {
      if (STOP.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .filter((w) => w.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getContentForCreator(slug: string): Promise<CreatorContent> {
  const sb = getServiceSupabase();
  const [{ data: reelRows }, { data: ideaRows }] = await Promise.all([
    sb
      .from("creator_content")
      .select(
        "id, ig_media_id, media_type, permalink, caption, thumbnail_url, video_url, like_count, comment_count, taken_at, transcript, transcript_status"
      )
      .eq("client_key", slug)
      .order("taken_at", { ascending: false, nullsFirst: false }),
    sb
      .from("content_ideas")
      .select("id, title, angle, hook, evidence, source, status, created_at")
      .eq("client_key", slug)
      .neq("status", "dismissed")
      .order("created_at", { ascending: false }),
  ]);

  const reels = (reelRows || []) as ContentReel[];
  const ideas = (ideaRows || []) as ContentIdea[];

  const texts = reels.map((r) => [r.caption || "", r.transcript || ""].join(" "));
  const words = topWords(texts);

  const posts = reels.length;
  const totalLikes = reels.reduce((s, r) => s + (r.like_count || 0), 0);
  const totalComments = reels.reduce((s, r) => s + (r.comment_count || 0), 0);
  const transcribed = reels.filter((r) => r.transcript_status === "done" && r.transcript).length;
  const withCaption = reels.filter((r) => (r.caption || "").trim().length > 0).length;
  const dates = reels.map((r) => r.taken_at).filter(Boolean) as string[];

  return {
    creator: slug,
    name: NAMES[slug] || slug,
    reels,
    ideas,
    words,
    summary: {
      posts,
      totalLikes,
      totalComments,
      avgLikes: posts ? Math.round(totalLikes / posts) : 0,
      avgComments: posts ? Math.round(totalComments / posts) : 0,
      transcribed,
      withCaption,
      firstAt: dates.length ? dates[dates.length - 1] : null,
      lastAt: dates.length ? dates[0] : null,
    },
  };
}

/** Resolve a public share token -> creator slug (content kind only). */
export async function resolveContentToken(token: string): Promise<string | null> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("public_share_links")
    .select("client_key, kind, revoked")
    .eq("token", token)
    .maybeSingle();
  if (!data || data.revoked || data.kind !== "content") return null;
  return (data.client_key as string) || null;
}
