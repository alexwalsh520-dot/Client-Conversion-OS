import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getInstagramProfileForClient } from "@/lib/instagram-connections";
import { CREATORS_BY_KEY, type CreatorKey } from "@/lib/creators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A creator's live IG handle + avatar URL, resolved from their connected token. Operator/cron only.
// Used to (re)save the carousel avatar file for a creator once their Instagram is connected.
async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const slug = (new URL(req.url).searchParams.get("creator") || "").toLowerCase();
  if (!CREATORS_BY_KEY[slug as CreatorKey]) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });

  const profile = await getInstagramProfileForClient(slug);
  if (!profile) return NextResponse.json({ ok: false, creator: slug, reason: "no connected Instagram account" }, { status: 200 });
  return NextResponse.json({ ok: true, creator: slug, ...profile });
}
