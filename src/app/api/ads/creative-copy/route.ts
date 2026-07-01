import { NextRequest, NextResponse } from "next/server";
import { getOrExtractCreativeCopy } from "@/lib/ads-tracker/creative-copy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// On-demand: read (or return the cached) words on ONE ad's image.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const adId = typeof body.adId === "string" ? body.adId.trim() : "";
    if (!adId) {
      return NextResponse.json({ error: "Missing adId" }, { status: 400 });
    }

    const result = await getOrExtractCreativeCopy({
      adId,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : null,
      clientKey: typeof body.clientKey === "string" ? body.clientKey : null,
      primaryText:
        typeof body.primaryText === "string"
          ? body.primaryText
          : typeof body.captionText === "string"
            ? body.captionText
            : null,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Creative copy read error:", error);
    const message = error instanceof Error ? error.message : "Read failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
