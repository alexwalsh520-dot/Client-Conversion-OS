import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getCurrentIcp } from "@/lib/buyer-dna/icp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read surface for the Buyers view: the locked ICP, the buyer dossiers, the buyer-derived angles,
// and grade coverage for the current ICP.
export async function GET(req: NextRequest) {
  const s = await auth().catch(() => null);
  if (!s?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const slug = (url.searchParams.get("creator") || "tyson").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });

  const sb = getServiceSupabase();
  const current = await getCurrentIcp(sb, slug);
  const icpVersion = current ? (current as { version: number }).version : null;

  const [dossiersRes, anglesRes, gradesRes] = await Promise.all([
    sb
      .from("buyer_dossiers")
      .select("person_key, display_name, close_date, amount_cents, first_keyword, ad_on_image_text, data_completeness, research")
      .eq("client_key", slug)
      .order("close_date", { ascending: false })
      .limit(300),
    sb.from("buyer_content_angles").select("*").eq("client_key", slug).order("sort_order", { ascending: true }).limit(60),
    icpVersion != null
      ? sb.from("content_grades").select("ig_media_id, score, band, hits, misses, feedback, verdict").eq("client_key", slug).eq("icp_version", icpVersion)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const dossiers = (dossiersRes.data || []) as Array<{ research?: Record<string, unknown> }>;
  const withResearch = dossiers.filter((d) => d.research && Object.keys(d.research).length > 0);

  // Enrich each grade with its post so the UI can show which reel it is.
  let grades = (gradesRes.data || []) as Array<{ ig_media_id: string } & Record<string, unknown>>;
  if (grades.length) {
    const ids = grades.map((g) => g.ig_media_id);
    const { data: posts } = await sb
      .from("creator_content")
      .select("ig_media_id, caption, permalink, thumbnail_url, stored_thumb_url, like_count, comment_count")
      .eq("client_key", slug)
      .in("ig_media_id", ids);
    const pm = new Map((posts || []).map((p) => [(p as { ig_media_id: string }).ig_media_id, p]));
    grades = grades.map((g) => ({ ...g, post: pm.get(g.ig_media_id) || null }));
  }

  return NextResponse.json({
    creator: slug,
    icp: current || null,
    counts: {
      dossiers: dossiers.length,
      researched: withResearch.length,
      graded: grades.length,
    },
    dossiers,
    angles: anglesRes.data || [],
    grades,
  });
}
