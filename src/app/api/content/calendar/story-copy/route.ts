import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { markedByLabel } from "@/lib/content/calendar-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Team-written story copy: we write it, the creator posts it. SESSION AUTH ONLY — a creator's share
// token can never reach here, so creators only ever READ copy (via the calendar GET), never write it.
// Writable for any day (today/future is the point; past is harmless). No deletion — empty copy just
// clears the text in place.
export async function PUT(req: NextRequest) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const creator = String(body?.creator || "").toLowerCase();
  const for_date = String(body?.for_date || "");
  const copy = typeof body?.copy === "string" ? body.copy : "";

  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(for_date)) {
    return NextResponse.json({ error: "Bad for_date" }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const { error } = await sb.from("content_story_copy").upsert(
    {
      client_key: creator,
      for_date,
      copy,
      updated_by: await markedByLabel("operator"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_key,for_date" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, creator, for_date, copy });
}
