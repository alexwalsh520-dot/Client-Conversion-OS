// Trigger Apify ingestion for a creator whose IG Graph token is dead (e.g. Tyson).
// Callable by an authed operator OR by the content-pipeline cron (Bearer CRON_SECRET).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { ingestViaApify } from "@/lib/apify-instagram";
import { CONTENT_CREATORS, type ContentCreator } from "@/lib/instagram-content";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace("Bearer ", "");
  const isCron = !!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET;
  if (!isCron) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const creator = (req.nextUrl.searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  }
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 300;

  const result = await ingestViaApify(creator as ContentCreator, { resultsLimit: limit });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
