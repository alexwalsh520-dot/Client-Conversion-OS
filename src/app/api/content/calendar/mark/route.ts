import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Toggle (or set) a manual mark for one slot. Manual marks override detection in both directions:
// done=true forces the slot green even if no post was detected; done=false forces it not-covered
// even if a post exists. Operator session only.
export async function PATCH(req: NextRequest) {
  const s = await auth().catch(() => null);
  if (!s?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const creator = String(body?.creator || "").toLowerCase();
  const for_date = String(body?.for_date || "");
  const slot_type = String(body?.slot_type || "");
  const slot_index = Number(body?.slot_index);
  const done = Boolean(body?.done);

  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(for_date)) return NextResponse.json({ error: "Bad for_date" }, { status: 400 });
  if (!["reel", "carousel", "story"].includes(slot_type)) return NextResponse.json({ error: "Bad slot_type" }, { status: 400 });
  if (!Number.isInteger(slot_index) || slot_index < 1) return NextResponse.json({ error: "Bad slot_index" }, { status: 400 });

  const sb = getServiceSupabase();
  const { error } = await sb.from("content_calendar_marks").upsert(
    {
      client_key: creator,
      for_date,
      slot_type,
      slot_index,
      done,
      marked_by: s.user.email || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_key,for_date,slot_type,slot_index" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, creator, for_date, slot_type, slot_index, done });
}
