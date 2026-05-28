import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  cleanupTempPaths,
  getHiggsfieldJobId,
  HiggsfieldJob,
  runHiggsfieldJson,
  writeDataUrlToTempImage,
} from "@/lib/higgsfield-cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_MODEL = "gpt_image_2";
const MISSING_AI_TABLE_MESSAGE =
  "Studio Generate needs one Supabase migration before it can run. Create the studio2_ai_generations table in Supabase, then try again.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    const sb = getServiceSupabase();
    let query = sb
      .from("studio2_ai_generations")
      .select("id, project_id, creative_id, provider, model, job_id, prompt, status, result_url, media_id, error, created_at, updated_at, media:studio2_media(id, folder_id, public_url, filename, kind, created_at)")
      .order("created_at", { ascending: false })
      .limit(30);

    if (projectId) query = query.eq("project_id", projectId);

    const { data, error } = await query;
    if (error) {
      if (isMissingAiGenerationsTableError(error.message)) {
        return NextResponse.json({ generations: [], setupRequired: true }, { headers: NO_STORE_HEADERS });
      }
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({
      generations: (data || []).map(mapGeneration),
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("Studio 2 AI generation list error:", err);
    return NextResponse.json({ error: "Failed to load Studio 2 AI generations" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  const tempPaths: string[] = [];
  let pendingGenerationId: string | null = null;

  try {
    const body = await req.json();
    const prompt = String(body.prompt || "").trim();
    const model = String(body.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
    const creativeId = typeof body.creativeId === "string" && body.creativeId ? body.creativeId : null;
    const folderId = typeof body.folderId === "string" && body.folderId ? body.folderId : null;

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const sb = getServiceSupabase();
    const { data: pendingGeneration, error: pendingError } = await sb
      .from("studio2_ai_generations")
      .insert({
        project_id: projectId,
        creative_id: creativeId,
        folder_id: folderId,
        provider: "higgsfield",
        model,
        prompt,
        status: "starting",
      })
      .select("id, project_id, creative_id, provider, model, job_id, prompt, status, result_url, media_id, error, created_at, updated_at")
      .single();

    if (pendingError || !pendingGeneration) {
      if (isMissingAiGenerationsTableError(pendingError?.message)) {
        return NextResponse.json({ error: MISSING_AI_TABLE_MESSAGE, setupRequired: true }, { status: 500 });
      }
      return NextResponse.json({ error: pendingError?.message || "Generation insert failed" }, { status: 500 });
    }
    pendingGenerationId = String(pendingGeneration.id);

    const mediaArgs: string[] = [];
    if (typeof body.snapshotDataUrl === "string" && body.snapshotDataUrl) {
      const snapshot = await writeDataUrlToTempImage(body.snapshotDataUrl, "selected-ad");
      tempPaths.push(snapshot.path);
      mediaArgs.push("--image", snapshot.path);
    }

    if (typeof body.referenceDataUrl === "string" && body.referenceDataUrl) {
      const reference = await writeDataUrlToTempImage(body.referenceDataUrl, "reference");
      tempPaths.push(reference.path);
      mediaArgs.push("--image", reference.path);
    }

    const { json } = await runHiggsfieldJson<HiggsfieldJob>(
      [
        "generate",
        "create",
        model,
        "--prompt",
        prompt,
        "--aspect_ratio",
        "9:16",
        "--quality",
        "high",
        "--resolution",
        "2k",
        "--batch_size",
        "1",
        ...mediaArgs,
      ],
      120_000
    );

    const jobId = getHiggsfieldJobId(json);
    if (!jobId) {
      console.error("Higgsfield create response missing job id:", JSON.stringify(json).slice(0, 2000));
      const missingJobMessage = "Higgsfield started, but Studio could not read the job id from its response.";
      await sb
        .from("studio2_ai_generations")
        .update({ status: "failed", error: missingJobMessage, updated_at: new Date().toISOString() })
        .eq("id", pendingGeneration.id);
      return NextResponse.json({ error: missingJobMessage }, { status: 502 });
    }

    const { data, error } = await sb
      .from("studio2_ai_generations")
      .update({
        job_id: jobId,
        status: normalizeStatus(json.status || "queued"),
        updated_at: new Date().toISOString(),
      })
      .eq("id", pendingGeneration.id)
      .select("id, project_id, creative_id, provider, model, job_id, prompt, status, result_url, media_id, error, created_at, updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Generation update failed" }, { status: 500 });
    }

    return NextResponse.json({
      generation: mapGeneration(data),
      job: json,
    });
  } catch (err) {
    console.error("Studio 2 AI generation start error:", err);
    if (pendingGenerationId) {
      try {
        await getServiceSupabase()
          .from("studio2_ai_generations")
          .update({
            status: "failed",
            error: err instanceof Error ? err.message : "Failed to start Higgsfield generation",
            updated_at: new Date().toISOString(),
          })
          .eq("id", pendingGenerationId);
      } catch {
        // Keep the original Higgsfield/API error as the response.
      }
    }
    const message = err instanceof Error ? err.message : "Failed to start Studio 2 AI generation";
    if (isMissingAiGenerationsTableError(message)) {
      return NextResponse.json({ error: MISSING_AI_TABLE_MESSAGE, setupRequired: true }, { status: 500 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await cleanupTempPaths(tempPaths);
  }
}

function isMissingAiGenerationsTableError(message?: string | null) {
  const value = String(message || "").toLowerCase();
  return value.includes("studio2_ai_generations") && (value.includes("schema cache") || value.includes("does not exist"));
}

function normalizeStatus(status: unknown) {
  const value = String(status || "").toLowerCase();
  if (["completed", "complete", "succeeded", "success"].includes(value)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(value)) return "failed";
  if (["queued", "pending", "created"].includes(value)) return "queued";
  return value || "queued";
}

function mapGeneration(row: Record<string, unknown>) {
  const media = row.media && typeof row.media === "object" ? row.media as Record<string, unknown> : null;
  return {
    id: row.id,
    projectId: row.project_id,
    creativeId: row.creative_id,
    provider: row.provider,
    model: row.model,
    jobId: row.job_id,
    prompt: row.prompt,
    status: row.status,
    resultUrl: row.status === "completed" ? row.result_url : null,
    mediaId: row.media_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    media: media ? {
      id: media.id,
      folderId: media.folder_id,
      url: media.public_url,
      filename: media.filename || "Generated ad.png",
      kind: media.kind === "video" ? "video" : "image",
      createdAt: media.created_at,
    } : null,
  };
}
