import { NextRequest, NextResponse } from "next/server";
import { extractAndStoreAdImageText, responsePayload } from "@/lib/marketing-brain/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      adId?: unknown;
      imageUrl?: unknown;
      imageBase64?: unknown;
      imageText?: unknown;
    };

    const data = await extractAndStoreAdImageText({
      adId: typeof body.adId === "string" ? body.adId : "",
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
      imageBase64: typeof body.imageBase64 === "string" ? body.imageBase64 : undefined,
      imageText: typeof body.imageText === "string" ? body.imageText : undefined,
    });

    return NextResponse.json(responsePayload(data), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to read ad image text" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
