import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sb = getServiceSupabase();
    const [projectsResult, foldersResult] = await Promise.all([
      sb
        .from("studio2_projects")
        .select("id, folder_id, name, thumbnail_url, status, updated_at, created_at")
        .order("updated_at", { ascending: false }),
      sb
        .from("studio2_folders")
        .select("id, name, updated_at, created_at")
        .order("name", { ascending: true }),
    ]);

    if (projectsResult.error) {
      return NextResponse.json({ error: projectsResult.error.message }, { status: 500 });
    }
    if (foldersResult.error) {
      return NextResponse.json({ error: foldersResult.error.message }, { status: 500 });
    }

    return NextResponse.json({
      projects: (projectsResult.data || []).map((project) => ({
        id: project.id,
        folderId: project.folder_id,
        name: project.name,
        thumbnailUrl: project.thumbnail_url,
        status: project.status,
        updatedAt: project.updated_at,
        createdAt: project.created_at,
      })),
      folders: foldersResult.data || [],
    });
  } catch (err) {
    console.error("Studio 2 project list error:", err);
    return NextResponse.json({ error: "Failed to list Studio 2 projects" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sb = getServiceSupabase();
    const now = new Date().toISOString();
    const name = String(body.name || "Untitled design").trim() || "Untitled design";

    const { data, error } = await sb
      .from("studio2_projects")
      .insert({
        folder_id: body.folderId || null,
        name,
        copy_text: typeof body.copyText === "string" ? body.copyText : "",
        draft: body.draft || {},
        thumbnail_url: body.thumbnailUrl || null,
        status: body.status || "draft",
        updated_at: now,
      })
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Project insert failed" }, { status: 500 });
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
    console.error("Studio 2 project create error:", err);
    return NextResponse.json({ error: "Failed to create Studio 2 project" }, { status: 500 });
  }
}
