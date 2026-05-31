import { NextRequest, NextResponse } from "next/server";
import { getHiggsfieldResultUrl, HiggsfieldJob, runHiggsfieldJson } from "@/lib/higgsfield-cli";
import { createR2ObjectKey, putR2Object } from "@/lib/r2";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MISSING_AI_TABLE_MESSAGE =
  "Studio Generate needs one Supabase migration before it can run. Create the studio2_ai_generations table in Supabase, then try again.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

type GeneratedMediaRow = {
  id: string;
  folder_id: string | null;
  r2_key: string | null;
  public_url: string;
  thumbnail_url?: string | null;
  filename: string | null;
  created_at: string | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sb = getServiceSupabase();
    const generation = await findGeneration(sb, id);

    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    if (normalizeStatus(generation.status) === "failed" && isClientStoppedGeneration(generation.error)) {
      const media = generation.media_id ? await findMedia(sb, String(generation.media_id)) : null;
      return NextResponse.json({
        generation: mapGeneration(generation),
        media: media ? {
          id: media.id,
          folderId: media.folderId,
          url: media.url,
          thumbnailUrl: media.thumbnailUrl,
          filename: media.filename,
          kind: "image",
          createdAt: media.createdAt,
        } : null,
        job: null,
      }, { headers: NO_STORE_HEADERS });
    }

    if (!generation.job_id) {
      return NextResponse.json({
        generation: mapGeneration(generation),
        media: null,
        job: null,
      }, { headers: NO_STORE_HEADERS });
    }

    const { json } = await runHiggsfieldJson<HiggsfieldJob>(["generate", "get", String(generation.job_id)], 60_000);
    const status = normalizeStatus(json.status || generation.status);
    const resultUrl = getHiggsfieldResultUrl(json) || String(generation.result_url || "");
    let media = generation.media_id ? await findMedia(sb, String(generation.media_id)) : null;

    if (status === "completed" && resultUrl && !media) {
      media = await persistGeneratedResult({
        resultUrl,
        projectId: typeof generation.project_id === "string" ? generation.project_id : null,
        folderId: typeof generation.folder_id === "string" ? generation.folder_id : null,
        jobId: String(generation.job_id),
        prompt: String(generation.prompt || ""),
      });
    }

    const updates: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (status === "completed" && resultUrl) {
      updates.result_url = resultUrl;
    } else if (status !== "completed") {
      updates.result_url = null;
    }
    if (media?.id) {
      updates.media_id = media.id;
      updates.r2_key = media.r2Key;
    }
    if (status === "failed") updates.error = String(json.error || generation.error || "Higgsfield generation failed");

    const { data: updated } = await sb
      .from("studio2_ai_generations")
      .update(updates)
      .eq("id", generation.id)
      .select("id, project_id, creative_id, provider, model, job_id, prompt, status, result_url, media_id, error, created_at, updated_at")
      .single();

    return NextResponse.json({
      generation: mapGeneration(updated || { ...generation, ...updates }),
      media: media ? {
        id: media.id,
        folderId: media.folderId,
        url: media.url,
        thumbnailUrl: media.thumbnailUrl,
        filename: media.filename,
        kind: "image",
        createdAt: media.createdAt,
      } : null,
      job: json,
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("Studio 2 AI generation read error:", err);
    const message = err instanceof Error ? err.message : "Failed to read Studio 2 AI generation";
    if (isMissingAiGenerationsTableError(message)) {
      return NextResponse.json({ error: MISSING_AI_TABLE_MESSAGE, setupRequired: true }, { status: 500, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sb = getServiceSupabase();
    const generation = await findGeneration(sb, id);

    if (!generation) {
      return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    }

    const { error } = await sb
      .from("studio2_ai_generations")
      .delete()
      .eq("id", generation.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("Studio 2 AI generation delete error:", err);
    const message = err instanceof Error ? err.message : "Failed to delete Studio 2 AI generation";
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const sb = getServiceSupabase();
    const generation = await findGeneration(sb, id);

    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.projectId !== undefined) {
      updates.project_id = body.projectId || null;
      updates.creative_id = null;
    }
    if (body.folderId !== undefined) updates.folder_id = body.folderId || null;
    if (body.status !== undefined) {
      const status = normalizeStatus(body.status);
      updates.status = status;
      if (status !== "completed") updates.result_url = null;
    }
    if (body.error !== undefined) {
      updates.error = body.error ? String(body.error) : null;
    }

    const { data, error } = await sb
      .from("studio2_ai_generations")
      .update(updates)
      .eq("id", generation.id)
      .select("id, project_id, creative_id, provider, model, job_id, prompt, status, result_url, media_id, error, created_at, updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Generation update failed" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ generation: mapGeneration(data) }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("Studio 2 AI generation update error:", err);
    const message = err instanceof Error ? err.message : "Failed to update Studio 2 AI generation";
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

async function findGeneration(sb: ReturnType<typeof getServiceSupabase>, id: string) {
  const query = sb
    .from("studio2_ai_generations")
    .select("id, project_id, creative_id, folder_id, provider, model, job_id, prompt, status, result_url, r2_key, media_id, error, created_at, updated_at")
    .eq("job_id", id)
    .maybeSingle();

  let { data, error } = await query;
  if (error) throw new Error(error.message);
  if (data) return data;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }

  ({ data, error } = await sb
    .from("studio2_ai_generations")
    .select("id, project_id, creative_id, folder_id, provider, model, job_id, prompt, status, result_url, r2_key, media_id, error, created_at, updated_at")
    .eq("id", id)
    .maybeSingle());
  if (error) throw new Error(error.message);
  return data;
}

async function findMedia(sb: ReturnType<typeof getServiceSupabase>, id: string) {
  const initial = await sb
    .from("studio2_media")
    .select("id, folder_id, r2_key, public_url, thumbnail_url, filename, created_at")
    .eq("id", id)
    .maybeSingle();
  let data = initial.data as GeneratedMediaRow | null;
  let error = initial.error;
  if (error && isMissingThumbnailColumn(error.message)) {
    const fallback = await sb
      .from("studio2_media")
      .select("id, folder_id, r2_key, public_url, filename, created_at")
      .eq("id", id)
      .maybeSingle();
    data = fallback.data as GeneratedMediaRow | null;
    error = fallback.error;
  }
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    folderId: data.folder_id,
    r2Key: data.r2_key,
    url: data.public_url,
    thumbnailUrl: "thumbnail_url" in data ? data.thumbnail_url : null,
    filename: data.filename || "Generated ad.png",
    createdAt: data.created_at,
  };
}

async function persistGeneratedResult(input: {
  resultUrl: string;
  projectId: string | null;
  folderId: string | null;
  jobId: string;
  prompt: string;
}) {
  const res = await fetch(input.resultUrl);
  if (!res.ok) throw new Error(`Could not download Higgsfield result: ${res.status}`);

  const contentType = normalizeImageContentType(res.headers.get("content-type"), input.resultUrl);
  const body = Buffer.from(await res.arrayBuffer());
  const filename = `higgsfield-${input.jobId}.${extensionForContentType(contentType)}`;
  const key = createR2ObjectKey(filename, contentType);
  const upload = await putR2Object({ key, body, contentType });

  const sb = getServiceSupabase();
  const insertPayload = {
    project_id: input.projectId,
    folder_id: input.folderId,
    r2_key: key,
    public_url: upload.publicUrl,
    thumbnail_url: upload.publicUrl,
    filename,
    content_type: contentType,
    file_size: body.length,
    kind: "image",
    status: "generated",
  };

  const initial = await sb
    .from("studio2_media")
    .insert(insertPayload)
    .select("id, folder_id, r2_key, public_url, thumbnail_url, filename, created_at")
    .single();
  let data = initial.data as GeneratedMediaRow | null;
  let error = initial.error;

  if (error && isMissingThumbnailColumn(error.message)) {
    const fallbackPayload: Record<string, unknown> = { ...insertPayload };
    delete fallbackPayload.thumbnail_url;
    const fallback = await sb
      .from("studio2_media")
      .insert(fallbackPayload)
      .select("id, folder_id, r2_key, public_url, filename, created_at")
      .single();
    data = fallback.data as GeneratedMediaRow | null;
    error = fallback.error;
  }

  if (error || !data) {
    throw new Error(error?.message || "Generated media insert failed");
  }

  return {
    id: data.id,
    folderId: data.folder_id,
    r2Key: data.r2_key,
    url: data.public_url,
    thumbnailUrl: "thumbnail_url" in data ? data.thumbnail_url : null,
    filename: data.filename || filename,
    createdAt: data.created_at,
  };
}

function normalizeStatus(status: unknown) {
  const value = String(status || "").toLowerCase();
  if (["completed", "complete", "succeeded", "success"].includes(value)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(value)) return "failed";
  if (["queued", "pending", "created"].includes(value)) return "queued";
  return value || "queued";
}

function isClientStoppedGeneration(error: unknown) {
  const value = String(error || "").toLowerCase();
  return value.includes("stopped by user") || value.includes("timed out");
}

function normalizeImageContentType(contentType: string | null, url: string) {
  const clean = contentType?.split(";")[0]?.trim().toLowerCase();
  if (clean?.startsWith("image/")) return clean;
  if (/\.webp($|\?)/i.test(url)) return "image/webp";
  if (/\.jpe?g($|\?)/i.test(url)) return "image/jpeg";
  return "image/png";
}

function extensionForContentType(contentType: string) {
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/jpeg") return "jpg";
  return "png";
}

function isMissingAiGenerationsTableError(message?: string | null) {
  const value = String(message || "").toLowerCase();
  return value.includes("studio2_ai_generations") && (value.includes("schema cache") || value.includes("does not exist"));
}

function isMissingThumbnailColumn(message?: string | null) {
  const value = String(message || "").toLowerCase();
  return value.includes("thumbnail_url") && (value.includes("schema cache") || value.includes("column"));
}

function mapGeneration(row: Record<string, unknown>) {
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
  };
}
