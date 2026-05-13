/**
 * SOP library: role CRUD.
 *
 *   GET  /api/sop/roles?department_id=X → list (filtered)
 *   POST /api/sop/roles → create  { department_id, key, label, description?, sort_order? }
 *
 * Admins only for POST.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listRoles, createRole } from "@/lib/sop/data";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const deptRaw = searchParams.get("department_id");
  const departmentId = deptRaw ? parseInt(deptRaw, 10) : undefined;
  try {
    const roles = await listRoles({
      departmentId: Number.isFinite(departmentId) ? departmentId : undefined,
    });
    return NextResponse.json({ roles });
  } catch (err) {
    console.error("[api/sop/roles GET] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 500 }
    );
  }
}

interface PostBody {
  department_id?: number;
  key?: string;
  label?: string;
  description?: string;
  sort_order?: number;
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
  const departmentId = body.department_id;
  const key = body.key?.trim().toLowerCase();
  const label = body.label?.trim();
  if (!departmentId || !Number.isFinite(departmentId)) {
    return NextResponse.json({ error: "department_id is required" }, { status: 400 });
  }
  if (!key || !/^[a-z0-9_-]+$/.test(key)) {
    return NextResponse.json({ error: "key must be lowercase alphanumeric (with - or _)" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  try {
    const role = await createRole({
      department_id: departmentId,
      key,
      label,
      description: body.description?.trim() || null,
      sort_order: body.sort_order ?? 100,
    });
    return NextResponse.json({ role });
  } catch (err) {
    console.error("[api/sop/roles POST] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "create failed" },
      { status: 500 }
    );
  }
}
