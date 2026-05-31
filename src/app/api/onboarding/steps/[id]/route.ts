/**
 * Onboarding checklist template — edit + remove. Authenticated CCOS users.
 *
 *   PATCH  /api/onboarding/steps/[id]  → update fields (incl. sop_slug/sop_url)
 *   DELETE /api/onboarding/steps/[id]  → soft-delete (active=false)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateStep, deleteStep } from "@/lib/onboarding/server";
import type { OnboardingStep } from "@/lib/onboarding/types";

export const runtime = "nodejs";
export const maxDuration = 15;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

async function requireUser(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: Partial<OnboardingStep>;
  try {
    body = (await req.json()) as Partial<OnboardingStep>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    await updateStep(id, body);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/onboarding/steps/[id] PATCH] failed:", err);
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
    await deleteStep(id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/onboarding/steps/[id] DELETE] failed:", err);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
