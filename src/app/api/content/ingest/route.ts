import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { ingestAllContent, ingestCreatorContent, CONTENT_CREATORS, type ContentCreator } from "@/lib/instagram-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Pull Tyson + Antwan reels from Meta into `creator_content`. Runs server-side so the
// sensitive token-decryption key (Vercel runtime) is available. Trigger via:
//   - an authenticated admin session (the app), or
//   - `Authorization: Bearer <CRON_SECRET>` (cron / manual ops).
async function authorized(req: NextRequest): Promise<boolean> {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const session = await auth().catch(() => null);
  return !!session?.user;
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const only = url.searchParams.get("creator");
  try {
    const results =
      only && (CONTENT_CREATORS as readonly string[]).includes(only)
        ? [await ingestCreatorContent(only as ContentCreator)]
        : await ingestAllContent();
    const ok = results.every((r) => r.ok);
    return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest failed" },
      { status: 500 }
    );
  }
}

// Convenience: allow GET with ?secret= for a quick manual/browser trigger.
export async function GET(req: NextRequest) {
  return POST(req);
}
