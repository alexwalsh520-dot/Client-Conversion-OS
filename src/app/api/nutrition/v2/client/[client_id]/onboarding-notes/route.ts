/**
 * GET / PUT / DELETE  /api/nutrition/v2/client/:client_id/onboarding-notes
 *
 * Per-client free-text notes for the nutrition plan author. Editable any
 * time (not only at plan-generation), so the onboarding specialist can
 * file notes the day of the onboarding call even if the plan won't be
 * built for several days.
 *
 *   GET    → returns { notes, updatedAt, updatedBy }
 *   PUT    → saves notes (body: { notes: string }). Empty string is rejected;
 *            use DELETE to clear. Capped at 4000 chars to match other free-text
 *            fields (q5 paragraph, testimonials message).
 *   DELETE → clears notes + timestamp + updated_by
 *
 * Any authenticated user. The nutrition v2 surface is already coach-
 * accessible (matches MacroTargetEditor + Upload Plan), so restricting
 * notes to admins would feel inconsistent.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 5;

const MAX_LENGTH = 4000;

function parseClientId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export interface OnboardingNotesResponse {
  notes: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ client_id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { client_id: raw } = await ctx.params;
  const clientId = parseClientId(raw);
  if (!clientId) {
    return NextResponse.json({ error: "invalid client_id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("clients")
    .select(
      "nutrition_onboarding_notes, nutrition_onboarding_notes_updated_at, nutrition_onboarding_notes_updated_by"
    )
    .eq("id", clientId)
    .single();

  if (error) {
    console.error("[onboarding-notes GET] failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const response: OnboardingNotesResponse = {
    notes: data?.nutrition_onboarding_notes ?? null,
    updatedAt: data?.nutrition_onboarding_notes_updated_at ?? null,
    updatedBy: data?.nutrition_onboarding_notes_updated_by ?? null,
  };
  return NextResponse.json(response);
}

interface PutBody {
  notes?: string;
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ client_id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { client_id: raw } = await ctx.params;
  const clientId = parseClientId(raw);
  if (!clientId) {
    return NextResponse.json({ error: "invalid client_id" }, { status: 400 });
  }

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const notes = body.notes?.trim();
  if (!notes) {
    return NextResponse.json(
      { error: "notes is required (use DELETE to clear)" },
      { status: 400 }
    );
  }
  if (notes.length > MAX_LENGTH) {
    return NextResponse.json(
      { error: `notes too long (max ${MAX_LENGTH} chars)` },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const author = session.user.name || session.user.email;

  const db = getServiceSupabase();
  const { error } = await db
    .from("clients")
    .update({
      nutrition_onboarding_notes: notes,
      nutrition_onboarding_notes_updated_at: now,
      nutrition_onboarding_notes_updated_by: author,
    })
    .eq("id", clientId);

  if (error) {
    console.error("[onboarding-notes PUT] failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const response: OnboardingNotesResponse = {
    notes,
    updatedAt: now,
    updatedBy: author,
  };
  return NextResponse.json(response);
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ client_id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { client_id: raw } = await ctx.params;
  const clientId = parseClientId(raw);
  if (!clientId) {
    return NextResponse.json({ error: "invalid client_id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error } = await db
    .from("clients")
    .update({
      nutrition_onboarding_notes: null,
      nutrition_onboarding_notes_updated_at: null,
      nutrition_onboarding_notes_updated_by: null,
    })
    .eq("id", clientId);

  if (error) {
    console.error("[onboarding-notes DELETE] failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
