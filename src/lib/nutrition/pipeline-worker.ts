// Auto meal-plan pipeline worker.
//
// Called by the admin test endpoint (via Next's `after()`) and by the
// daily cron sweep. Picks up a single `nutrition_pipeline_runs` row,
// runs the full pipeline, uploads the PDF to private Supabase storage,
// signs a download URL, and writes the result back to the row.
//
// The trigger-specific side effects (DM Saeed for admin_test, upload
// to CCOS + post to nutritiontalk for cron_auto) live in the caller,
// not in the worker. This keeps the worker single-purpose: gather →
// Claude → render → upload → record.

import { getServiceSupabase } from "@/lib/supabase";
import { loadIntakeAndComputeRawTargets } from "./intake-targets";
import { adjustMacros } from "./macro-adjust";
import { generatePlanHtml } from "./generate-plan-html";
import { wrapAsFullHtml } from "./plan-pdf-template";
import { renderHtmlToPdf } from "./render-pdf";

// 7-day signed URL — long enough for Saeed to download from Slack a
// few days later if he doesn't grab it immediately.
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

const STORAGE_BUCKET = "nutrition-auto-plans";

function formatGeneratedDateLabel(now: Date = new Date()): string {
  // PKT calendar date (UTC+5)
  const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return pkt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface WorkerResult {
  runId: number;
  status: "done" | "failed";
  storagePath?: string;
  signedUrl?: string;
  errorMessage?: string;
  coachInternalName?: string | null;
  clientFullName?: string;
}

/**
 * Process a single pipeline run row. Mutates the row through queued
 * → running → done/failed and returns the final state. Never throws —
 * errors are recorded on the row and surfaced via the result object.
 */
export async function processPipelineRun(runId: number): Promise<WorkerResult> {
  const db = getServiceSupabase();

  // Claim the row (queued → running). Don't fail closed if the row was
  // already claimed by another worker — just return its current state.
  const { data: claimed, error: claimErr } = await db
    .from("nutrition_pipeline_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "queued")
    .select("id, client_id, client_name, trigger_type")
    .maybeSingle();

  if (claimErr) {
    return {
      runId,
      status: "failed",
      errorMessage: `claim failed: ${claimErr.message}`,
    };
  }
  if (!claimed) {
    // Already claimed or doesn't exist; fetch current state.
    const { data: existing } = await db
      .from("nutrition_pipeline_runs")
      .select("id, status, error_message, storage_path, signed_url")
      .eq("id", runId)
      .single();
    return {
      runId,
      status: existing?.status === "done" ? "done" : "failed",
      errorMessage:
        existing?.error_message ?? "row was already claimed by another worker",
      storagePath: existing?.storage_path ?? undefined,
      signedUrl: existing?.signed_url ?? undefined,
    };
  }

  if (!claimed.client_id) {
    return await markFailed(runId, "client_id is null on the pipeline run row");
  }

  try {
    // 1. Gather intake + compute macros
    const intake = await loadIntakeAndComputeRawTargets(db, claimed.client_id);
    if (!intake.ok) {
      return await markFailed(runId, `intake load failed: ${intake.error}`);
    }
    const targets = adjustMacros(intake.raw);

    // 2. Look up coach for the on-plan alias swap
    const { data: clientRow } = await db
      .from("clients")
      .select("coach_name, name, first_name")
      .eq("id", claimed.client_id)
      .single();
    const coachInternalName = clientRow?.coach_name ?? null;
    const clientFullName =
      clientRow?.name ?? intake.clientName ?? claimed.client_name;
    const firstName =
      String(intake.intake.first_name ?? "").trim() ||
      String(clientRow?.first_name ?? "").trim() ||
      clientFullName.split(/\s+/)[0] ||
      "Client";

    // 3. Claude generates the HTML body
    const generatedDateLabel = formatGeneratedDateLabel();
    const claude = await generatePlanHtml({
      intake,
      targets,
      coachInternalName,
      generatedDateLabel,
    });

    // 4. Wrap + render to PDF
    const fullHtml = wrapAsFullHtml(claude.bodyHtml, firstName);
    const pdf = await renderHtmlToPdf(fullHtml, { clientFullName });

    // 5. Upload to private bucket
    const storagePath = `${claimed.client_id}/${runId}-${slugify(firstName)}-7day-plan.pdf`;
    const { error: uploadErr } = await db.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadErr) {
      return await markFailed(runId, `upload failed: ${uploadErr.message}`);
    }

    // 6. Sign URL for Slack DM
    const { data: signed, error: signErr } = await db.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) {
      return await markFailed(
        runId,
        `signed URL creation failed: ${signErr?.message ?? "no URL returned"}`,
      );
    }
    const signedUrlExpiresAt = new Date(
      Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
    ).toISOString();

    // 7. Mark done
    await db
      .from("nutrition_pipeline_runs")
      .update({
        status: "done",
        storage_path: storagePath,
        signed_url: signed.signedUrl,
        signed_url_expires_at: signedUrlExpiresAt,
        input_tokens: claude.inputTokens,
        output_tokens: claude.outputTokens,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return {
      runId,
      status: "done",
      storagePath,
      signedUrl: signed.signedUrl,
      coachInternalName,
      clientFullName,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return await markFailed(runId, msg);
  }
}

async function markFailed(runId: number, message: string): Promise<WorkerResult> {
  const db = getServiceSupabase();
  await db
    .from("nutrition_pipeline_runs")
    .update({
      status: "failed",
      error_message: message,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  return { runId, status: "failed", errorMessage: message };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
