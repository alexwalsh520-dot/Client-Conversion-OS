import { createHash } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase";
import {
  requireAccess,
  requireSameOrigin,
  HttpError,
  errorResponse,
} from "@/lib/everfit/server";
import {
  parseCapture,
  parseSyncPlan,
  type SyncClient,
} from "@/lib/everfit/sync-validation";
import { readSyncRoster, summarizeCapture } from "@/lib/everfit/sync-summary";
import { parseImport, pkDate, record } from "@/lib/everfit/validation";
import { matchReport } from "@/lib/everfit/matching";
import type { EverfitBrief } from "@/lib/everfit/types";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const access = await requireAccess();
    if (!access.admin)
      throw new HttpError(
        "Only administrators can start an Everfit sync.",
        403,
      );
    requireSameOrigin(request);
    if (Number(request.headers.get("content-length")) > 1000000)
      throw new HttpError("Capture too large.", 413);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 1000000)
      throw new HttpError("Capture too large.", 413);
    let body: Record<string, unknown>;
    try {
      body = record(JSON.parse(raw));
    } catch {
      throw new HttpError("Invalid sync request.", 400);
    }
    const db = getServiceSupabase();
    if (body.action === "preflight") {
      if (!process.env.ANTHROPIC_API_KEY)
        throw new HttpError("The CCOS AI connection is unavailable.", 503);
      const { error } = await db
        .from("everfit_sync_runs")
        .select("id")
        .limit(1);
      if (error) throw error;
      return Response.json({ ready: true });
    }
    if (body.action === "start") {
      let plan: SyncClient[];
      try {
        plan = parseSyncPlan(body.plan);
      } catch (e) {
        throw new HttpError((e as Error).message, 400);
      }
      const { data: active, error: activeError } = await db
        .from("everfit_sync_runs")
        .select("id,started_at")
        .eq("actor", access.email)
        .eq("status", "running")
        .maybeSingle();
      if (activeError) throw activeError;
      if (active) return Response.json({ runId: active.id, resumed: true });
      const { data, error } = await db
        .from("everfit_sync_runs")
        .insert({ actor: access.email, plan, status: "running" })
        .select("id")
        .single();
      if (error) throw error;
      return Response.json({ runId: data.id });
    }
    if (typeof body.runId !== "string" || !/^[a-f0-9-]{36}$/.test(body.runId))
      throw new HttpError("Invalid sync ID.", 400);
    const { data: run, error: runError } = await db
      .from("everfit_sync_runs")
      .select("*")
      .eq("id", body.runId)
      .eq("actor", access.email)
      .maybeSingle();
    if (runError) throw runError;
    if (!run) throw new HttpError("Sync not found.", 404);
    const plan = run.plan as SyncClient[];
    if (body.action === "resume") {
      if (run.status === "partial") {
        const {error}=await db.from('everfit_sync_runs').update({status:'running',finished_at:null}).eq('id',run.id).eq('status','partial');
        if(error) throw error;
      } else if(run.status !== 'running') throw new HttpError('Start a new sync for this completed run.',409);
      return Response.json({resumed:true});
    }
    if (body.action === "status") {
      const { data, error } = await db
        .from("everfit_sync_items")
        .select("everfit_id,status,error")
        .eq("run_id", run.id);
      if (error) throw error;
      const {data:previous,error:previousError}=await db.from('everfit_sync_runs').select('started_at').eq('actor',access.email).eq('status','completed').lt('started_at',run.started_at).order('started_at',{ascending:false}).limit(1);
      if(previousError) throw previousError;
      const historySince=new Date(Math.min(Date.parse(run.started_at)-9*86400000,previous?.[0]?Date.parse(previous[0].started_at)-2*86400000:Infinity)).toISOString();
      return Response.json({
        historySince,
        runId: run.id,
        status: run.status,
        plan,
        items: data,
        reports: run.report_ids,
      });
    }
    if (body.action === "cancel") {
      const { error } = await db
        .from("everfit_sync_runs")
        .update({ status: "cancelled", finished_at: new Date().toISOString() })
        .eq("id", run.id)
        .eq("status", "running");
      if (error) throw error;
      return Response.json({ cancelled: true });
    }
    if (
      body.action === "finish" &&
      ["completed", "partial"].includes(run.status)
    )
      return Response.json({ status: run.status, reports: run.report_ids });
    if (run.status !== "running")
      throw new HttpError("This sync is no longer running.", 409);
    if (body.action === "capture") {
      let capture;
      try {
        capture = parseCapture(body.capture);
      } catch (e) {
        throw new HttpError((e as Error).message, 400);
      }
      const client = plan.find((c) => c.id === capture.id);
      if (!client || client.owner !== capture.owner)
        throw new HttpError(
          "Client or coach does not match the sync roster.",
          409,
        );
      // Claim a bounded processing lease atomically. A timed-out request may be retried,
      // but a concurrent delivery cannot pay for another summary or overwrite completed data.
      const { data: claimed, error: claimError } = await db.rpc(
        "claim_everfit_sync_item",
        {
          p_run: run.id,
          p_client: capture.id,
          p_capture: capture,
          p_actor: access.email,
        },
      );
      if (claimError) throw claimError;
      if (claimed === "completed") return Response.json({ saved: true });
      if (claimed !== "claimed")
        throw new HttpError(
          "This client is still being processed. Retry shortly.",
          409,
        );
      try {
        const summary = await summarizeCapture(client, capture, run.started_at);
        const { error } = await db
          .from("everfit_sync_items")
          .update({
            status: "completed",
            brief: summary.brief,
            coach_name: summary.coach,
            error: null,
          })
          .eq("run_id", run.id)
          .eq("everfit_id", capture.id);
        if (error) throw error;
        return Response.json({ saved: true });
      } catch (e) {
        await db
          .from("everfit_sync_items")
          .update({
            status: "failed",
            error: "Summary unavailable; retry required.",
          })
          .eq("run_id", run.id)
          .eq("everfit_id", capture.id);
        throw e;
      }
    }
    if (body.action === "failure") {
      if (
        typeof body.clientId !== "string" ||
        !plan.some((c) => c.id === body.clientId)
      )
        throw new HttpError("Unknown client.", 400);
      const { error } = await db
        .from("everfit_sync_items")
        .upsert(
          {
            run_id: run.id,
            everfit_id: body.clientId,
            status: "failed",
            error:
              typeof body.error === "string"
                ? body.error.slice(0, 500)
                : "Capture failed.",
          },
          { onConflict: "run_id,everfit_id", ignoreDuplicates: true },
        );
      if (error) throw error;
      return Response.json({ saved: true });
    }
    if (body.action === "finish") {
      const { data: items, error } = await db
        .from("everfit_sync_items")
        .select("everfit_id,status,coach_name,brief")
        .eq("run_id", run.id);
      if (error) throw error;
      const complete = (items ?? []).filter((i) => i.status === "completed");
      const groups = new Map<string, EverfitBrief[]>();
      for (const item of complete) {
        const list = groups.get(item.coach_name) ?? [];
        list.push(item.brief as EverfitBrief);
        groups.set(item.coach_name, list);
      }
      const roster = await readSyncRoster(),
        reportIds: string[] = [];
      for (const [coach, clients] of groups) {
        if (clients.length > 600)
          throw new HttpError(
            "Coach has more than 600 clients; split the report before saving.",
            422,
          );
        clients.sort((a, b) => a.everfit_id.localeCompare(b.everfit_id));
        const source = parseImport(
          {
            review_date: pkDate(new Date(run.started_at)),
            timezone: "Asia/Karachi",
            window_start: new Date(
              Date.parse(run.started_at) - 7 * 86400000,
            ).toISOString(),
            window_end: run.started_at,
            preliminary: true,
            precision:
              "Browser capture. Everfit display dates and relative activity ages are not exact Pakistan timestamps.",
            coverage_notes: [
              `${complete.length} of ${plan.length} team clients captured and summarized. ${plan.length - complete.length} require retry.`,
              "Messages with unreadable attachments, unavailable inboxes, and incomplete history are explicitly flagged in each brief. Activity counts are observed minimums.",
            ],
            clients,
          },
          coach,
        );
        const document = matchReport(source, roster);
        const linked = document.clients.flatMap((c) =>
          c.linked_client_id ? [c.linked_client_id] : [],
        );
        if (new Set(linked).size !== linked.length)
          throw new HttpError(
            "Duplicate CCOS email links require review.",
            409,
          );
        const hash = createHash("sha256")
          .update(JSON.stringify({ run: run.id, source }))
          .digest("hex");
        const { data: id, error: saveError } = await db.rpc(
          "import_everfit_report",
          { p_document: document, p_hash: hash, p_actor: access.email },
        );
        if (saveError) throw saveError;
        reportIds.push(id);
      }
      const status = complete.length === plan.length ? "completed" : "partial";
      const { error: updateError } = await db
        .from("everfit_sync_runs")
        .update({
          status,
          report_ids: reportIds,
          finished_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .eq("status", "running");
      if (updateError) throw updateError;
      return Response.json({
        status,
        saved: complete.length,
        total: plan.length,
        reports: reportIds,
      });
    }
    throw new HttpError("Unknown sync action.", 400);
  } catch (e) {
    return errorResponse(e);
  }
}
