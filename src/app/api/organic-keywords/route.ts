import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { normalizeKeyword, displayKeyword } from "@/lib/ads-tracker/normalize";
import { isCreatorKey } from "@/lib/creators";

export const dynamic = "force-dynamic";

async function authed() {
  const session = await auth();
  return !!session?.user;
}

// GET — list every registered organic keyword (per creator)
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("organic_keywords")
    .select("id,client_key,keyword_normalized,note,created_at")
    .order("client_key", { ascending: true })
    .order("keyword_normalized", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const keywords = (data || []).map((r) => ({ ...r, keyword_display: displayKeyword(r.keyword_normalized) }));
  return NextResponse.json({ keywords });
}

// POST — add/confirm an organic keyword for a creator. Body: { client, keyword, note? }
export async function POST(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const client = typeof body.client === "string" ? body.client.trim().toLowerCase() : "";
  const keyword = normalizeKeyword(body.keyword);
  if (!isCreatorKey(client)) return NextResponse.json({ error: "Invalid creator key" }, { status: 400 });
  if (!keyword) return NextResponse.json({ error: "Invalid keyword" }, { status: 400 });
  const sb = getServiceSupabase();
  const { error } = await sb
    .from("organic_keywords")
    .upsert(
      { client_key: client, keyword_normalized: keyword, note: typeof body.note === "string" ? body.note.trim() || null : null },
      { onConflict: "client_key,keyword_normalized" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, client_key: client, keyword_normalized: keyword, keyword_display: displayKeyword(keyword) });
}

// DELETE — remove an organic keyword. Body: { id } OR { client, keyword }
export async function DELETE(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const sb = getServiceSupabase();
  let q = sb.from("organic_keywords").delete();
  if (typeof body.id === "number") {
    q = q.eq("id", body.id);
  } else {
    const client = typeof body.client === "string" ? body.client.trim().toLowerCase() : "";
    const keyword = normalizeKeyword(body.keyword);
    if (!client || !keyword) return NextResponse.json({ error: "id or (client + keyword) required" }, { status: 400 });
    q = q.eq("client_key", client).eq("keyword_normalized", keyword);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
