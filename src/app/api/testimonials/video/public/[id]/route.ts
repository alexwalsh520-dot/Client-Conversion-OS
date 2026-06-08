// GET /api/testimonials/video/public/<id>
// PUBLIC playback for the native testimonial gallery on /testimonials.
// Unlike the admin /stream route, this serves a video ONLY when the row is
// explicitly featured AND submitted. Everything else stays private. The object
// is proxied through a short-lived presigned GET URL so the raw R2 key is never
// exposed, and HTTP range requests (scrubbing) are passed through.

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { createPresignedGetUrl } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data: row } = await db
    .from("video_testimonials")
    .select("r2_key, content_type, status, featured")
    .eq("id", rowId)
    .maybeSingle();

  // Gate: only featured, submitted videos are public.
  if (!row?.r2_key || !row.featured || row.status !== "submitted") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const signedUrl = createPresignedGetUrl({ key: row.r2_key });
  const range = req.headers.get("range");
  const upstream = await fetch(signedUrl, {
    cache: "no-store",
    headers: range ? { Range: range } : undefined,
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Video unavailable" }, { status: upstream.status || 404 });
  }

  const headers = new Headers({
    "Content-Type": row.content_type || upstream.headers.get("Content-Type") || "video/mp4",
    // Public, brand-facing content; allow short CDN/browser caching.
    "Cache-Control": "public, max-age=3600",
  });

  const contentLength = upstream.headers.get("Content-Length");
  const contentRange = upstream.headers.get("Content-Range");
  const acceptRanges = upstream.headers.get("Accept-Ranges");
  if (contentLength) headers.set("Content-Length", contentLength);
  if (contentRange) headers.set("Content-Range", contentRange);
  headers.set("Accept-Ranges", acceptRanges || "bytes");

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
