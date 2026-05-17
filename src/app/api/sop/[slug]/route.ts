/**
 * SOP single-document endpoints.
 *
 *   GET    /api/sop/[slug]
 *     → SopWithRelations.
 *
 *   PATCH  /api/sop/[slug]
 *     → edit fields (title, description, department_id, role_ids, tags, body_html).
 *       Admins only.
 *
 *   DELETE /api/sop/[slug]
 *     → removes the sops row (cascades role assignments). Admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { getSopBySlug, deleteSop, setRoleAssignments } from "@/lib/sop/data";
import { sanitizeSopHtml } from "@/lib/sop/sanitize";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { slug } = await ctx.params;
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }
  try {
    const sop = await getSopBySlug(slug);
    if (!sop) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ sop });
  } catch (err) {
    console.error(`[api/sop/${slug} GET] failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch failed" },
      { status: 500 }
    );
  }
}

interface PatchBody {
  title?: string;
  description?: string | null;
  department_id?: number;
  role_ids?: number[];
  tags?: string[];
  body_html?: string;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }
  const { slug } = await ctx.params;
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const existing = await getSopBySlug(slug);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title.trim();
  if ("description" in body) update.description = body.description?.trim() || null;
  if (typeof body.department_id === "number") update.department_id = body.department_id;
  if (Array.isArray(body.tags)) {
    update.tags = body.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 20);
  }
  if (typeof body.body_html === "string") {
    const clean = sanitizeSopHtml(body.body_html);
    if (!clean.trim()) {
      return NextResponse.json({ error: "body cannot be empty" }, { status: 400 });
    }
    update.body_html = clean;
  }

  if (Object.keys(update).length > 0) {
    const { error: updateErr } = await db.from("sops").update(update).eq("id", existing.id);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  }

  if (Array.isArray(body.role_ids)) {
    try {
      await setRoleAssignments(existing.id, body.role_ids.filter((n) => Number.isFinite(n)));
    } catch (err) {
      console.error(`[api/sop/${slug} PATCH] role assignment failed:`, err);
      // Non-fatal
    }
  }

  const updated = await getSopBySlug(slug);
  return NextResponse.json({ sop: updated });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }
  const { slug } = await ctx.params;
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }
  try {
    const sop = await getSopBySlug(slug);
    if (!sop) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    await deleteSop(sop.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[api/sop/${slug} DELETE] failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 }
    );
  }
}
