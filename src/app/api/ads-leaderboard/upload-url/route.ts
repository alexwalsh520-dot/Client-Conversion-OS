// /api/ads-leaderboard/upload-url  (PUBLIC, token-validated)
// Returns a presigned R2 PUT URL for the contestant's video. The key is stored
// on the entry immediately so "complete" only ever trusts the server key.

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { createPresignedPutUrl, createAdContestR2Key } from "@/lib/r2";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "");
    const filename = String(body.filename || "ad");
    const contentType = String(body.contentType || "video/mp4");

    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
    if (!contentType.startsWith("video/")) {
      return NextResponse.json({ error: "Only video uploads are accepted" }, { status: 400 });
    }

    const db = getServiceSupabase();
    const { data: row, error } = await db
      .from("ad_contest_entries")
      .select("id, status")
      .eq("token", token)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
    if (row.status === "submitted" || row.status === "live") {
      return NextResponse.json({ error: "This ad was already submitted" }, { status: 409 });
    }

    const key = createAdContestR2Key(row.id, filename, contentType);
    const signed = createPresignedPutUrl({ key, contentType });

    const { error: updErr } = await db
      .from("ad_contest_entries")
      .update({ r2_key: key, content_type: contentType, status: "recording", updated_at: new Date().toISOString() })
      .eq("id", row.id);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ uploadUrl: signed.uploadUrl, headers: signed.headers });
  } catch (err) {
    console.error("[ads-leaderboard/upload-url] error:", err);
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
  }
}
