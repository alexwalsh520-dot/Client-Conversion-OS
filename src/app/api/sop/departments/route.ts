/**
 * SOP library: department CRUD.
 *
 *   GET  /api/sop/departments → list
 *   POST /api/sop/departments → create  { key, label, description?, sort_order? }
 *
 * Admins only for POST.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listDepartments, createDepartment } from "@/lib/sop/data";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const departments = await listDepartments();
    return NextResponse.json({ departments });
  } catch (err) {
    console.error("[api/sop/departments GET] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 500 }
    );
  }
}

interface PostBody {
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
  const key = body.key?.trim().toLowerCase();
  const label = body.label?.trim();
  if (!key || !/^[a-z0-9_-]+$/.test(key)) {
    return NextResponse.json({ error: "key must be lowercase alphanumeric (with - or _)" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  try {
    const department = await createDepartment({
      key,
      label,
      description: body.description?.trim() || null,
      sort_order: body.sort_order ?? 100,
    });
    return NextResponse.json({ department });
  } catch (err) {
    console.error("[api/sop/departments POST] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "create failed" },
      { status: 500 }
    );
  }
}
