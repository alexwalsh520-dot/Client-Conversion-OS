// POST /api/testimonials/video/complete  (PUBLIC, token-validated)
// Called by the recording page after the file has been PUT to R2. Marks the
// request submitted, auto-completes the client's Video Testimonial milestone,
// and pings #testimonials. Trusts only the server-stored r2_key.

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { completeVideoMilestone, APP_BASE_URL } from "@/lib/testimonials/video";
import { notifyVideoTestimonialCompleted } from "@/lib/testimonials/notify-video";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "");
    const fileSize = Number.isFinite(Number(body.fileSize)) ? Number(body.fileSize) : null;

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const db = getServiceSupabase();
    const { data: row, error } = await db
      .from("video_testimonials")
      .select("id, client_id, client_name, coach_name, status, r2_key")
      .eq("token", token)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
    }
    if (row.status === "submitted") {
      return NextResponse.json({ ok: true, already: true });
    }
    if (!row.r2_key) {
      return NextResponse.json({ error: "No uploaded video found for this link" }, { status: 400 });
    }

    const { error: updateErr } = await db
      .from("video_testimonials")
      .update({ status: "submitted", submitted_at: new Date().toISOString(), file_size: fileSize })
      .eq("id", row.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Auto-complete the milestone (best-effort, never throws).
    if (row.client_id) {
      await completeVideoMilestone(db, {
        clientId: row.client_id,
        clientName: row.client_name,
        coachName: row.coach_name ?? null,
        changedBy: "Client (video submission)",
      });
    }

    // Slack #testimonials ping (fire-and-forget).
    void notifyVideoTestimonialCompleted({
      clientName: row.client_name,
      coachName: row.coach_name ?? null,
      watchUrl: `${APP_BASE_URL}/testimonials/videos/${row.id}`,
    }).catch((e) => console.warn("[testimonials/video/complete] slack notify failed:", e));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[testimonials/video/complete] error:", err);
    return NextResponse.json({ error: "Failed to finalize submission" }, { status: 500 });
  }
}
