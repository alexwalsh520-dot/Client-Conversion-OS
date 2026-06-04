// POST /api/testimonials/video/upload-url  (PUBLIC, token-validated)
// The public recording page calls this to get a presigned R2 PUT URL. The key
// is stored on the request row immediately so the client can't redirect the
// upload elsewhere; "complete" only ever trusts the stored key.

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { createPresignedPutUrl, createTestimonialR2Key } from "@/lib/r2";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "");
    const filename = String(body.filename || "testimonial");
    const contentType = String(body.contentType || "video/mp4");

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }
    if (!contentType.startsWith("video/")) {
      return NextResponse.json({ error: "Only video uploads are accepted" }, { status: 400 });
    }

    const db = getServiceSupabase();
    const { data: row, error } = await db
      .from("video_testimonials")
      .select("id, client_id, status")
      .eq("token", token)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
    }
    if (row.status === "submitted") {
      return NextResponse.json({ error: "This testimonial was already submitted" }, { status: 409 });
    }

    const key = createTestimonialR2Key(row.client_id ?? "unknown", filename, contentType);
    const signed = createPresignedPutUrl({ key, contentType });

    const { error: updateErr } = await db
      .from("video_testimonials")
      .update({ r2_key: key, content_type: contentType })
      .eq("id", row.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ uploadUrl: signed.uploadUrl, headers: signed.headers });
  } catch (err) {
    console.error("[testimonials/video/upload-url] error:", err);
    // Diagnostic: log WHICH R2 env vars are present (booleans only, never the
    // secret values) so a misconfigured production env is easy to pinpoint.
    if (err instanceof Error && err.message.includes("R2 env vars not configured")) {
      // Compact, log-view-friendly presence code (1 = present, 0 = missing/empty)
      // so it survives the runtime-log message truncation. Letters:
      // A=R2_ACCOUNT_ID K=R2_ACCESS_KEY_ID S=R2_SECRET_ACCESS_KEY
      // B=R2_BUCKET_NAME U=R2_PUBLIC_BASE_URL
      const n = (v?: string) => (v?.trim() ? 1 : 0);
      console.error(
        `R2CFG A${n(process.env.R2_ACCOUNT_ID)}K${n(process.env.R2_ACCESS_KEY_ID)}S${n(process.env.R2_SECRET_ACCESS_KEY)}B${n(process.env.R2_BUCKET_NAME)}U${n(process.env.R2_PUBLIC_BASE_URL)}`
      );
    }
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
  }
}
