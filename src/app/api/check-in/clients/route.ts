/**
 * GET /api/check-in/clients?q=<search>
 *
 * Public typeahead search for the /check-in form's client dropdown.
 * Returns up to 20 matches. Requires q.length >= 2 to avoid leaking
 * the full client list to a casual GET. Rate-limited per IP at the
 * Vercel edge layer (default).
 *
 * Searches across name + email (case-insensitive). Returns id, name,
 * email — coach + dates intentionally excluded (the client doesn't
 * need to see those, and they're not necessary for picking yourself).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import type { CheckInClientOption } from "@/lib/check-in/types";

export const runtime = "nodejs";
export const maxDuration = 5;

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 20;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY_LENGTH) {
    // Don't 400 — empty results keeps the dropdown silent until the
    // user types enough characters.
    return NextResponse.json({ clients: [] });
  }

  const db = getServiceSupabase();

  // Escape PostgREST `or` filter wildcards. % and , are the dangerous
  // ones for or-filters; replace them so search input can't break out.
  const escaped = q.replace(/[%,]/g, "");
  if (!escaped) return NextResponse.json({ clients: [] });

  const { data, error } = await db
    .from("clients")
    .select("id, name, email")
    .or(`name.ilike.%${escaped}%,email.ilike.%${escaped}%`)
    .order("name", { ascending: true })
    .limit(MAX_RESULTS);

  if (error) {
    console.error("[api/check-in/clients] search failed:", error.message);
    // Don't leak DB errors; return empty list so the UI degrades gracefully.
    return NextResponse.json({ clients: [] });
  }

  const clients: CheckInClientOption[] = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
  }));

  return NextResponse.json({ clients });
}
