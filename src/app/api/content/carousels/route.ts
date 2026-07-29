import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { resolveCalendarAccess } from "@/lib/content/calendar-access";
import { isLive, isQuarantined, type CarouselMeta } from "@/lib/content/carousel-config";
import { getCadence } from "@/lib/content/calendar-build";

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
  let isOperator = false;
  if (token) {
    const access = await resolveCalendarAccess(req, token, null, false);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    slug = access.creator;
  } else {
    if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    slug = (url.searchParams.get("creator") || "").toLowerCase();
    isOperator = true;
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
  // QUARANTINE BOUNDARY. A set the audience audit rejected exists only for the operator: it never
  // reaches the token page, and because every download and export is built from what this endpoint
  // returns, it can never reach a zip either.
  const all = (data || []) as { meta?: CarouselMeta }[];
  const live = all.filter(isLive);
  const quarantined = isOperator ? all.filter(isQuarantined) : [];

  // The view says what the creator actually owes today. Generated sets are a resource; the cadence
  // slot is the obligation, and they are deliberately different numbers.
  const cadence = await getCadence(sb, slug).catch(() => null);
  return NextResponse.json({
    ok: true,
    creator: slug,
    date,
    carousels: live,
    quarantined,
    carousels_due: cadence?.carousels_per_day ?? 0,
  });
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


// Operator verdict on a quarantined day.
//   approve -> clear the flag; the set becomes the day's content.
//   discard -> remove it. This is the ratified same-day-supersede deletion path, scoped to one
//              creator + one date + quarantined rows only, and it can never touch live content.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const creator = String(body?.creator || "").toLowerCase();
  const date = String(body?.date || "");
  const action = String(body?.action || "");
  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Bad date" }, { status: 400 });
  if (action !== "approve" && action !== "discard") return NextResponse.json({ error: "action must be approve or discard" }, { status: 400 });

  const sb = getServiceSupabase();
  const { data } = await sb.from("content_carousels").select("id, meta").eq("client_key", creator).eq("for_date", date);
  const rows = ((data || []) as { id: number; meta?: CarouselMeta }[]).filter(isQuarantined);
  if (!rows.length) return NextResponse.json({ ok: false, error: "No quarantined carousels for that creator and date" }, { status: 200 });

  if (action === "approve") {
    for (const r of rows) {
      const meta = { ...(r.meta || {}) } as Record<string, unknown>;
      delete meta.quarantined;
      delete meta.audit_reason;
      await sb.from("content_carousels").update({ meta }).eq("id", r.id);
    }
    return NextResponse.json({ ok: true, action, creator, date, approved: rows.length });
  }

  const ids = rows.map((r) => r.id);
  const { error } = await sb.from("content_carousels").delete().in("id", ids);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 200 });
  return NextResponse.json({ ok: true, action, creator, date, discarded: ids.length });
}
