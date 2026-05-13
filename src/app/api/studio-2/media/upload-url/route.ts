import { NextRequest, NextResponse } from "next/server";
import { createPresignedPutUrl, createR2ObjectKey, inferMediaKind } from "@/lib/r2";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filename = String(body.filename || "upload");
    const contentType = String(body.contentType || "application/octet-stream");
    const kind = inferMediaKind(contentType);

    if (kind === "image" && !contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Only image and video uploads are supported" }, { status: 400 });
    }

    const key = createR2ObjectKey(filename, contentType);
    const signed = createPresignedPutUrl({ key, contentType });

    return NextResponse.json({
      key,
      kind,
      uploadUrl: signed.uploadUrl,
      publicUrl: signed.publicUrl,
      headers: signed.headers,
    });
  } catch (err) {
    console.error("Studio 2 R2 presign error:", err);
    return NextResponse.json({ error: "Failed to create R2 upload URL" }, { status: 500 });
  }
}
