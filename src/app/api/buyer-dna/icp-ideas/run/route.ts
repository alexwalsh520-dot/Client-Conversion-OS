import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getCurrentIcp } from "@/lib/buyer-dna/icp";
import type { Icp } from "@/lib/buyer-dna/icp";
import { getCurrentTrendBrief } from "@/lib/buyer-dna/trends";
import { generateIcpIdeas, gradeIdeaSet } from "@/lib/buyer-dna/video-ideas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

// Regenerate the ICP-wide 10-idea set (weekly, after the ICP + trend brief refresh) and grade it
// against the current trend brief.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const slug = (url.searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });

  const sb = getServiceSupabase();
  const current = await getCurrentIcp(sb, slug);
  if (!current) return NextResponse.json({ ok: false, creator: slug, reason: "No locked ICP yet. Generate the ICP first." });
  const icp = (current as { icp: Icp }).icp;
  const icpVersion = Number((current as { version: number }).version);

  // Keep the build (+ its one retry) and the grade within the 300s ceiling; ~100s headroom per op.
  const start = Date.now();
  const canProceed = () => Date.now() - start + 100_000 < 290_000;

  const anthropic = new Anthropic();
  const res = await generateIcpIdeas(sb, slug, icp, icpVersion, anthropic, { canProceed });
  if (res !== "built") return NextResponse.json({ ok: false, creator: slug, reason: "Idea generation failed (is the migration applied?)." });

  let graded = false;
  const brief = await getCurrentTrendBrief(sb, slug);
  if (brief && canProceed()) graded = (await gradeIdeaSet(sb, slug, null, brief.brief, brief.version, anthropic, { canProceed })) === "graded";

  return NextResponse.json({ ok: true, creator: slug, icp_version: icpVersion, graded });
}
