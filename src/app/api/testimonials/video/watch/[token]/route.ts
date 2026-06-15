// GET /api/testimonials/video/watch/<token>
// Shareable playback for a single testimonial, gated by the row's unguessable
// token (same token the recording link uses). Anyone with the link can watch —
// this is what the Slack #testimonials "Watch testimonial" button points at, so
// coaches can see their client's submission without an admin login. We key on
// the high-entropy token (NOT the sequential id) so videos can't be enumerated.
// Streams via a short-lived presigned GET so the raw R2 key is never exposed.

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { createPresignedGetUrl } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data: row } = await db
    .from("video_testimonials")
    .select("r2_key, content_type, status, client_name")
    .eq("token", token)
    .maybeSingle();

  if (!row?.r2_key || row.status !== "submitted") {
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
    // Private: possession of the token is the auth, so don't let shared caches store it.
    "Cache-Control": "private, no-store",
  });

  if (req.nextUrl.searchParams.get("download")) {
    const ext = (row.r2_key.split(".").pop() || "mp4").toLowerCase();
    const safeName =
      (row.client_name || "testimonial").replace(/[^\w.\- ]+/g, "").trim().slice(0, 80) || "testimonial";
    headers.set("Content-Disposition", `attachment; filename="${safeName} testimonial.${ext}"`);
  }

  const contentLength = upstream.headers.get("Content-Length");
  const contentRange = upstream.headers.get("Content-Range");
  const acceptRanges = upstream.headers.get("Accept-Ranges");
  if (contentLength) headers.set("Content-Length", contentLength);
  if (contentRange) headers.set("Content-Range", contentRange);
  headers.set("Accept-Ranges", acceptRanges || "bytes");

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
