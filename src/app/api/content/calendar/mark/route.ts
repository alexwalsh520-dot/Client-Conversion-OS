import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { resolveCalendarAccess, markedByLabel } from "@/lib/content/calendar-access";
import { getCadence } from "@/lib/content/calendar-build";
import { todayIn } from "@/lib/content/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Toggle a manual mark. Manual marks override detection in both directions: done=true claims the
// slot (amber CLAIMED until a post is found), done=false forces it not-done even if a post exists.
//
// Auth: operator session, or a creator's share token. On the token path the creator comes from the
// token — `creator` in the body is never read, so a token can only ever write its own calendar.
// Writes never accept CRON_SECRET (allowCron=false): a mark is a human act.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || (typeof body?.token === "string" ? body.token : null);

  const access = await resolveCalendarAccess(req, token, typeof body?.creator === "string" ? body.creator : null, false);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const creator = access.creator;

  const for_date = String(body?.for_date || "");
  const slot_type = String(body?.slot_type || "");
  const slot_index = Number(body?.slot_index);
  const done = Boolean(body?.done);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(for_date)) return NextResponse.json({ error: "Bad for_date" }, { status: 400 });
  if (!["reel", "carousel", "story"].includes(slot_type)) return NextResponse.json({ error: "Bad slot_type" }, { status: 400 });
  if (!Number.isInteger(slot_index) || slot_index < 1) return NextResponse.json({ error: "Bad slot_index" }, { status: 400 });

  const sb = getServiceSupabase();

  // Creators check off today and the past — never a future day, and never a finalized one.
  const cadence = await getCadence(sb, creator);
  if (for_date > todayIn(cadence.timezone)) {
    return NextResponse.json({ error: "That day hasn't happened yet" }, { status: 400 });
  }
  try {
    const { data: dayRow } = await sb
      .from("content_calendar_days")
      .select("finalized")
      .eq("client_key", creator)
      .eq("for_date", for_date)
      .maybeSingle();
    if ((dayRow as { finalized?: boolean } | null)?.finalized && access.viewer === "creator") {
      return NextResponse.json({ error: "That day is already closed" }, { status: 400 });
    }
  } catch { /* table not created yet — nothing to lock against */ }

  const { error } = await sb.from("content_calendar_marks").upsert(
    {
      client_key: creator,
      for_date,
      slot_type,
      slot_index,
      done,
      marked_by: await markedByLabel(access.viewer),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_key,for_date,slot_type,slot_index" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, creator, for_date, slot_type, slot_index, done });
}
