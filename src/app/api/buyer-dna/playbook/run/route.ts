import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getCurrentIcp } from "@/lib/buyer-dna/icp";
import type { Icp } from "@/lib/buyer-dna/icp";
import { refreshPlaybook } from "@/lib/buyer-dna/playbook";
import { postToSlack, getSalesManagerChannel } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

// Refresh the Playbook filming sheet for one creator: 20 talking-head hooks + topics aimed at the ICP,
// grounded in the buyers, the trend brief, and the shift brief. Weekly cron + on ICP bump.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const slug = (url.searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });

  const sb = getServiceSupabase();
  const current = await getCurrentIcp(sb, slug);
  const icp = current ? ((current as { icp: Icp }).icp) : null;
  const icpVersion = current ? Number((current as { version: number }).version) : null;

  // Keep the generation (+ its one retry) within the 300s ceiling; ~100s headroom per attempt.
  const start = Date.now();
  const canProceed = () => Date.now() - start + 100_000 < 290_000;

  const res = await refreshPlaybook(sb, slug, icp, icpVersion, new Anthropic(), { canProceed });
  if (!res.ok) {
    if (res.audit && !res.audit.ok) {
      const channel = getSalesManagerChannel();
      const tag = url.searchParams.get("test") === "1" ? "[TEST] " : "";
      if (channel) await postToSlack(channel, `${tag}:rotating_light: *ICP audit failed for ${slug}* — playbook rejected, needs eyes.\n${res.reason}`).catch(() => {});
      return NextResponse.json({ ok: false, creator: slug, reason: res.reason, icp_audit: res.audit, stored: false }, { status: 200 });
    }
    return NextResponse.json({ ok: false, creator: slug, reason: res.reason }, { status: 200 });
  }
  return NextResponse.json({ ok: true, creator: slug, version: res.version, hooks: res.hooks, topics: res.topics, icp_audit: res.audit });
}
