import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sb = getServiceSupabase();

    const { data: folder, error: folderError } = await sb
      .from("studio2_folders")
      .select("id, folder_type, parent_id")
      .eq("id", id)
      .single();

    if (folderError || !folder) {
      return NextResponse.json({ error: folderError?.message || "Folder not found" }, { status: 404 });
    }

    if ((folder.folder_type || "design") === "media") {
      const { error: mediaMoveError } = await sb.from("studio2_media").update({ folder_id: null }).eq("folder_id", id);
      if (mediaMoveError) {
        return NextResponse.json({ error: mediaMoveError.message }, { status: 500 });
      }
      const { error: childMoveError } = await sb
        .from("studio2_folders")
        .update({ parent_id: folder.parent_id || null })
        .eq("parent_id", id);
      if (childMoveError) {
        return NextResponse.json({ error: childMoveError.message }, { status: 500 });
      }
    } else {
      const { error: projectMoveError } = await sb.from("studio2_projects").update({ folder_id: null }).eq("folder_id", id);
      if (projectMoveError) {
        return NextResponse.json({ error: projectMoveError.message }, { status: 500 });
      }
    }

    const { error } = await sb
      .from("studio2_folders")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Studio 2 folder delete error:", err);
    return NextResponse.json({ error: "Failed to delete Studio 2 folder" }, { status: 500 });
  }
}
