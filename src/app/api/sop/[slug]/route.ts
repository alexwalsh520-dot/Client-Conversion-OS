/**
 * SOP library: single-document endpoints.
 *
 *   GET    /api/sop/[slug]
 *     → SopWithRelations + a freshly-signed download URL (TTL 2hr).
 *       Used by the viewer page (PDF iframe + Download button).
 *
 *   DELETE /api/sop/[slug]
 *     → removes the sops row (cascades role assignments) AND deletes the
 *       storage object. Admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSopBySlug, deleteSop, getSignedDownloadUrl } from "@/lib/sop/data";

export const runtime = "nodejs";
export const maxDuration = 10;

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
    const signedUrl = await getSignedDownloadUrl(sop.file_path, sop.file_name);
    return NextResponse.json({ sop, signedUrl });
  } catch (err) {
    console.error(`[api/sop/${slug} GET] failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch failed" },
      { status: 500 }
    );
  }
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
