/**
 * GET /api/nutrition/v2/admin/test-generate-plan
 *     ?client_id=NNN        (precise lookup)
 *  OR ?name=Zach Glanz       (case-insensitive, fuzzy match — picks
 *                              the best single match; errors if many)
 *
 * Admin-only async trigger for the auto meal-plan pipeline.
 *
 * Returns immediately with the queued run ID. The actual work
 * (gather → Claude → render → upload to private storage → sign URL)
 * runs in the background via Next's `after()` and takes 3-5 minutes.
 * When done, Saeed gets a Slack DM with a download link.
 *
 * This is the same pipeline the daily cron sweep will use; the only
 * difference is trigger_type and the post-success Slack target
 * (admin DM here, #nutritiontalk in prod with coach @mention).
 *
 * Manual-flow safety: this endpoint does NOT mutate the client row,
 * does NOT mark the task done, does NOT post to #nutritiontalk. The
 * existing copy-prompt / upload-plan flow is untouched.
 *
 * Examples:
 *   /api/nutrition/v2/admin/test-generate-plan?name=Zach%20Glanz
 *   /api/nutrition/v2/admin/test-generate-plan?client_id=1234
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { processPipelineRun } from "@/lib/nutrition/pipeline-worker";
import {
  notifyAdminTestRunDone,
  notifyAdminTestRunFailed,
} from "@/lib/nutrition/notify-pipeline-result";

export const runtime = "nodejs";
// Pro plan max. The work runs inside `after()` which gets the same
// 300s budget as the request handler.
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  const db = getServiceSupabase();

  // Resolve client by name or id
  const nameRaw = req.nextUrl.searchParams.get("name")?.trim();
  const clientIdRaw = req.nextUrl.searchParams.get("client_id");

  let clientId: number | null = null;
  let clientName: string | null = null;

  if (nameRaw) {
    const escaped = nameRaw.replace(/[%,]/g, "");
    const { data: matches, error } = await db
      .from("clients")
      .select("id, name")
      .ilike("name", `%${escaped}%`)
      .order("name", { ascending: true })
      .limit(10);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!matches || matches.length === 0) {
      return NextResponse.json(
        { error: `no client matches name "${nameRaw}"` },
        { status: 404 },
      );
    }
    if (matches.length > 1) {
      const exact = matches.find(
        (m) => (m.name as string).toLowerCase() === nameRaw.toLowerCase(),
      );
      if (exact) {
        clientId = exact.id as number;
        clientName = exact.name as string;
      } else {
        return NextResponse.json(
          {
            error: `multiple matches for "${nameRaw}" — narrow the name or use ?client_id=N`,
            matches: matches.map((m) => ({ id: m.id, name: m.name })),
          },
          { status: 400 },
        );
      }
    } else {
      clientId = matches[0].id as number;
      clientName = matches[0].name as string;
    }
  } else if (clientIdRaw) {
    const parsed = parseInt(clientIdRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "invalid client_id" }, { status: 400 });
    }
    const { data: row } = await db
      .from("clients")
      .select("id, name")
      .eq("id", parsed)
      .single();
    if (!row) {
      return NextResponse.json(
        { error: `no client with id ${parsed}` },
        { status: 404 },
      );
    }
    clientId = row.id as number;
    clientName = row.name as string;
  } else {
    return NextResponse.json(
      {
        error:
          "Provide ?name=Zach%20Glanz or ?client_id=1234. Example: /api/nutrition/v2/admin/test-generate-plan?name=Zach%20Glanz",
      },
      { status: 400 },
    );
  }

  // Insert the queued run row
  const { data: inserted, error: insertErr } = await db
    .from("nutrition_pipeline_runs")
    .insert({
      client_id: clientId,
      client_name: clientName,
      trigger_type: "admin_test",
      triggered_by: session.user.email,
      status: "queued",
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "failed to queue run" },
      { status: 500 },
    );
  }

  const runId = inserted.id as number;

  // Kick off the actual work in the background (Next 15 `after()`
  // keeps the lambda alive for up to maxDuration after the response
  // is sent). When work finishes, DM Saeed with the result.
  after(async () => {
    try {
      const result = await processPipelineRun(runId);
      if (result.status === "done" && result.signedUrl && result.clientFullName) {
        await notifyAdminTestRunDone({
          runId,
          clientFullName: result.clientFullName,
          signedUrl: result.signedUrl,
          coachInternalName: result.coachInternalName ?? null,
        });
      } else {
        await notifyAdminTestRunFailed({
          runId,
          clientFullName: clientName ?? "(unknown)",
          errorMessage: result.errorMessage ?? "unknown pipeline failure",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[test-generate-plan after()] worker threw:", msg);
      await notifyAdminTestRunFailed({
        runId,
        clientFullName: clientName ?? "(unknown)",
        errorMessage: msg,
      }).catch(() => {});
    }
  });

  // Return immediately so the browser doesn't wait. Saeed gets a
  // Slack DM in ~3-5 minutes with the PDF download link.
  return NextResponse.json({
    ok: true,
    runId,
    clientName,
    status: "queued",
    message:
      "Pipeline started. You'll get a Slack DM in ~3-5 minutes with the PDF download link. Check /api/nutrition/v2/admin/pipeline-run-status?id=" +
      runId +
      " for live status.",
  });
}
