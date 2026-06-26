// Generate a creator's Instagram (re)connect link. Send it to the creator (or open it
// while logged into their IG) → they approve → CCOS gets a fresh token.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildInstagramSetupToken, getInstagramClient, type InstagramClientSlug } from "@/lib/instagram-connections";

export const dynamic = "force-dynamic";
const BASE_URL = "https://client-conversion-os.vercel.app";

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const slug = (req.nextUrl.searchParams.get("creator") || "").toLowerCase();
  const client = getInstagramClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  const token = buildInstagramSetupToken({ client: slug as InstagramClientSlug, daysValid: 14 });
  return NextResponse.json({
    creator: slug,
    url: `${BASE_URL}/connect/instagram/${slug}?token=${token}`,
    expires_days: 14,
  });
}
