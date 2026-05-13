/**
 * SOP library: list + upload.
 *
 *   GET  /api/sop?department=X&role=Y&search=Z
 *     → list of SopWithRelations, filtered. All authenticated users.
 *
 *   POST /api/sop  (multipart/form-data)
 *     → uploads the file to Supabase Storage AND creates the sops row +
 *       role assignments in one shot. Admins only.
 *     Form fields:
 *       file        : the binary upload (required)
 *       title       : string (required)
 *       description : string (optional)
 *       department_id : number (required)
 *       role_ids    : JSON array of numbers (optional, may be empty)
 *       tags        : JSON array of strings (optional)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  listSops,
  setRoleAssignments,
  SOPS_STORAGE_BUCKET,
} from "@/lib/sop/data";
import { uniqueSlug } from "@/lib/sop/slug";
import type { Sop } from "@/lib/sop/types";

export const runtime = "nodejs";
export const maxDuration = 30;

// Match Vercel's per-request body cap. Documents > 25 MB should rarely
// happen for SOPs; if needed we can bump later.
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/markdown": "md",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};

// ---------------------------------------------------------------------------
// GET — list
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const departmentRaw = searchParams.get("department");
  const roleRaw = searchParams.get("role");
  const search = searchParams.get("search") ?? undefined;

  const departmentId = departmentRaw ? parseInt(departmentRaw, 10) : undefined;
  const roleId = roleRaw ? parseInt(roleRaw, 10) : undefined;

  try {
    const sops = await listSops({
      departmentId: Number.isFinite(departmentId) ? departmentId : undefined,
      roleId: Number.isFinite(roleId) ? roleId : undefined,
      search,
    });
    return NextResponse.json({ sops });
  } catch (err) {
    console.error("[api/sop GET] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — upload + create
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required to upload" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  const title = (form.get("title") as string | null)?.trim();
  const description = ((form.get("description") as string | null) ?? "").trim() || null;
  const departmentIdRaw = form.get("department_id") as string | null;
  const roleIdsRaw = form.get("role_ids") as string | null;
  const tagsRaw = form.get("tags") as string | null;

  // Validate
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const departmentId = departmentIdRaw ? parseInt(departmentIdRaw, 10) : NaN;
  if (!Number.isFinite(departmentId) || departmentId <= 0) {
    return NextResponse.json({ error: "department_id is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    );
  }

  let roleIds: number[] = [];
  if (roleIdsRaw) {
    try {
      const parsed = JSON.parse(roleIdsRaw);
      if (Array.isArray(parsed)) {
        roleIds = parsed.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
      }
    } catch {
      return NextResponse.json({ error: "role_ids must be a JSON array" }, { status: 400 });
    }
  }

  let tags: string[] = [];
  if (tagsRaw) {
    try {
      const parsed = JSON.parse(tagsRaw);
      if (Array.isArray(parsed)) {
        tags = parsed
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .slice(0, 20);
      }
    } catch {
      return NextResponse.json({ error: "tags must be a JSON array" }, { status: 400 });
    }
  }

  const db = getServiceSupabase();

  // Resolve department (need its key for the storage path)
  const { data: deptRow, error: deptErr } = await db
    .from("sop_departments")
    .select("id, key")
    .eq("id", departmentId)
    .single();
  if (deptErr || !deptRow) {
    return NextResponse.json({ error: "department not found" }, { status: 404 });
  }
  const departmentKey = (deptRow as { key: string }).key;

  // Generate a unique slug by checking against all existing slugs.
  // Cheap query — there will only ever be hundreds of SOPs at most.
  const { data: existingSlugs, error: slugErr } = await db.from("sops").select("share_slug");
  if (slugErr) {
    console.error("[api/sop POST] slug lookup failed:", slugErr.message);
    return NextResponse.json({ error: "failed to allocate slug" }, { status: 500 });
  }
  const taken = new Set((existingSlugs ?? []).map((r) => (r as { share_slug: string }).share_slug));
  const slug = uniqueSlug(title, taken);

  // Determine the storage extension. Prefer the MIME-mapped one; fall back
  // to whatever the original filename had (last segment after a dot).
  const mime = file.type || "application/octet-stream";
  const extFromMime = ALLOWED_EXT_BY_MIME[mime];
  const extFromName = file.name.includes(".")
    ? file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")
    : null;
  const ext = extFromMime || extFromName || "bin";

  // Storage path scheme: {department_key}/{slug}.{ext}
  // Stable across edits, slug is already unique → no collision possible.
  const storagePath = `${departmentKey}/${slug}.${ext}`;
  const fileBuffer = await file.arrayBuffer();

  const { error: uploadErr } = await db.storage
    .from(SOPS_STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: mime,
      upsert: false,
    });
  if (uploadErr) {
    console.error("[api/sop POST] storage upload failed:", uploadErr.message);
    return NextResponse.json(
      { error: `upload failed: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  const uploaderLabel = session.user.name || session.user.email || "Unknown";

  const { data: sopRow, error: insertErr } = await db
    .from("sops")
    .insert({
      title,
      description,
      department_id: departmentId,
      share_slug: slug,
      file_path: storagePath,
      file_name: file.name || `${slug}.${ext}`,
      file_type: mime,
      file_size_bytes: file.size,
      tags,
      uploaded_by: uploaderLabel,
    })
    .select()
    .single();

  if (insertErr || !sopRow) {
    console.error("[api/sop POST] sops insert failed:", insertErr?.message);
    // Best-effort cleanup of the storage upload to avoid orphans.
    await db.storage.from(SOPS_STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    return NextResponse.json(
      { error: insertErr?.message || "insert failed" },
      { status: 500 }
    );
  }

  const created = sopRow as Sop;

  // Wire up role assignments
  if (roleIds.length > 0) {
    try {
      await setRoleAssignments(created.id, roleIds);
    } catch (err) {
      console.error("[api/sop POST] role assignment failed:", err);
      // Non-fatal: SOP exists and is usable; admin can re-edit roles.
    }
  }

  return NextResponse.json({
    sop: created,
    share_url: `/sop/${slug}`,
  });
}
