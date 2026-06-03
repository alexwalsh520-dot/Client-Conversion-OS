/**
 * Variations Factory — the media gallery / history.
 *
 * GET /api/ads/variations/library?limit=200
 *   Returns the most recent generated variations across ALL winning ads, newest
 *   first, so the History panel can show one gallery of everything the factory
 *   has made (proof the images are saved and persist across visits).
 *   Response 200: { variations: [{ id, source_ad_id, job_id, kind, prompt, image_url, provider, created_at }] }
 *
 * DELETE /api/ads/variations/library?id=<variationId>
 *   Removes one variation: deletes its image from the ad-variations bucket and
 *   its row. Response 200: { ok: true, id }.
 *
 * Both require auth (mirrors the other variations routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 15;

const BUCKET = "ad-variations";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  // Keep this modest: the gallery renders full-res images, so a huge page is slow
  // to fetch + paint. 120 newest is plenty for a browse-and-grab gallery.
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") || "120");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 300) : 120;

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("ad_variations")
    .select("id, source_ad_id, job_id, kind, prompt, image_url, provider, created_at")
    .not("image_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ variations: data || [] }, { headers: NO_STORE });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400, headers: NO_STORE });
  }

  const db = getServiceSupabase();
  // Look up the row so we can also remove the stored image object.
  const { data: row, error: findErr } = await db
    .from("ad_variations")
    .select("id, image_url")
    .eq("id", id)
    .maybeSingle();
  if (findErr) {
    return NextResponse.json({ error: findErr.message }, { status: 500, headers: NO_STORE });
  }
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  }

  // Best-effort storage cleanup: derive the object path from the public URL.
  const url = String(row.image_url || "");
  const marker = `/${BUCKET}/`;
  const at = url.indexOf(marker);
  if (at >= 0) {
    const path = url.slice(at + marker.length).split("?")[0];
    if (path) {
      try {
        await db.storage.from(BUCKET).remove([decodeURIComponent(path)]);
      } catch {
        // Non-fatal: still delete the row so it leaves the gallery.
      }
    }
  }

  const { error: delErr } = await db.from("ad_variations").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, id }, { headers: NO_STORE });
}
