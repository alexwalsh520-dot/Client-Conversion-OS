/**
 * ONE-TIME endpoint: Link existing intake forms to matching clients
 * and mark them as done. Run once to clean up historical data.
 *
 * POST /api/coaching/link-existing
 * Requires auth session.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();
  const now = new Date().toISOString();
  const today = now.split("T")[0];

  // Get all intake forms
  const { data: forms, error: formErr } = await db
    .from("nutrition_intake_forms")
    .select("id, first_name, last_name, email");

  if (formErr) {
    return NextResponse.json({ error: formErr.message }, { status: 500 });
  }

  // Get all clients without a linked nutrition form
  const { data: clients, error: clientErr } = await db
    .from("clients")
    .select("id, name, email, nutrition_form_id");

  if (clientErr) {
    return NextResponse.json({ error: clientErr.message }, { status: 500 });
  }

  const unlinkedClients = (clients || []).filter((c) => !c.nutrition_form_id);
  const linked: { clientName: string; formName: string; matchType: string }[] = [];

  for (const form of forms || []) {
    const formEmail = (form.email || "").trim().toLowerCase();
    const formFullName = `${(form.first_name || "").trim()} ${(form.last_name || "").trim()}`.trim().toLowerCase();

    // Try matching by email first
    let match = unlinkedClients.find(
      (c) => formEmail && c.email && c.email.trim().toLowerCase() === formEmail
    );
    let matchType = "email";

    // If no email match, try by name
    if (!match) {
      match = unlinkedClients.find(
        (c) => formFullName && c.name && c.name.trim().toLowerCase() === formFullName
      );
      matchType = "name";
    }

    if (match) {
      // Link and mark as done
      const { error: updateErr } = await db
        .from("clients")
        .update({
          nutrition_form_id: form.id,
          nutrition_status: "done",
          nutrition_assigned_to: "Historical",
          nutrition_assigned_at: now,
          nutrition_completed_at: now,
          nutrition_checklist_allergies: true,
          nutrition_checklist_everfit: true,
          nutrition_checklist_message: true,
        })
        .eq("id", match.id);

      if (!updateErr) {
        linked.push({
          clientName: match.name,
          formName: `${form.first_name} ${form.last_name}`,
          matchType,
        });
        // Remove from unlinked pool so we don't double-match
        const idx = unlinkedClients.findIndex((c) => c.id === match!.id);
        if (idx >= 0) unlinkedClients.splice(idx, 1);
      }
    }
  }

  return NextResponse.json({
    success: true,
    linked: linked.length,
    details: linked,
    remainingUnlinkedForms: (forms || []).length - linked.length,
  });
}
