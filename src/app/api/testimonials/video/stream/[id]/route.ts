// GET /api/testimonials/video/stream/<id>
// Admin-only. Streams a submitted testimonial video from R2 through the
// server using a short-lived presigned GET URL, so the raw object URL is
// never handed to the browser. Supports HTTP range requests (scrubbing)
// and an optional ?download=1 to force a save dialog.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { createPresignedGetUrl } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId) || rowId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data: row } = await db
    .from("video_testimonials")
    .select("r2_key, content_type, client_name")
    .eq("id", rowId)
    .maybeSingle();

  if (!row?.r2_key) {
    return NextResponse.json({ error: "Testimonial not found" }, { status: 404 });
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
    "Cache-Control": "private, no-store",
  });

  if (req.nextUrl.searchParams.get("download")) {
    const ext = (row.r2_key.split(".").pop() || "mp4").toLowerCase();
    const safeName = (row.client_name || "testimonial").replace(/[^\w.\- ]+/g, "").trim().slice(0, 80) || "testimonial";
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
