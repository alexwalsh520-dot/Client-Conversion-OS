import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { inferMediaKind } from "@/lib/r2";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const key = String(body.key || "");
    const publicUrl = String(body.publicUrl || "");
    const thumbnailUrl = typeof body.thumbnailUrl === "string" && body.thumbnailUrl ? body.thumbnailUrl : null;
    const filename = String(body.filename || "upload");
    const contentType = String(body.contentType || "application/octet-stream");

    if (!key || !publicUrl) {
      return NextResponse.json({ error: "Missing uploaded media key" }, { status: 400 });
    }

    const sb = getServiceSupabase();
    const insertPayload = {
      project_id: body.projectId || null,
      folder_id: body.folderId || null,
      r2_key: key,
      public_url: publicUrl,
      thumbnail_url: thumbnailUrl,
      filename,
      content_type: contentType,
      file_size: Number.isFinite(Number(body.fileSize)) ? Number(body.fileSize) : null,
      kind: inferMediaKind(contentType),
      status: "uploaded",
    };

    let { data, error } = await sb
      .from("studio2_media")
      .insert(insertPayload)
      .select()
      .single();

    if (error && isMissingThumbnailColumn(error.message)) {
      const fallbackPayload: Record<string, unknown> = { ...insertPayload };
      delete fallbackPayload.thumbnail_url;
      const fallback = await sb
        .from("studio2_media")
        .insert(fallbackPayload)
        .select()
        .single();
      data = fallback.data;
      error = fallback.error;
    }

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Media insert failed" }, { status: 500 });
    }

    return NextResponse.json({
      media: {
        id: data.id,
        folderId: data.folder_id,
        url: data.public_url,
        thumbnailUrl: "thumbnail_url" in data ? data.thumbnail_url : null,
        filename: data.filename,
        kind: data.kind,
        createdAt: data.created_at,
      },
    });
  } catch (err) {
    console.error("Studio 2 media complete error:", err);
    return NextResponse.json({ error: "Failed to save Studio 2 media" }, { status: 500 });
  }
}

function isMissingThumbnailColumn(message?: string | null) {
  const value = String(message || "").toLowerCase();
  return value.includes("thumbnail_url") && (value.includes("schema cache") || value.includes("column"));
}
