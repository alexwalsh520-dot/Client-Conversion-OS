import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getContentForCreator } from "@/lib/content-data";
import { CONTENT_CREATORS } from "@/lib/instagram-content";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Authed read for the Content tab. ?creator=tyson|antwan for one, else both.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const only = (req.nextUrl.searchParams.get("creator") || "").toLowerCase();
  const slugs = (CONTENT_CREATORS as readonly string[]).includes(only)
    ? [only]
    : [...CONTENT_CREATORS];
  try {
    const creators = await Promise.all(slugs.map((s) => getContentForCreator(s)));
    return NextResponse.json({ creators });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load content" },
      { status: 500 }
    );
  }
}
