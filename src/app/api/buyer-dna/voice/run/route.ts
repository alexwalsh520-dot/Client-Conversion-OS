import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getCurrentIcp } from "@/lib/buyer-dna/icp";
import type { Icp } from "@/lib/buyer-dna/icp";
import { refreshVoice } from "@/lib/buyer-dna/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

// Refresh the aggregate "buyer voice" for one creator: what everyone who bought keeps saying, what
// they don't, the most common pains + objections. Grounded only in the real dossiers. Weekly + on ICP bump.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const slug = (url.searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });

  const sb = getServiceSupabase();
  const current = await getCurrentIcp(sb, slug);
  const icp = current ? ((current as { icp: Icp }).icp) : null;
  const icpVersion = current ? Number((current as { version: number }).version) : null;

  const res = await refreshVoice(sb, slug, icp, icpVersion, new Anthropic());
  if (!res.ok) return NextResponse.json({ ok: false, creator: slug, reason: res.reason }, { status: 200 });
  return NextResponse.json({ ok: true, creator: slug, version: res.version, buyer_count: res.buyer_count });
}
