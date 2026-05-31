/**
 * Onboarding checklist template — list + create. Authenticated CCOS users.
 *
 *   GET  /api/onboarding/steps  → { steps } (all, incl. inactive)
 *   POST /api/onboarding/steps  → { step }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAllSteps, createStep } from "@/lib/onboarding/server";
import type { OnboardingStep } from "@/lib/onboarding/types";

export const runtime = "nodejs";
export const maxDuration = 15;

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

async function requireUser(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

export async function GET(): Promise<NextResponse> {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const steps = await getAllSteps();
    return NextResponse.json({ steps }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/onboarding/steps GET] failed:", err);
    return NextResponse.json({ error: "list failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: Partial<OnboardingStep>;
  try {
    body = (await req.json()) as Partial<OnboardingStep>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  try {
    const step = await createStep({ ...body, title });
    return NextResponse.json({ step }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/onboarding/steps POST] failed:", err);
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}
