/**
 * POST /api/nutrition/v2/client/:client_id/push-done
 *
 * Admin-only force-completion of a pending meal plan task. Bypasses
 * the 3-checkbox checklist AND the requirement that a PDF was
 * uploaded. Used for plans delivered outside CCOS, stale legacy
 * tasks, or anywhere the coach wants to clear the pending row
 * without going through the normal verify-and-ship flow.
 *
 * Differs from the regular /api/nutrition/complete endpoint which
 * requires all 3 checklist items to be ticked AND sends a Slack
 * completion notification. This endpoint silently flips the status
 * — no Slack ping, since "the plan was delivered out-of-band" isn't
 * the same signal as "the normal workflow ran to completion."
 *
 * Auth: NextAuth admin role required (this is a power-user
 * override; non-admin coaches should go through the regular flow).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 5;

function parseClientId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ client_id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "admin role required for push-done bypass" },
      { status: 403 },
    );
  }

  const { client_id: raw } = await ctx.params;
  const clientId = parseClientId(raw);
  if (!clientId) {
    return NextResponse.json({ error: "invalid client_id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const now = new Date().toISOString();

  // Same column flips as /api/nutrition/complete so downstream
  // reporting (bi-monthly summary, dashboards) treats it identically
  // to a normal completion. The "who pushed done" attribution lives
  // in nutrition_assigned_to so it's visible in audit.
  const { data, error } = await db
    .from("clients")
    .update({
      nutrition_status: "done",
      nutrition_completed_at: now,
      nutrition_checklist_allergies: true,
      nutrition_checklist_everfit: true,
      nutrition_checklist_message: true,
      nutrition_assigned_to: session.user.name || session.user.email,
      nutrition_assigned_at: now,
    })
    .eq("id", clientId)
    .select("id, name")
    .single();

  if (error) {
    console.error("[push-done] update failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    clientId: data.id,
    clientName: data.name,
    pushedDoneBy: session.user.email,
    pushedDoneAt: now,
  });
}
