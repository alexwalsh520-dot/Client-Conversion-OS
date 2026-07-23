import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { seedIcpFromDoc } from "@/lib/buyer-dna/icp";
import { getMessagingDoc } from "@/lib/buyer-dna/messaging-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Seed a creator's locked ICP from their own Master Messaging document (stored in Supabase). One LLM
// call distils the doc into the ICP schema and locks it as mode 'fixed' — the doc is the source, so
// nothing about the buyer is hardcoded in this (public) repo. For creators onboarded from a doc
// before they have any buyers to learn from.
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
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) {
    return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const doc = await getMessagingDoc(sb, slug);
  if (!doc) return NextResponse.json({ ok: false, creator: slug, reason: "No messaging document for this creator." }, { status: 200 });

  const res = await seedIcpFromDoc(sb, slug, doc.doc_text, new Anthropic());
  if (!res.ok) return NextResponse.json({ ok: false, creator: slug, reason: res.reason }, { status: 200 });
  return NextResponse.json({ ok: true, creator: slug, mode: "fixed", version: res.version, doc_version: doc.version });
}
