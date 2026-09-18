// The Hammer Them section's slice: a live read of the hammer campaign from
// Meta (cached 10 minutes server-side). The funnel-lift half of the section
// reads the normal metrics route for two windows; nothing here touches facts.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readHammer } from "@/lib/ads-v2/hammer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const payload = await readHammer();
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read the hammer campaign" },
      { status: 500 },
    );
  }
}
