import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const folderId = req.nextUrl.searchParams.get("folderId");
    const looseOnly = req.nextUrl.searchParams.get("loose") === "1";
    const sb = getServiceSupabase();
    let query = sb
      .from("studio2_media")
      .select("id, folder_id, public_url, filename, kind, created_at")
      .order("created_at", { ascending: false })
      .limit(300);

    if (folderId) query = query.eq("folder_id", folderId);
    if (looseOnly) query = query.is("folder_id", null);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      media: (data || []).map((item) => ({
        id: item.id,
        folderId: item.folder_id,
        url: item.public_url,
        filename: item.filename || "Upload",
        kind: item.kind === "video" ? "video" : "image",
        createdAt: item.created_at,
      })),
    });
  } catch (err) {
    console.error("Studio 2 media list error:", err);
    return NextResponse.json({ error: "Failed to load Studio 2 media" }, { status: 500 });
  }
}
