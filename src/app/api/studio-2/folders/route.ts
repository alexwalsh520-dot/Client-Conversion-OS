import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    const folderType = body.folderType === "media" ? "media" : "design";
    const parentId = body.parentId ? String(body.parentId) : null;
    if (!name) return NextResponse.json({ error: "Folder name required" }, { status: 400 });

    const sb = getServiceSupabase();
    if (parentId) {
      const { data: parent, error: parentError } = await sb
        .from("studio2_folders")
        .select("id, folder_type")
        .eq("id", parentId)
        .maybeSingle();

      if (parentError || !parent) {
        return NextResponse.json({ error: parentError?.message || "Parent folder not found" }, { status: 404 });
      }

      if ((parent.folder_type || "design") !== folderType) {
        return NextResponse.json({ error: "Parent folder type mismatch" }, { status: 400 });
      }
    }

    const { data, error } = await sb
      .from("studio2_folders")
      .insert({
        name,
        folder_type: folderType,
        parent_id: parentId,
        updated_at: new Date().toISOString(),
      })
      .select("id, name, folder_type, parent_id, updated_at, created_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Folder insert failed" }, { status: 500 });
    }

    return NextResponse.json({
      folder: {
        id: data.id,
        name: data.name,
        folderType: data.folder_type || "design",
        parentId: data.parent_id || null,
        updatedAt: data.updated_at,
        createdAt: data.created_at,
      },
    });
  } catch (err) {
    console.error("Studio 2 folder create error:", err);
    return NextResponse.json({ error: "Failed to create Studio 2 folder" }, { status: 500 });
  }
}
