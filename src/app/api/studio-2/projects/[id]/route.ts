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
      .from("studio2_projects")
      .select("id, folder_id, name, copy_text, draft, thumbnail_url, status, updated_at, created_at")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Project not found" }, { status: 404 });
    }

    return NextResponse.json({
      project: {
        id: data.id,
        folderId: data.folder_id,
        name: data.name,
        copyText: data.copy_text,
        draft: data.draft,
        thumbnailUrl: data.thumbnail_url,
        status: data.status,
        updatedAt: data.updated_at,
        createdAt: data.created_at,
      },
    });
  } catch (err) {
    console.error("Studio 2 project read error:", err);
    return NextResponse.json({ error: "Failed to read Studio 2 project" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.folderId !== undefined) updates.folder_id = body.folderId || null;
    if (body.name !== undefined) updates.name = String(body.name || "Untitled design").trim() || "Untitled design";
    if (body.copyText !== undefined) updates.copy_text = typeof body.copyText === "string" ? body.copyText : "";
    if (body.draft !== undefined) updates.draft = body.draft || {};
    if (body.thumbnailUrl !== undefined) updates.thumbnail_url = body.thumbnailUrl || null;
    if (body.status !== undefined) updates.status = body.status || "draft";

    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("studio2_projects")
      .update(updates)
      .eq("id", id)
      .select("id, folder_id, name, thumbnail_url, status, updated_at, created_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Project update failed" }, { status: 500 });
    }

    return NextResponse.json({
      project: {
        id: data.id,
        folderId: data.folder_id,
        name: data.name,
        thumbnailUrl: data.thumbnail_url,
        status: data.status,
        updatedAt: data.updated_at,
        createdAt: data.created_at,
      },
    });
  } catch (err) {
    console.error("Studio 2 project update error:", err);
    return NextResponse.json({ error: "Failed to update Studio 2 project" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sb = getServiceSupabase();
    const { error } = await sb
      .from("studio2_projects")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Studio 2 project delete error:", err);
    return NextResponse.json({ error: "Failed to delete Studio 2 project" }, { status: 500 });
  }
}
