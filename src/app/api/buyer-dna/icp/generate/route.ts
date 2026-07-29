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

// How each creator's ICP is decided. THIS MAP IS EXHAUSTIVE ON PURPOSE.
//
// It used to be `{ tyson: true, antwan: false }` and anything not listed fell through to the
// "fixed" branch below — which seeds ANTWAN's hardcoded profile. On 2026-07-27 the weekly cron
// called this for jake, `DERIVED["jake"]` was undefined, and Antwan's ICP was written and LOCKED as
// jake's. The next morning's carousels were written for Antwan's audience.
//
// A creator we have no explicit mode for is now refused. Nobody inherits another creator's identity
// by omission ever again.
type IcpMode = "derived" | "fixed-antwan" | "from-doc";
const ICP_MODE: Record<string, IcpMode> = {
  tyson: "derived",       // learned from qualifying buyer dossiers
  antwan: "fixed-antwan", // chosen up front, retired but kept so history regenerates identically
  jake: "from-doc",       // distilled from his own messaging document (icp/seed-from-doc)
};

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

  const mode = ICP_MODE[slug];
  if (!mode) {
    // Default deny. An unknown creator gets an error, never someone else's profile.
    return NextResponse.json(
      { ok: false, error: `No ICP mode declared for "${slug}". Add it to ICP_MODE in this route — a creator never inherits another creator's ICP by omission.` },
      { status: 400 },
    );
  }
  if (mode === "from-doc") {
    return NextResponse.json(
      { ok: false, error: `${slug} derives his ICP from his messaging document. Use POST /api/buyer-dna/icp/seed-from-doc?creator=${slug}.` },
      { status: 400 },
    );
  }

  const sb = getServiceSupabase();

  if (mode === "derived") {
    const anthropic = new Anthropic();
    const res = await generateDerivedIcp(sb, slug, THRESHOLD_CENTS, anthropic);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.reason }, { status: 400 });
    return NextResponse.json({ ok: true, creator: slug, mode: "derived", version: res.version, buyer_count: res.buyerCount });
  }

  // Fixed ICP — Antwan's, and only ever Antwan's. The guard above makes that structural.
  const res = await seedFixedIcp(sb, slug, ANTWAN_FIXED_ICP);
  return NextResponse.json({ ok: true, creator: slug, mode: "fixed", version: res.version });
}
