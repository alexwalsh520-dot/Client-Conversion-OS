import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getCurrentIcp } from "@/lib/buyer-dna/icp";
import { gradePost } from "@/lib/buyer-dna/grade";
import type { Icp } from "@/lib/buyer-dna/icp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const slug = (url.searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  const limit = Math.min(Number(url.searchParams.get("limit") || 15), 30);

  const sb = getServiceSupabase();
  const current = await getCurrentIcp(sb, slug);
  if (!current) return NextResponse.json({ ok: false, error: "No locked ICP yet. Generate the ICP first." }, { status: 400 });
  const icp = (current as { icp: Icp }).icp;
  const icpVersion = (current as { version: number }).version;

  // Posts worth grading: has a caption or a finished transcript.
  const { data: posts } = await sb
    .from("creator_content")
    .select("ig_media_id, caption, transcript, transcript_status, like_count, comment_count")
    .eq("client_key", slug)
    .order("taken_at", { ascending: false })
    .limit(400);

  // Grade on real content only. Reels are video-first: the message is in the transcript, so a post
  // with an empty caption and no transcript yet gets skipped (grading it would unfairly score the
  // silence, not the content). Grade once the transcript exists, or when the caption is substantial.
  const gradable = (posts || []).filter((p) => {
    const cap = String((p as { caption: string }).caption || "");
    const tr = String((p as { transcript: string }).transcript || "");
    const status = String((p as { transcript_status: string }).transcript_status || "");
    return (status === "done" && tr.length > 120) || cap.length > 220;
  });

  const { data: graded } = await sb
    .from("content_grades")
    .select("ig_media_id")
    .eq("client_key", slug)
    .eq("icp_version", icpVersion);
  const done = new Set((graded || []).map((g) => (g as { ig_media_id: string }).ig_media_id));

  const todo = gradable.filter((p) => !done.has((p as { ig_media_id: string }).ig_media_id));
  const batch = todo.slice(0, limit);

  const anthropic = new Anthropic();
  let ok = 0, errored = 0;
  for (const p of batch) {
    const res = await gradePost(
      sb,
      slug,
      {
        ig_media_id: (p as { ig_media_id: string }).ig_media_id,
        caption: (p as { caption: string }).caption || null,
        transcript: (p as { transcript: string }).transcript || null,
      },
      icp,
      icpVersion,
      anthropic,
    );
    if (res === "graded") ok++;
    else errored++;
  }

  const remaining = todo.length - batch.length;
  return NextResponse.json({
    ok: true,
    creator: slug,
    icp_version: icpVersion,
    graded: ok,
    errored,
    remaining,
    note: remaining ? `Run again, ${remaining} posts left to grade.` : "All posts graded against the current ICP.",
  });
}
