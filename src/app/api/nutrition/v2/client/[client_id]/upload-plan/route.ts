/**
 * Phase B6c — POST /api/nutrition/v2/client/:client_id/upload-plan
 *
 * Coach uploads a finished PDF (built externally in Claude.ai). We:
 *   1. Validate the upload (PDF, < 10 MB)
 *   2. Compute the next version_number for this client
 *   3. Upload to Supabase storage at clients/{client_id}/v2_uploaded_v{N}_{ts}.pdf
 *   4. Insert nutrition_meal_plans row with pdf_path + uploaded_pdf_path
 *      (mirror) + uploaded_by (NextAuth session email)
 *   5. Return { plan_id, pdf_signed_url }
 *
 * NextAuth-gated. Service-role Supabase client bypasses RLS for the
 * insert (mirrors v1 generate-plan and the legacy v2 cron worker).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(
  req: NextRequest,
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

  // ---- Multipart parse ----
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "invalid form-data body — expected multipart/form-data with a 'file' field" },
      { status: 400 },
    );
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "file field missing or not a File" },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "file is empty" }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `file too large: ${file.size} bytes (max ${MAX_PDF_BYTES})` },
      { status: 400 },
    );
  }
  // Lenient content-type check — most browsers send "application/pdf";
  // some send octet-stream. Filename extension as a fallback signal.
  const ct = file.type || "application/octet-stream";
  const filenameLower = (file.name ?? "").toLowerCase();
  const looksLikePdf =
    ct === "application/pdf" ||
    ct === "application/x-pdf" ||
    filenameLower.endsWith(".pdf");
  if (!looksLikePdf) {
    return NextResponse.json(
      { error: `expected a PDF file (got content-type=${ct}, name=${file.name})` },
      { status: 400 },
    );
  }

  const db = getServiceSupabase();

  // ---- Verify client exists ----
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .single();
  if (clientErr || !client) {
    return NextResponse.json({ error: "client not found" }, { status: 404 });
  }
  const c = client as { id: number; name: string | null };

  // ---- Compute next version ----
  const { data: priorVersions } = await db
    .from("nutrition_meal_plans")
    .select("version, version_number")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1);
  const last = (priorVersions as Array<{ version: number; version_number: number | null }> | null)?.[0];
  const lastV = last?.version ?? 0;
  const lastVnum = last?.version_number ?? 0;
  const nextVersion = lastV + 1;
  const nextVersionNumber = (lastVnum ?? 0) + 1;

  // ---- Upload to storage ----
  const safeName = (c.name ?? `client_${clientId}`)
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_");
  const pdfPath = `${clientId}/v2_uploaded_v${nextVersion}_${safeName}_${Date.now()}.pdf`;
  const buf = await file.arrayBuffer();

  const { error: uploadErr } = await db.storage
    .from("nutrition-plans")
    .upload(pdfPath, buf, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadErr) {
    return NextResponse.json(
      { error: `pdf upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  // ---- Insert plan row ----
  const insertPayload = {
    client_id: clientId,
    version: nextVersion,
    version_number: nextVersionNumber,
    pdf_path: pdfPath,
    uploaded_pdf_path: pdfPath,
    uploaded_by: session.user.email,
    template_id: "coach_uploaded",
    plan_data: { v2: true, source: "coach_uploaded" },
    created_by: session.user.email,
    comments_snapshot: [],
  };
  const { data: inserted, error: insertErr } = await db
    .from("nutrition_meal_plans")
    .insert(insertPayload)
    .select("id")
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: `plan insert failed: ${insertErr?.message ?? "no row returned"}` },
      { status: 500 },
    );
  }

  // Mirror v1 behavior — flip nutrition_status to 'pending' if not 'done'.
  {
    const { data: clientRow } = await db
      .from("clients")
      .select("nutrition_status")
      .eq("id", clientId)
      .single();
    const ns = (clientRow as { nutrition_status?: string } | null)?.nutrition_status;
    if (ns !== "done") {
      await db
        .from("clients")
        .update({ nutrition_status: "pending" })
        .eq("id", clientId);
    }
  }

  // ---- Sign for return ----
  const { data: signed } = await db.storage
    .from("nutrition-plans")
    .createSignedUrl(pdfPath, 60 * 60 * 2);
  const signedUrl = (signed as { signedUrl?: string } | null)?.signedUrl ?? null;

  return NextResponse.json({
    plan_id: (inserted as { id: number }).id,
    client_id: clientId,
    version_number: nextVersionNumber,
    pdf_signed_url: signedUrl,
    uploaded_by: session.user.email,
  });
}
