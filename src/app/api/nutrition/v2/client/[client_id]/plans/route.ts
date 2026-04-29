/**
 * Phase B6c — GET /api/nutrition/v2/client/:client_id/plans
 *
 * Lists every plan version for a client, ordered by version desc. Each
 * row carries a freshly-signed PDF URL + a status flag derived from
 * `uploaded_pdf_path` (true → manual upload, false → legacy v1 auto-gen).
 *
 * Simplified post-rip-out: no more coach_review status badges — just
 * "uploaded" vs "legacy".
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ client_id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { client_id: rawId } = await ctx.params;
  const clientId = parseInt(rawId, 10);
  if (!Number.isFinite(clientId)) {
    return NextResponse.json({ error: "invalid client_id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("nutrition_meal_plans")
    .select(
      "id, version, version_number, pdf_path, uploaded_pdf_path, uploaded_by, created_at, created_by, template_id",
    )
    .eq("client_id", clientId)
    .order("version_number", { ascending: false, nullsFirst: false })
    .order("version", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const plans = await Promise.all(
    (data ?? []).map(async (row) => {
      const r = row as Record<string, unknown>;
      let signedUrl: string | null = null;
      if (r.pdf_path) {
        const { data: signed } = await db.storage
          .from("nutrition-plans")
          .createSignedUrl(String(r.pdf_path), 60 * 60 * 2);
        signedUrl = (signed as { signedUrl?: string } | null)?.signedUrl ?? null;
      }
      return {
        plan_id: r.id,
        version: r.version,
        version_number: r.version_number,
        created_at: r.created_at,
        created_by: r.created_by,
        uploaded_by: r.uploaded_by,
        is_uploaded: r.uploaded_pdf_path != null,
        template_id: r.template_id,
        pdf_signed_url: signedUrl,
      };
    }),
  );

  return NextResponse.json({ client_id: clientId, plans });
}
