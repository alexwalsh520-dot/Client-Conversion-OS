import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { externalKeyOk } from "@/lib/external/auth";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { validateCarousels, type IncomingCarousel } from "@/lib/external/validate-carousels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The external worker writes a full day's 5 carousels. An external set OVERWRITES an internally-
// generated day (that's the point — the worker owns midnight-to-6am), but NEVER overwrites a slot a
// human has edited (edited=true stays). Auth: X-External-Key ONLY.
export async function POST(req: NextRequest) {
  if (!externalKeyOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const creator = String(body?.creator || "").toLowerCase();
  const forDate = String(body?.for_date || "");
  const carousels = body?.carousels;

  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown or inactive creator" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(forDate)) {
    return NextResponse.json({ error: "Bad for_date (YYYY-MM-DD)" }, { status: 400 });
  }
  const problems = validateCarousels(carousels);
  if (problems.length) return NextResponse.json({ error: "Validation failed", problems }, { status: 422 });

  const sb = getServiceSupabase();

  // Which existing slots were human-edited? Those are never overwritten.
  const { data: existing } = await sb
    .from("content_carousels")
    .select("slot, edited")
    .eq("client_key", creator)
    .eq("for_date", forDate);
  const editedSlots = new Set(
    ((existing || []) as { slot: number; edited: boolean | null }[]).filter((r) => r.edited).map((r) => r.slot),
  );

  const list = carousels as IncomingCarousel[];
  const now = new Date().toISOString();
  const rows = list
    .map((c, i) => ({
      client_key: creator,
      for_date: forDate,
      slot: i,
      topic: c.topic || null,
      slides: (Array.isArray(c.slides) ? c.slides : []).map((s) => ({ text: s.text || "" })),
      origin: "external",
      meta: { objection: c.objection ?? null, source: c.source ?? null },
      model: "external",
      updated_at: now,
    }))
    .filter((r) => !editedSlots.has(r.slot)); // preserve human-edited slots

  if (!rows.length) {
    return NextResponse.json({ ok: true, creator, date: forDate, written: 0, skipped_edited: [...editedSlots], note: "all slots are human-edited; nothing overwritten" });
  }

  // Upsert with origin+meta; if the migration hasn't landed yet, retry without those columns so the
  // write still succeeds (graceful degradation — the copy lands, provenance fills in once migrated).
  let error = (await sb.from("content_carousels").upsert(rows, { onConflict: "client_key,for_date,slot" })).error;
  let degraded = false;
  if (error && /origin|meta/i.test(error.message)) {
    const bare = rows.map(({ origin: _o, meta: _m, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
    error = (await sb.from("content_carousels").upsert(bare, { onConflict: "client_key,for_date,slot" })).error;
    degraded = true;
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    creator,
    date: forDate,
    written: rows.length,
    skipped_edited: [...editedSlots],
    provenance_stored: !degraded,
  });
}
