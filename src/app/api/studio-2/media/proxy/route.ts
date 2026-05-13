import { NextRequest, NextResponse } from "next/server";
import { getR2Config } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const target = req.nextUrl.searchParams.get("url");
    if (!target) {
      return NextResponse.json({ error: "Missing media URL" }, { status: 400 });
    }

    const config = getR2Config();
    const url = new URL(target);
    const allowedBase = new URL(config.publicBaseUrl);

    if (url.origin !== allowedBase.origin || !url.pathname.startsWith(allowedBase.pathname.replace(/\/$/, ""))) {
      return NextResponse.json({ error: "Media URL is not allowed" }, { status: 400 });
    }

    const range = req.headers.get("range");
    const upstream = await fetch(url.toString(), {
      cache: range ? "no-store" : "force-cache",
      headers: range ? { Range: range } : undefined,
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "Media not found" }, { status: upstream.status || 404 });
    }

    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": range ? "no-store" : "public, max-age=31536000, immutable",
    });
    const contentLength = upstream.headers.get("Content-Length");
    const contentRange = upstream.headers.get("Content-Range");
    const acceptRanges = upstream.headers.get("Accept-Ranges");
    if (contentLength) headers.set("Content-Length", contentLength);
    if (contentRange) headers.set("Content-Range", contentRange);
    if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    console.error("Studio 2 media proxy error:", err);
    return NextResponse.json({ error: "Failed to load media" }, { status: 500 });
  }
}
