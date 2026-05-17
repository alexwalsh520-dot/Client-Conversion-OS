/**
 * SOP library — list + create.
 *
 *   GET  /api/sop?department=X&role=Y&search=Z
 *     → list of SopWithRelations, filtered. All authenticated users.
 *
 *   POST /api/sop  (application/json)
 *     → create a doc-kind SOP from editor content.
 *       Body: { title, description?, department_id, role_ids?, tags?, body_html }
 *       Returns: { sop, share_url }
 *       Admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { listSops, setRoleAssignments } from "@/lib/sop/data";
import { uniqueSlug } from "@/lib/sop/slug";
import { sanitizeSopHtml } from "@/lib/sop/sanitize";
import type { Sop } from "@/lib/sop/types";

export const runtime = "nodejs";
export const maxDuration = 30;

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
// POST — create from editor
// ---------------------------------------------------------------------------

interface PostBody {
  title?: string;
  description?: string | null;
  department_id?: number;
  role_ids?: number[];
  tags?: string[];
  body_html?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const title = body.title?.trim();
  const description = body.description?.trim() || null;
  const departmentId = body.department_id;
  const bodyHtmlRaw = body.body_html ?? "";
  const roleIds = Array.isArray(body.role_ids) ? body.role_ids.filter((n) => Number.isFinite(n)) : [];
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 20)
    : [];

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!departmentId || !Number.isFinite(departmentId)) {
    return NextResponse.json({ error: "department_id is required" }, { status: 400 });
  }

  const bodyHtml = sanitizeSopHtml(bodyHtmlRaw);
  if (!bodyHtml.trim()) {
    return NextResponse.json({ error: "body cannot be empty" }, { status: 400 });
  }

  const db = getServiceSupabase();

  // Verify department exists
  const { data: dept, error: deptErr } = await db
    .from("sop_departments")
    .select("id")
    .eq("id", departmentId)
    .single();
  if (deptErr || !dept) {
    return NextResponse.json({ error: "department not found" }, { status: 404 });
  }

  // Allocate a unique share slug
  const { data: existingSlugs } = await db.from("sops").select("share_slug");
  const taken = new Set((existingSlugs ?? []).map((r) => (r as { share_slug: string }).share_slug));
  const slug = uniqueSlug(title, taken);

  const uploaderLabel = session.user.name || session.user.email || "Unknown";

  const { data: created, error: insertErr } = await db
    .from("sops")
    .insert({
      title,
      description,
      department_id: departmentId,
      share_slug: slug,
      body_html: bodyHtml,
      // file_* columns stay null for editor-created SOPs
      tags,
      uploaded_by: uploaderLabel,
    })
    .select()
    .single();

  if (insertErr || !created) {
    console.error("[api/sop POST] insert failed:", insertErr?.message);
    return NextResponse.json(
      { error: insertErr?.message || "insert failed" },
      { status: 500 }
    );
  }

  const sop = created as Sop;
  if (roleIds.length > 0) {
    try {
      await setRoleAssignments(sop.id, roleIds);
    } catch (err) {
      console.error("[api/sop POST] role assignment failed:", err);
      // Non-fatal — SOP exists, roles can be re-edited
    }
  }

  return NextResponse.json({
    sop,
    share_url: `/sop/${slug}`,
  });
}
