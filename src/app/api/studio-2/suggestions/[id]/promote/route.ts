import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  buildProjectFromSuggestion,
  isMissingSuggestionsTableError,
  mapSuggestionRow,
  STUDIO_SUGGESTIONS_MISSING_TABLE_MESSAGE,
  type StudioSuggestionRow,
} from "@/lib/studio-2/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const SUGGESTION_SELECT =
  "id, source_key, client_key, title, summary, offer_type, status, score, source_refs, input_snapshot, reasoning, copy_text, draft, thumbnail_url, project_id, generated_at, created_at, updated_at";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const folderId = String(body.folderId || "").trim() || null;
    const sb = getServiceSupabase();

    const { data: row, error: readError } = await sb
      .from("studio2_suggested_ads")
      .select(SUGGESTION_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      if (isMissingSuggestionsTableError(readError.message)) {
        return NextResponse.json({ error: STUDIO_SUGGESTIONS_MISSING_TABLE_MESSAGE, setupRequired: true }, { status: 500 });
      }
      return NextResponse.json({ error: readError.message }, { status: 500, headers: NO_STORE_HEADERS });
    }
    if (!row) return NextResponse.json({ error: "Suggestion not found" }, { status: 404, headers: NO_STORE_HEADERS });

    const suggestion = mapSuggestionRow(row as StudioSuggestionRow);
    if (suggestion.projectId) {
      const { data: existing } = await sb
        .from("studio2_projects")
        .select("id, folder_id, name, thumbnail_url, status, updated_at, created_at")
        .eq("id", suggestion.projectId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({
          project: {
            id: existing.id,
            folderId: existing.folder_id,
            name: existing.name,
            thumbnailUrl: existing.thumbnail_url,
            status: existing.status,
            updatedAt: existing.updated_at,
            createdAt: existing.created_at,
          },
          suggestion,
        }, { headers: NO_STORE_HEADERS });
      }
    }

    const projectInsert = {
      ...buildProjectFromSuggestion(suggestion),
      folder_id: folderId,
    };

    const { data: project, error: projectError } = await sb
      .from("studio2_projects")
      .insert(projectInsert)
      .select("id, folder_id, name, thumbnail_url, status, updated_at, created_at")
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: projectError?.message || "Could not create project from suggestion" }, { status: 500 });
    }

    const { data: updatedSuggestion } = await sb
      .from("studio2_suggested_ads")
      .update({ status: "used", project_id: project.id, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(SUGGESTION_SELECT)
      .single();

    return NextResponse.json({
      project: {
        id: project.id,
        folderId: project.folder_id,
        name: project.name,
        thumbnailUrl: project.thumbnail_url,
        status: project.status,
        updatedAt: project.updated_at,
        createdAt: project.created_at,
      },
      suggestion: updatedSuggestion ? mapSuggestionRow(updatedSuggestion as StudioSuggestionRow) : suggestion,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[studio-suggestions] promote failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not open Studio suggestion" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
