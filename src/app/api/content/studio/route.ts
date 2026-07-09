import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One payload that powers the whole Creator Content Studio (My Content, Trends, Coach).
// Access: operator session (?creator=) OR a valid share token (?token=). Never trust a client
// creator slug when a token is used; the creator is derived from the token. No dollar amounts ever.
type PostRow = {
  ig_media_id: string; permalink: string | null; media_type: string | null; caption: string | null;
  transcript: string | null; thumbnail_url: string | null; stored_thumb_url: string | null;
  video_url: string | null; stored_video_url: string | null; taken_at: string | null;
  like_count: number | null; comment_count: number | null; view_count: number | null;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const sb = getServiceSupabase();

  // Resolve creator + viewer role from token or session.
  let creator = "";
  let viewer: "operator" | "creator" = "operator";
  if (token) {
    const { data: link } = await sb
      .from("public_share_links")
      .select("client_key, revoked, kind")
      .eq("token", token)
      .maybeSingle();
    if (!link || (link as { revoked: boolean }).revoked || (link as { kind: string }).kind !== "content") {
      return NextResponse.json({ error: "Invalid or revoked link" }, { status: 403 });
    }
    creator = String((link as { client_key: string }).client_key).toLowerCase();
    viewer = "creator";
  } else {
    const s = await auth().catch(() => null);
    if (!s?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    creator = (url.searchParams.get("creator") || "tyson").toLowerCase();
  }
  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  }

  const [postsRes, gradesRes, snapsRes, anglesRes, dossiersRes, vocRes, icpRes] = await Promise.all([
    sb.from("creator_content")
      .select("ig_media_id, permalink, media_type, caption, transcript, thumbnail_url, stored_thumb_url, video_url, stored_video_url, taken_at, like_count, comment_count, view_count")
      .eq("client_key", creator).order("taken_at", { ascending: false }).limit(700),
    sb.from("content_grades").select("ig_media_id, score, band, hits, misses, feedback, verdict").eq("client_key", creator),
    sb.from("creator_account_snapshots").select("snapshot_date, followers_count").eq("client_key", creator).order("snapshot_date", { ascending: true }).limit(400),
    sb.from("buyer_content_angles").select("title, hook, rationale").eq("client_key", creator).order("sort_order", { ascending: true }).limit(30),
    sb.from("buyer_dossiers").select("display_name, close_date, first_keyword, research, data_completeness").eq("client_key", creator).order("close_date", { ascending: false }).limit(120),
    sb.from("content_voc").select("bucket, quote").eq("client_key", creator).limit(400),
    sb.from("creator_icp").select("icp, mode, version").eq("client_key", creator).eq("locked", true).order("version", { ascending: false }).limit(1),
  ]);

  const gradeMap = new Map((gradesRes.data || []).map((g) => [(g as { ig_media_id: string }).ig_media_id, g]));
  const posts = ((postsRes.data || []) as PostRow[]).map((p) => {
    const g = gradeMap.get(p.ig_media_id) as { score: number; band: string; hits: string[]; misses: string[]; feedback: string; verdict: string } | undefined;
    return {
      id: p.ig_media_id,
      permalink: p.permalink,
      media_type: p.media_type,
      caption: p.caption,
      transcript: p.transcript,
      thumb: p.stored_thumb_url || p.thumbnail_url || null,
      video: p.stored_video_url || p.video_url || null,
      taken_at: p.taken_at,
      likes: Number(p.like_count) || 0,
      comments: Number(p.comment_count) || 0,
      views: Number(p.view_count) || 0,
      score: g ? g.score : null,
      band: g ? g.band : null,
      hits: g?.hits || [],
      misses: g?.misses || [],
      feedback: g?.feedback || null,
      verdict: g?.verdict || null,
    };
  });

  // Scoreboard (from scored posts, newest first by taken_at).
  const scored = posts.filter((p) => p.score != null).sort((a, b) => (b.taken_at || "").localeCompare(a.taken_at || ""));
  let streak = 0;
  for (const p of scored) { if ((p.score as number) >= 70) streak++; else break; }
  const now = Date.now();
  const within = (p: typeof posts[number], days: number) => p.taken_at && now - new Date(p.taken_at).getTime() <= days * 86_400_000;
  const last30 = scored.filter((p) => within(p, 30));
  const prev30 = scored.filter((p) => p.taken_at && now - new Date(p.taken_at).getTime() > 30 * 86_400_000 && now - new Date(p.taken_at).getTime() <= 60 * 86_400_000);
  const avg = (arr: typeof posts) => (arr.length ? Math.round(arr.reduce((s, p) => s + (p.score as number), 0) / arr.length) : null);
  const monthStart = new Date(new Date().toISOString().slice(0, 7) + "-01").getTime();
  const thisMonth = scored.filter((p) => p.taken_at && new Date(p.taken_at).getTime() >= monthStart);

  const voc: Record<string, string[]> = {};
  for (const q of vocRes.data || []) {
    const b = (q as { bucket: string }).bucket;
    (voc[b] ||= []).push((q as { quote: string }).quote);
  }
  for (const b of Object.keys(voc)) voc[b] = voc[b].slice(0, 8);

  const icpRow = icpRes.data && icpRes.data[0] ? (icpRes.data[0] as { icp: Record<string, unknown>; mode: string }) : null;
  const dossiers = (dossiersRes.data || [])
    .filter((d) => (d as { research: Record<string, unknown> }).research && Object.keys((d as { research: Record<string, unknown> }).research).length)
    .map((d) => ({
      name: (d as { display_name: string }).display_name,
      keyword: (d as { first_keyword: string }).first_keyword,
      research: (d as { research: Record<string, unknown> }).research, // no amount fields are selected
    }));

  return NextResponse.json({
    creator,
    viewer,
    icp: icpRow ? { ...icpRow.icp, mode: icpRow.mode } : null,
    posts,
    snapshots: (snapsRes.data || []).map((s) => ({ date: (s as { snapshot_date: string }).snapshot_date, followers: Number((s as { followers_count: number }).followers_count) || 0 })),
    angles: anglesRes.data || [],
    dossiers,
    voc,
    scoreboard: {
      streak,
      avg30: avg(last30),
      prevAvg30: avg(prev30),
      best: scored.length ? Math.max(...scored.map((p) => p.score as number)) : null,
      onTarget30: last30.filter((p) => (p.score as number) >= 70).length,
      onTargetMonth: thisMonth.filter((p) => (p.score as number) >= 70).length,
      totalScored: scored.length,
      totalPosts: posts.length,
    },
  });
}
