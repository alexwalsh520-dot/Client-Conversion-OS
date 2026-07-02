/**
 * GET  /api/coaching/onboarding-backlog       — list all rows (any coach)
 * POST /api/coaching/onboarding-backlog       — create empty row (Nicole + admins)
 *
 * Editing is restricted to Nicole and admins. Other coaches can view
 * the list but cannot create/update/delete rows.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

const NICOLE_EMAIL = "nicolettaokpala@gmail.com";

function canEdit(session: { user?: { email?: string | null; role?: string } } | null): boolean {
  if (!session?.user) return false;
  if (session.user.role === "admin") return true;
  const email = (session.user.email ?? "").toLowerCase();
  return email === NICOLE_EMAIL;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("onboarding_backlog")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    rows: data ?? [],
    can_edit: canEdit(session),
  });
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canEdit(session)) {
    return NextResponse.json(
      { error: "read-only — only Nicole and admins can edit the backlog" },
      { status: 403 },
    );
  }

  const db = getServiceSupabase();

  // New row goes at the end of the current sort order.
  const { data: last } = await db
    .from("onboarding_backlog")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  const nextSort = ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 10;

  const { data, error } = await db
    .from("onboarding_backlog")
    .insert({
      onboarder: "",
      onboardee: "",
      email: "",
      closer: "",
      amount_paid: "",
      pif_status: "",
      reschedule_email: "",
      reminder_email: "",
      closer_reachout: "",
      comments: "",
      sort_order: nextSort,
      updated_by: session.user.email,
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ row: data });
}
