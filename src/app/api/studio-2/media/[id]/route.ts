import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { deleteR2Object } from "@/lib/r2";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.folderId !== undefined) updates.folder_id = body.folderId || null;

    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("studio2_media")
      .update(updates)
      .eq("id", id)
      .select("id, folder_id, public_url, filename, kind, created_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Media update failed" }, { status: 500 });
    }

    return NextResponse.json({
      media: {
        id: data.id,
        folderId: data.folder_id,
        url: data.public_url,
        filename: data.filename || "Upload",
        kind: data.kind === "video" ? "video" : "image",
        createdAt: data.created_at,
      },
    });
  } catch (err) {
    console.error("Studio 2 media update error:", err);
    return NextResponse.json({ error: "Failed to update Studio 2 media" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("studio2_media")
      .select("id, r2_key")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Media not found" }, { status: 404 });
    }

    await deleteR2Object(data.r2_key).catch((err) => {
      console.error("Studio 2 R2 media delete error:", err);
    });

    const { error: deleteError } = await sb
      .from("studio2_media")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Studio 2 media delete error:", err);
    return NextResponse.json({ error: "Failed to delete Studio 2 media" }, { status: 500 });
  }
}
