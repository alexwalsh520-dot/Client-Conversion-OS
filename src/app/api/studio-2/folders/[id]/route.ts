import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sb = getServiceSupabase();

    const { data, error } = await sb
      .from("studio2_folders")
      .select("id, name, folder_type, parent_id, created_at, updated_at")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Folder not found" }, { status: 404 });
    }

    return NextResponse.json({
      folder: {
        id: data.id,
        name: data.name,
        folderType: data.folder_type || "design",
        parentId: data.parent_id || null,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    });
  } catch (err) {
    console.error("Studio 2 folder read error:", err);
    return NextResponse.json({ error: "Failed to load Studio 2 folder" }, { status: 500 });
  }
}

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
