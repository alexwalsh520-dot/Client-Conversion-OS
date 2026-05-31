import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  isMissingSuggestionsTableError,
  mapSuggestionRow,
  normalizeSuggestionStatus,
  STUDIO_SUGGESTIONS_MISSING_TABLE_MESSAGE,
  type StudioSuggestionRow,
} from "@/lib/studio-2/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const SUGGESTION_SELECT =
  "id, source_key, client_key, title, summary, offer_type, status, score, source_refs, input_snapshot, reasoning, copy_text, draft, thumbnail_url, project_id, generated_at, created_at, updated_at";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("studio2_suggested_ads")
      .select(SUGGESTION_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      if (isMissingSuggestionsTableError(error.message)) {
        return NextResponse.json({ error: STUDIO_SUGGESTIONS_MISSING_TABLE_MESSAGE, setupRequired: true }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }
    if (!data) return NextResponse.json({ error: "Suggestion not found" }, { status: 404, headers: NO_STORE_HEADERS });

    return NextResponse.json({ suggestion: mapSuggestionRow(data as StudioSuggestionRow) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[studio-suggestions] read failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read Studio suggestion" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json() as Record<string, unknown>;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.status !== undefined) updates.status = normalizeSuggestionStatus(body.status);
    if (body.title !== undefined) updates.title = String(body.title || "Suggested ad").trim() || "Suggested ad";
    if (body.summary !== undefined) updates.summary = String(body.summary || "").trim();
    if (body.reasoning !== undefined && body.reasoning && typeof body.reasoning === "object" && !Array.isArray(body.reasoning)) {
      updates.reasoning = body.reasoning;
    }
    if (body.draft !== undefined && body.draft && typeof body.draft === "object" && !Array.isArray(body.draft)) {
      updates.draft = body.draft;
    }
    if (body.copyText !== undefined) updates.copy_text = String(body.copyText || "").trim();
    if (body.projectId !== undefined) updates.project_id = String(body.projectId || "").trim() || null;

    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("studio2_suggested_ads")
      .update(updates)
      .eq("id", id)
      .select(SUGGESTION_SELECT)
      .single();

    if (error || !data) {
      if (isMissingSuggestionsTableError(error?.message)) {
        return NextResponse.json({ error: STUDIO_SUGGESTIONS_MISSING_TABLE_MESSAGE, setupRequired: true }, { status: 500 });
      }
      return NextResponse.json({ error: error?.message || "Suggestion update failed" }, { status: 500 });
    }

    return NextResponse.json({ suggestion: mapSuggestionRow(data as StudioSuggestionRow) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[studio-suggestions] update failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update Studio suggestion" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
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
      .from("studio2_suggested_ads")
      .update({ status: "dismissed", updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      if (isMissingSuggestionsTableError(error.message)) {
        return NextResponse.json({ error: STUDIO_SUGGESTIONS_MISSING_TABLE_MESSAGE, setupRequired: true }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[studio-suggestions] dismiss failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not dismiss Studio suggestion" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
