/**
 * Back-office single-partner endpoints.
 *
 *   GET    /api/onboarding/admin/[id]  → { detail } incl. decrypted creds
 *   PATCH  /api/onboarding/admin/[id]  → update partner fields OR toggle an
 *            internal step: body { stepId, completed } or { name?, status?, ... }
 *   DELETE /api/onboarding/admin/[id]  → remove partner (cascades)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getPartnerDetail,
  updatePartner,
  deletePartner,
  setStepProgressAdmin,
} from "@/lib/onboarding/server";

export const runtime = "nodejs";
export const maxDuration = 15;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

async function requireUser(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const detail = await getPartnerDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ detail }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/onboarding/admin/[id] GET] failed:", err);
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }
}

interface PatchBody {
  stepId?: string;
  completed?: boolean;
  name?: string;
  handle?: string | null;
  email?: string | null;
  status?: string;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    if (body.stepId) {
      await setStepProgressAdmin(id, body.stepId, !!body.completed);
    } else {
      await updatePartner(id, body);
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/onboarding/admin/[id] PATCH] failed:", err);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    await deletePartner(id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/onboarding/admin/[id] DELETE] failed:", err);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
