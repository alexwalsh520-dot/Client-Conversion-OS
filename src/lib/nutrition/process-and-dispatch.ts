// Glue: run the pipeline worker, then dispatch the trigger-specific
// side effects.
//
//   admin_test → DM Saeed with download link
//   cron_auto  → upload to CCOS nutrition-plans bucket + mark task
//                done + post to #nutritiontalk with coach @mention
//
// Never throws — caller (cron route or admin endpoint) calls this
// fire-and-forget. Each post-step has its own try/catch so a
// failed Slack post doesn't undo the upload.

import { processPipelineRun, type WorkerResult } from "./pipeline-worker";
import { shipPlanToCcos } from "./ship-plan-to-ccos";
import {
  notifyAdminTestRunDone,
  notifyAdminTestRunFailed,
  notifyNutritionTalkOfPlan,
} from "./notify-pipeline-result";

export async function processAndDispatch(runId: number): Promise<WorkerResult> {
  const result = await processPipelineRun(runId);

  // Failure path: always DM Saeed regardless of trigger type so a
  // broken pipeline is loud, not silent.
  if (result.status === "failed") {
    await notifyAdminTestRunFailed({
      runId,
      clientFullName: result.clientFullName ?? "(unknown)",
      errorMessage: result.errorMessage ?? "unknown pipeline failure",
    }).catch((err) => {
      console.warn("[process-and-dispatch] admin failure notify threw:", err);
    });
    return result;
  }

  if (!result.signedUrl || !result.clientFullName) {
    console.warn(
      "[process-and-dispatch] worker reported done but missing signedUrl/clientFullName for run",
      runId,
    );
    return result;
  }

  // Success path: branch on trigger type.
  if (result.triggerType === "cron_auto") {
    if (!result.clientId || !result.pdfBuffer) {
      // Worker should always populate these on done — fail loud.
      await notifyAdminTestRunFailed({
        runId,
        clientFullName: result.clientFullName,
        errorMessage:
          "worker returned done without clientId or pdfBuffer; can't ship to CCOS",
      });
      return result;
    }
    try {
      const ship = await shipPlanToCcos({
        clientId: result.clientId,
        clientName: result.clientFullName,
        pdfBuffer: result.pdfBuffer,
        pipelineRunId: runId,
      });
      // Use the CCOS-bucket signed URL for the Slack post (instead of
      // the auto-plans bucket URL) so the link the coach clicks is
      // the same artifact attached to the client record.
      const urlForSlack = ship.pdfSignedUrl ?? result.signedUrl;
      await notifyNutritionTalkOfPlan({
        runId,
        clientFirstName: result.clientFirstName ?? result.clientFullName.split(/\s+/)[0],
        clientFullName: result.clientFullName,
        coachInternalName: result.coachInternalName ?? null,
        pdfSignedUrl: urlForSlack,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        "[process-and-dispatch] cron_auto post-processing failed for run",
        runId,
        msg,
      );
      await notifyAdminTestRunFailed({
        runId,
        clientFullName: result.clientFullName,
        errorMessage: `Plan generated OK but post-processing (CCOS ship + nutritiontalk post) failed: ${msg}`,
      }).catch(() => {});
    }
  } else {
    // admin_test
    await notifyAdminTestRunDone({
      runId,
      clientFullName: result.clientFullName,
      signedUrl: result.signedUrl,
      coachInternalName: result.coachInternalName ?? null,
    }).catch((err) => {
      console.warn("[process-and-dispatch] admin DM threw:", err);
    });
  }

  return result;
}
