import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  buildSuggestionInsert,
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

export async function GET(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    const status = req.nextUrl.searchParams.get("status");
    const clientKey = req.nextUrl.searchParams.get("clientKey");
    const limit = Math.max(1, Math.min(60, Number(req.nextUrl.searchParams.get("limit") || 20) || 20));

    let query = sb
      .from("studio2_suggested_ads")
      .select(SUGGESTION_SELECT)
      .order("score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status && status !== "all") query = query.eq("status", status);
    if (clientKey && clientKey !== "all") query = query.eq("client_key", clientKey);

    const { data, error } = await query;

    if (error) {
      if (isMissingSuggestionsTableError(error.message)) {
        return NextResponse.json({ suggestions: [], setupRequired: true }, { headers: NO_STORE_HEADERS });
      }
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({
      suggestions: ((data || []) as StudioSuggestionRow[]).map(mapSuggestionRow),
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[studio-suggestions] list failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Studio suggestions" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const sb = getServiceSupabase();
    const insert = buildSuggestionInsert(body);

    const { data, error } = await sb
      .from("studio2_suggested_ads")
      .upsert(insert, { onConflict: "source_key" })
      .select(SUGGESTION_SELECT)
      .single();

    if (error || !data) {
      if (isMissingSuggestionsTableError(error?.message)) {
        return NextResponse.json({ error: STUDIO_SUGGESTIONS_MISSING_TABLE_MESSAGE, setupRequired: true }, { status: 500 });
      }
      return NextResponse.json({ error: error?.message || "Suggestion save failed" }, { status: 500 });
    }

    return NextResponse.json({ suggestion: mapSuggestionRow(data as StudioSuggestionRow) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[studio-suggestions] save failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save Studio suggestion" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
