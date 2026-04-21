/**
 * POST /api/nutrition/complete { clientId, checklist: { allergies, delivered, tipsReviewed } }
 *
 * Marks the nutrition task as done once all 3 checkboxes are ticked.
 * Triggers Slack completion notification.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { postToCoachingChannel } from "@/lib/slack";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const clientId = body.clientId as number;
  const checklist = body.checklist as {
    allergies: boolean;
    delivered: boolean;
    tipsReviewed: boolean;
  };

  if (!clientId || !checklist) {
    return NextResponse.json({ error: "clientId and checklist required" }, { status: 400 });
  }
  if (!checklist.allergies || !checklist.delivered || !checklist.tipsReviewed) {
    return NextResponse.json(
      { error: "All three checklist items must be ticked" },
      { status: 400 }
    );
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("clients")
    .update({
      nutrition_status: "done",
      nutrition_completed_at: new Date().toISOString(),
      nutrition_checklist_allergies: true,
      nutrition_checklist_everfit: true,      // reused to represent "delivered"
      nutrition_checklist_message: true,      // reused to represent "tips reviewed"
      nutrition_assigned_to: "Daman",         // fixed; keeps bi-monthly summary working
      nutrition_assigned_at: new Date().toISOString(),
    })
    .eq("id", clientId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clientName = data.name || "Unknown";
  const today = new Date().toISOString().split("T")[0];
  postToCoachingChannel([
    {
      type: "header",
      text: { type: "plain_text", text: ":white_check_mark: Meal Plan Completed" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Daman* completed the custom meal plan for *${clientName}* on ${today}.`,
      },
    },
  ]).catch((err) => console.error("[nutrition/complete] Slack notify failed:", err));

  return NextResponse.json({ success: true, client: data });
}
