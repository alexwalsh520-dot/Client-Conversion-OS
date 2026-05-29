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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const sb = getServiceSupabase();

    const { data: folder, error: folderError } = await sb
      .from("studio2_folders")
      .select("id, name, folder_type, parent_id")
      .eq("id", id)
      .single();

    if (folderError || !folder) {
      return NextResponse.json({ error: folderError?.message || "Folder not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) {
      const name = String(body.name || "").trim();
      if (!name) return NextResponse.json({ error: "Folder name required" }, { status: 400 });
      updates.name = name;
    }

    if (body.parentId !== undefined) {
      const parentId = body.parentId ? String(body.parentId) : null;
      if (parentId === id) {
        return NextResponse.json({ error: "A folder cannot contain itself" }, { status: 400 });
      }
      if (parentId) {
        const { data: parent, error: parentError } = await sb
          .from("studio2_folders")
          .select("id, folder_type, parent_id")
          .eq("id", parentId)
          .single();
        if (parentError || !parent) {
          return NextResponse.json({ error: parentError?.message || "Parent folder not found" }, { status: 404 });
        }
        if ((parent.folder_type || "design") !== (folder.folder_type || "design")) {
          return NextResponse.json({ error: "Parent folder type mismatch" }, { status: 400 });
        }

        let cursor: string | null = parent.parent_id || null;
        while (cursor) {
          if (cursor === id) {
            return NextResponse.json({ error: "A folder cannot be moved inside one of its children" }, { status: 400 });
          }
          const { data: ancestor, error: ancestorError } = await sb
            .from("studio2_folders")
            .select("id, parent_id")
            .eq("id", cursor)
            .single();
          if (ancestorError || !ancestor) break;
          cursor = ancestor.parent_id || null;
        }
      }
      updates.parent_id = parentId;
    }

    const { data, error } = await sb
      .from("studio2_folders")
      .update(updates)
      .eq("id", id)
      .select("id, name, folder_type, parent_id, created_at, updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Folder update failed" }, { status: 500 });
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
    console.error("Studio 2 folder update error:", err);
    return NextResponse.json({ error: "Failed to update Studio 2 folder" }, { status: 500 });
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

    const parentId = folder.parent_id || null;

    if ((folder.folder_type || "design") === "media") {
      const { error: mediaMoveError } = await sb.from("studio2_media").update({ folder_id: parentId }).eq("folder_id", id);
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
      const { error: projectMoveError } = await sb.from("studio2_projects").update({ folder_id: parentId }).eq("folder_id", id);
      if (projectMoveError) {
        return NextResponse.json({ error: projectMoveError.message }, { status: 500 });
      }
      const { error: childMoveError } = await sb
        .from("studio2_folders")
        .update({ parent_id: folder.parent_id || null })
        .eq("parent_id", id);
      if (childMoveError) {
        return NextResponse.json({ error: childMoveError.message }, { status: 500 });
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
