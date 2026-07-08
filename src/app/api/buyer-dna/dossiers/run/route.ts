import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { listQualifiedBuyers } from "@/lib/buyer-dna/core";
import { buildDossier } from "@/lib/buyer-dna/dossier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const THRESHOLD_CENTS = 120000; // $1,200 defines a buyer worth learning from

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
  const limit = Math.min(Number(url.searchParams.get("limit") || 12), 50);

  const sb = getServiceSupabase();
  const buyers = await listQualifiedBuyers(sb, slug, THRESHOLD_CENTS);

  const { data: existing } = await sb.from("buyer_dossiers").select("person_key").eq("client_key", slug);
  const done = new Set((existing || []).map((r) => (r as { person_key: string }).person_key));

  const todo = buyers.filter((b) => !done.has(b.personKey));
  const batch = todo.slice(0, limit);

  const anthropic = new Anthropic();
  let built = 0, thin = 0, errored = 0;
  for (const b of batch) {
    const res = await buildDossier(sb, slug, b, anthropic, THRESHOLD_CENTS);
    if (res === "built") built++;
    else if (res === "thin") thin++;
    else errored++;
  }

  const remaining = todo.length - batch.length;
  return NextResponse.json({
    ok: true,
    creator: slug,
    qualified_buyers: buyers.length,
    built,
    thin,
    errored,
    remaining,
    note: remaining ? `Run again, ${remaining} buyers left to research.` : "All qualifying buyers researched.",
  });
}
