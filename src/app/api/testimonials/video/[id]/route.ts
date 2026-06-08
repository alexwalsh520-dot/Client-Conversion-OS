// Admin-only management for a single video testimonial.
//
//   PATCH  /api/testimonials/video/<id>   { featured: boolean }
//     Toggle whether the video shows in the native gallery on the public
//     /testimonials page. Only submitted videos can be featured.
//
//   DELETE /api/testimonials/video/<id>
//     Permanently remove the testimonial: delete the underlying R2 object
//     (best-effort) and then the DB row.
//
// Both require an authenticated admin. The public playback route only ever
// serves rows where featured = true AND status = 'submitted'.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { deleteR2Object } from "@/lib/r2";

export const runtime = "nodejs";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rowId = parseId(id);
  if (!rowId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const featured = Boolean(body.featured);

  const db = getServiceSupabase();

  // Only a submitted video can be featured publicly.
  const { data: row } = await db
    .from("video_testimonials")
    .select("id, status")
    .eq("id", rowId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (featured && row.status !== "submitted") {
    return NextResponse.json({ error: "Only submitted videos can be featured" }, { status: 400 });
  }

  const { error } = await db
    .from("video_testimonials")
    .update({
      featured,
      featured_at: featured ? new Date().toISOString() : null,
      featured_by: featured ? session.user.email ?? null : null,
    })
    .eq("id", rowId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, featured });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rowId = parseId(id);
  if (!rowId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const db = getServiceSupabase();
  const { data: row } = await db
    .from("video_testimonials")
    .select("id, r2_key")
    .eq("id", rowId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete the R2 object first (best-effort). If it fails we still remove the
  // row so it disappears from the admin list; a stray object is harmless and
  // unguessable. deleteR2Object already treats 404 as success.
  if (row.r2_key) {
    try {
      await deleteR2Object(row.r2_key);
    } catch (err) {
      console.warn(`[testimonials/video/${rowId}] R2 delete failed:`, err);
    }
  }

  const { error } = await db.from("video_testimonials").delete().eq("id", rowId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
