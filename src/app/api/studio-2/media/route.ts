import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

type StudioMediaRow = {
  id: string;
  folder_id: string | null;
  public_url: string;
  thumbnail_url?: string | null;
  filename: string | null;
  kind: string | null;
  created_at: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const folderId = req.nextUrl.searchParams.get("folderId");
    const looseOnly = req.nextUrl.searchParams.get("loose") === "1";
    // Optional limit (default 300, unchanged for existing callers). Callers that
    // only need a quick browse (e.g. a reference picker) can request fewer to
    // load faster.
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") || "300");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 300) : 300;
    const sb = getServiceSupabase();
    let query = sb
      .from("studio2_media")
      .select("id, folder_id, public_url, thumbnail_url, filename, kind, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (folderId) query = query.eq("folder_id", folderId);
    if (looseOnly) query = query.is("folder_id", null);

    const initial = await query;
    let data = initial.data as StudioMediaRow[] | null;
    let error = initial.error;

    if (error && isMissingThumbnailColumn(error.message)) {
      let fallbackQuery = sb
        .from("studio2_media")
        .select("id, folder_id, public_url, filename, kind, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (folderId) fallbackQuery = fallbackQuery.eq("folder_id", folderId);
      if (looseOnly) fallbackQuery = fallbackQuery.is("folder_id", null);
      const fallback = await fallbackQuery;
      data = fallback.data as StudioMediaRow[] | null;
      error = fallback.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      media: (data || []).map((item) => ({
        id: item.id,
        folderId: item.folder_id,
        url: item.public_url,
        thumbnailUrl: "thumbnail_url" in item ? item.thumbnail_url : null,
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

function isMissingThumbnailColumn(message?: string | null) {
  const value = String(message || "").toLowerCase();
  return value.includes("thumbnail_url") && (value.includes("schema cache") || value.includes("column"));
}
