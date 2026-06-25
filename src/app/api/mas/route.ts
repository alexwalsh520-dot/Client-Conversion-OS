import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// Live source for the "Ask Ahmad" coaching tab. Reads the MAS Coaching Brain's
// state straight from Supabase at request time, with no deploy needed to update it.
// Read-only (Phase 2). Reads via the service-role client, which bypasses RLS, so the
// mas_ tables stay locked to the anon key while this route can still see them.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const out: {
    notes: unknown[];
    queries: unknown[];
    review: unknown[];
    learning: unknown[];
    error?: string;
  } = { notes: [], queries: [], review: [], learning: [] };

  try {
    const sb = getServiceSupabase();
    const [notes, queries, review, learning] = await Promise.all([
      sb.from("mas_client_notes").select("*").order("created_at", { ascending: false }).limit(200),
      sb.from("mas_queries").select("*").order("created_at", { ascending: false }).limit(200),
      sb.from("mas_review_queue").select("*").order("created_at", { ascending: false }).limit(200),
      sb.from("mas_learning_feed").select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    if (Array.isArray(notes.data)) out.notes = notes.data;
    if (Array.isArray(queries.data)) out.queries = queries.data;
    if (Array.isArray(review.data)) out.review = review.data;
    if (Array.isArray(learning.data)) out.learning = learning.data;
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ...out, error: String(e) }, { headers: { "Cache-Control": "no-store" } });
  }
}
