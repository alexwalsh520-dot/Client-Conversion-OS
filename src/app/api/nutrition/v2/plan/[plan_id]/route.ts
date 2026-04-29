/**
 * Phase B6b — GET /api/nutrition/v2/plan/:plan_id
 *
 * Returns a single plan row + freshly-signed PDF URL. Drives the
 * Coach UI's State 2 / 3 panels.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ plan_id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { plan_id: planIdRaw } = await ctx.params;
  const planId = parseInt(planIdRaw, 10);
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: "invalid plan_id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("nutrition_meal_plans")
    .select(
      "id, client_id, version, version_number, build_type, dietary_style, allergy_flags, medical_flags, plan_complexity, distribution_template, audit_results, pdf_path, created_at, created_by, template_id, coach_review_recommended, complexity_reasons, parent_plan_id, manual_completion",
    )
    .eq("id", planId)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "plan not found" }, { status: 404 });
  }
  const r = data as Record<string, unknown>;

  let signedUrl: string | null = null;
  if (r.pdf_path) {
    const { data: signed } = await db.storage
      .from("nutrition-plans")
      .createSignedUrl(String(r.pdf_path), 60 * 60 * 2);
    signedUrl = (signed as { signedUrl?: string } | null)?.signedUrl ?? null;
  }

  // Audit summary derived for UI display
  const audit = r.audit_results as
    | { pass?: boolean; blocking_errors?: unknown[]; warnings?: unknown[]; action?: string }
    | null;
  const audit_summary = audit
    ? {
        pass: Boolean(audit.pass),
        action: audit.action ?? null,
        blocking_count: Array.isArray(audit.blocking_errors)
          ? audit.blocking_errors.length
          : 0,
        warning_count: Array.isArray(audit.warnings) ? audit.warnings.length : 0,
      }
    : null;

  return NextResponse.json({
    plan: r,
    pdf_signed_url: signedUrl,
    audit_summary,
  });
}
