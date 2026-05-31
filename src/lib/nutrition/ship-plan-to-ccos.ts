// Ship an auto-generated meal plan PDF into CCOS, mirroring the
// manual upload-plan flow exactly. Used by the cron-auto branch of
// the pipeline worker.
//
// Mirrors src/app/api/nutrition/v2/client/[client_id]/upload-plan
// (same versioning logic, same storage path format, same DB shape)
// so the auto-generated plan shows up in the coach UI identical to
// a manually uploaded plan. Differences:
//   - template_id is "auto_generated" (not "coach_uploaded")
//   - uploaded_by is "ccos-auto-pipeline" (not a real user email)
//   - nutrition_status is flipped straight to "done" (vs pending)
//     since the auto-pipeline includes upload + mark-done as a
//     single atomic step

import { getServiceSupabase } from "@/lib/supabase";

const TARGET_BUCKET = "nutrition-plans";

export interface ShipResult {
  planId: number;
  pdfPath: string;
  pdfSignedUrl: string | null;
  versionNumber: number;
}

export async function shipPlanToCcos(params: {
  clientId: number;
  clientName: string;
  pdfBuffer: Buffer;
  pipelineRunId: number;
}): Promise<ShipResult> {
  const { clientId, clientName, pdfBuffer, pipelineRunId } = params;
  const db = getServiceSupabase();

  // Compute next version (mirror upload-plan logic exactly)
  const { data: priorVersions } = await db
    .from("nutrition_meal_plans")
    .select("version, version_number")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1);
  const last = (priorVersions as Array<{
    version: number;
    version_number: number | null;
  }> | null)?.[0];
  const lastV = last?.version ?? 0;
  const lastVnum = last?.version_number ?? 0;
  const nextVersion = lastV + 1;
  const nextVersionNumber = (lastVnum ?? 0) + 1;

  // Storage path mirrors the manual upload pattern; "auto" suffix
  // makes it distinguishable in the bucket browser.
  const safeName = clientName
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_");
  const pdfPath = `${clientId}/v2_auto_v${nextVersion}_${safeName}_${Date.now()}.pdf`;

  const { error: uploadErr } = await db.storage
    .from(TARGET_BUCKET)
    .upload(pdfPath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadErr) {
    throw new Error(`CCOS upload failed: ${uploadErr.message}`);
  }

  // Insert nutrition_meal_plans row
  const insertPayload = {
    client_id: clientId,
    version: nextVersion,
    version_number: nextVersionNumber,
    pdf_path: pdfPath,
    uploaded_pdf_path: pdfPath,
    uploaded_by: "ccos-auto-pipeline",
    template_id: "auto_generated",
    plan_data: {
      v2: true,
      source: "auto_pipeline",
      pipeline_run_id: pipelineRunId,
    },
    created_by: "ccos-auto-pipeline",
    comments_snapshot: [],
  };
  const { data: inserted, error: insertErr } = await db
    .from("nutrition_meal_plans")
    .insert(insertPayload)
    .select("id")
    .single();
  if (insertErr || !inserted) {
    throw new Error(
      `nutrition_meal_plans insert failed: ${insertErr?.message ?? "no row returned"}`,
    );
  }

  // Mark nutrition task done on the client row.
  await db
    .from("clients")
    .update({ nutrition_status: "done" })
    .eq("id", clientId);

  // Short-lived signed URL for the immediate Slack post. The
  // private auto-plans bucket also keeps a copy with a 7d URL for
  // audit; this 2h URL is the one we hand off to coaches.
  const { data: signed } = await db.storage
    .from(TARGET_BUCKET)
    .createSignedUrl(pdfPath, 60 * 60 * 24 * 7); // 7d
  const signedUrl = (signed as { signedUrl?: string } | null)?.signedUrl ?? null;

  return {
    planId: (inserted as { id: number }).id,
    pdfPath,
    pdfSignedUrl: signedUrl,
    versionNumber: nextVersionNumber,
  };
}
