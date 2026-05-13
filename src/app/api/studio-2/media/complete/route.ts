import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { inferMediaKind } from "@/lib/r2";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const key = String(body.key || "");
    const publicUrl = String(body.publicUrl || "");
    const filename = String(body.filename || "upload");
    const contentType = String(body.contentType || "application/octet-stream");

    if (!key || !publicUrl) {
      return NextResponse.json({ error: "Missing uploaded media key" }, { status: 400 });
    }

    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("studio2_media")
      .insert({
        project_id: body.projectId || null,
        folder_id: body.folderId || null,
        r2_key: key,
        public_url: publicUrl,
        filename,
        content_type: contentType,
        file_size: Number.isFinite(Number(body.fileSize)) ? Number(body.fileSize) : null,
        kind: inferMediaKind(contentType),
        status: "uploaded",
      })
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Media insert failed" }, { status: 500 });
    }

    return NextResponse.json({ media: data });
  } catch (err) {
    console.error("Studio 2 media complete error:", err);
    return NextResponse.json({ error: "Failed to save Studio 2 media" }, { status: 500 });
  }
}
