import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { generateAngles } from "@/lib/buyer-dna/angles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  const res = await generateAngles(sb, slug, new Anthropic());
  if (!res.ok) return NextResponse.json({ ok: false, error: res.reason }, { status: 400 });
  return NextResponse.json({ ok: true, creator: slug, angles: res.count });
}
