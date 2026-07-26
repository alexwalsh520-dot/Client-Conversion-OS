import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { resolveCalendarAccess } from "@/lib/content/calendar-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

// GET the day's carousels for one creator. READ-ONLY, so it also accepts a creator's share token —
// exactly like every other token surface, the creator comes FROM THE TOKEN and any client-supplied
// `creator` is ignored, so one creator's token can never read another's sets. Writes (PATCH below)
// stay session-only: the creator's view is read + use, never manage.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  let slug: string;
  if (token) {
    const access = await resolveCalendarAccess(req, token, null, false);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    slug = access.creator;
  } else {
    if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    slug = (url.searchParams.get("creator") || "").toLowerCase();
  }
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  const date = url.searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Bad date" }, { status: 400 });

  const sb = getServiceSupabase();
  const { data } = await sb
    .from("content_carousels")
    .select("*")
    .eq("client_key", slug)
    .eq("for_date", date)
    .order("slot", { ascending: true });
  return NextResponse.json({ ok: true, creator: slug, date, carousels: data || [] });
}

// PATCH one carousel's slides (the editor's save). Replaces slides jsonb and marks edited.
export async function PATCH(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = body?.id;
  const slides = body?.slides;
  if (!id || !Array.isArray(slides)) return NextResponse.json({ error: "id and slides[] required" }, { status: 400 });
  if (slides.length < 1 || slides.length > 10) return NextResponse.json({ error: "1-10 slides" }, { status: 400 });
  for (const s of slides) {
    const hasText = typeof s?.text === "string";
    const hasBlocks = Array.isArray(s?.blocks);
    if (!hasText && !hasBlocks) return NextResponse.json({ error: "each slide needs text and/or blocks" }, { status: 400 });
    if (hasText && s.text.length > 1200) return NextResponse.json({ error: "slide text too long (max 1200)" }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("content_carousels")
    .update({ slides, edited: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, carousel: data });
}
