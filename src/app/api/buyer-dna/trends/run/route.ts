import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getCurrentIcp } from "@/lib/buyer-dna/icp";
import type { Icp } from "@/lib/buyer-dna/icp";
import { refreshTrendBrief } from "@/lib/buyer-dna/trends";
import { TREND_BRIEFS_ENABLED } from "@/lib/content/ai-spend-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

// Refresh the "what is working on social right now" brief for one creator (weekly cron).
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Disabled on cost grounds — see TREND_BRIEFS_ENABLED in lib/content/ai-spend-config. Guarded HERE as well as at
  // the cron trigger so a direct call (manual, UI, or a future caller) also cannot spend.
  if (!TREND_BRIEFS_ENABLED) {
    return NextResponse.json({ ok: false, disabled: true, feature: "buyer-dna-trends", reason: "Disabled on cost grounds. Re-enable in lib/content/ai-spend-config.ts." });
  }
  const url = new URL(req.url);
  const slug = (url.searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });

  const sb = getServiceSupabase();
  const current = await getCurrentIcp(sb, slug);
  const icp = current ? ((current as { icp: Icp }).icp) : null;

  const res = await refreshTrendBrief(sb, slug, icp, new Anthropic());
  if (!res.ok) return NextResponse.json({ ok: false, creator: slug, reason: res.reason }, { status: 200 });
  return NextResponse.json({ ok: true, creator: slug, version: res.version, searched: res.searched });
}
