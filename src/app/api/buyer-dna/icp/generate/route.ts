import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { generateDerivedIcp, seedFixedIcp } from "@/lib/buyer-dna/icp";
import { ANTWAN_FIXED_ICP } from "@/lib/buyer-dna/antwan-icp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const THRESHOLD_CENTS = 120000;
// Tyson learns his ICP from buyer data; Antwan's is chosen up front.
const DERIVED: Record<string, boolean> = { tyson: true, antwan: false };

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

  const sb = getServiceSupabase();

  if (DERIVED[slug]) {
    const anthropic = new Anthropic();
    const res = await generateDerivedIcp(sb, slug, THRESHOLD_CENTS, anthropic);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.reason }, { status: 400 });
    return NextResponse.json({ ok: true, creator: slug, mode: "derived", version: res.version, buyer_count: res.buyerCount });
  }

  // Fixed ICP (Antwan): seed the chosen profile as-is.
  const res = await seedFixedIcp(sb, slug, ANTWAN_FIXED_ICP);
  return NextResponse.json({ ok: true, creator: slug, mode: "fixed", version: res.version });
}
