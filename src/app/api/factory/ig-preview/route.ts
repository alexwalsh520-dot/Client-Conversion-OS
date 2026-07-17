import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Instant Instagram preview for the Factory canvas. Paste a reel/post link and get back a preview.
// First choice: our OWN scraped content library (creator_content) - if we already have this reel we
// return the stored thumbnail, caption, engagement AND the transcript we already ran, with zero new
// work. Fallback: Instagram's public embed URL, which renders the post in an iframe without any auth.
// No scraping, no tokens - we only read what we already have, and hand back an embed URL otherwise.

// Pull the shortcode out of an instagram.com/p/<code>/ or /reel/<code>/ or /reels/<code>/ URL.
function shortcodeFromUrl(url: string): string | null {
  const m = String(url || "").match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || "";
  const code = shortcodeFromUrl(url);
  if (!code) {
    return NextResponse.json({ ok: false, error: "Not an Instagram post or reel link" }, { status: 200 });
  }
  const embedUrl = `https://www.instagram.com/reel/${code}/embed/captioned/`;

  try {
    const sb = getServiceSupabase();
    // Match the shortcode inside the stored permalink (works for /p/ and /reel/ variants).
    const { data } = await sb
      .from("creator_content")
      .select("client_key, permalink, media_type, caption, thumbnail_url, stored_thumb_url, transcript, transcript_words, transcript_status, play_count, view_count, like_count, comment_count, taken_at")
      .ilike("permalink", `%/${code}/%`)
      .limit(1)
      .maybeSingle();

    if (data) {
      const c = data as Record<string, unknown>;
      const words = Number(c.transcript_words) || 0;
      return NextResponse.json({
        ok: true,
        source: "library",
        shortcode: code,
        permalink: (c.permalink as string) || url,
        embedUrl,
        creator: c.client_key ?? null,
        mediaType: c.media_type ?? null,
        thumbnail: (c.stored_thumb_url as string) || (c.thumbnail_url as string) || null,
        caption: (c.caption as string) || null,
        transcript: c.transcript_status === "done" && words >= 15 ? (c.transcript as string) : null,
        transcriptWords: words,
        reach: (c.play_count as number) ?? (c.view_count as number) ?? null,
        likes: (c.like_count as number) ?? null,
        comments: (c.comment_count as number) ?? null,
        takenAt: c.taken_at ?? null,
      });
    }

    // Not in our library - hand back the embed URL so the card can iframe it.
    return NextResponse.json({ ok: true, source: "embed", shortcode: code, permalink: url, embedUrl });
  } catch (err) {
    // Never fail the card; fall back to the embed.
    return NextResponse.json({ ok: true, source: "embed", shortcode: code, permalink: url, embedUrl, warn: err instanceof Error ? err.message : "lookup failed" });
  }
}
