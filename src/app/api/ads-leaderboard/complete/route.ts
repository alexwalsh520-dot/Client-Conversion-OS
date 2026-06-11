// /api/ads-leaderboard/complete  (PUBLIC, token-validated)
// Called after the video has been PUT to R2. Marks the entry submitted and
// stores the public video URL. Trusts only the server-stored r2_key.

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getR2PublicUrl } from "@/lib/r2";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "");
    const fileSize = Number.isFinite(Number(body.fileSize)) ? Number(body.fileSize) : null;

    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const db = getServiceSupabase();
    const { data: row, error } = await db
      .from("ad_contest_entries")
      .select("id, status, r2_key")
      .eq("token", token)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
    if (row.status === "submitted" || row.status === "live") {
      return NextResponse.json({ ok: true, already: true });
    }
    if (!row.r2_key) {
      return NextResponse.json({ error: "No uploaded video found for this link" }, { status: 400 });
    }

    const videoUrl = getR2PublicUrl(row.r2_key);

    const { error: updErr } = await db
      .from("ad_contest_entries")
      .update({
        status: "submitted",
        video_url: videoUrl,
        file_size: fileSize,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[ads-leaderboard/complete] error:", err);
    return NextResponse.json({ error: "Failed to finalize submission" }, { status: 500 });
  }
}
