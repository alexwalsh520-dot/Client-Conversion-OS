/**
 * Phase B6b — GET /api/nutrition/v2/client/:client_id/plans
 *
 * Lists every plan version for a client, ordered by version desc. Each
 * row carries a freshly-signed PDF URL + a status badge derived from
 * audit_results + coach_review_recommended + manual_completion.
 *
 * Drives the "Previous Plan Versions" history dropdown in the Coach UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 10;

type StatusBadge = "clean" | "coach_review" | "blocked" | "manual";

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
      "id, version, version_number, pdf_path, audit_results, coach_review_recommended, manual_completion, parent_plan_id, template_id, created_at, created_by",
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
      const audit = r.audit_results as
        | { blocking_errors?: unknown[]; action?: string }
        | null;
      const blockingCount = Array.isArray(audit?.blocking_errors)
        ? audit!.blocking_errors!.length
        : 0;
      const isManual = Boolean(r.manual_completion);
      const coachReview = Boolean(r.coach_review_recommended);
      const blocked =
        !r.pdf_path ||
        audit?.action === "BLOCK_GENERATION_RETURN_TO_COACH" ||
        blockingCount > 0;

      const status: StatusBadge = isManual
        ? "manual"
        : blocked
          ? "blocked"
          : coachReview
            ? "coach_review"
            : "clean";

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
        template_id: r.template_id,
        parent_plan_id: r.parent_plan_id,
        coach_review_recommended: coachReview,
        manual_completion: isManual,
        status,
        pdf_signed_url: signedUrl,
      };
    }),
  );

  return NextResponse.json({ client_id: clientId, plans });
}
