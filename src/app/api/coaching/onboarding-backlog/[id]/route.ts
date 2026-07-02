/**
 * PATCH  /api/coaching/onboarding-backlog/:id — update one or more fields
 * DELETE /api/coaching/onboarding-backlog/:id — hard delete
 *
 * Nicole + admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

const NICOLE_EMAIL = "nicolettaokpala@gmail.com";

function canEdit(session: { user?: { email?: string | null; role?: string } } | null): boolean {
  if (!session?.user) return false;
  if (session.user.role === "admin") return true;
  return (session.user.email ?? "").toLowerCase() === NICOLE_EMAIL;
}

// Whitelist of writable columns — anything else in the request body is ignored.
const EDITABLE_FIELDS = new Set([
  "onboarder",
  "onboardee",
  "email",
  "closer",
  "amount_paid",
  "pif_status",
  "reschedule_email",
  "reminder_email",
  "closer_reachout",
  "comments",
  "sort_order",
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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

  const { id: rawId } = await ctx.params;
  const id = parseInt(rawId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE_FIELDS.has(key)) continue;
    // sort_order stays numeric; everything else is coerced to text
    if (key === "sort_order") {
      const n = Number(value);
      if (Number.isFinite(n)) updates[key] = n;
    } else {
      updates[key] = value == null ? "" : String(value);
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no editable fields in body" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();
  updates.updated_by = session.user.email;

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("onboarding_backlog")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ row: data });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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

  const { id: rawId } = await ctx.params;
  const id = parseInt(rawId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error } = await db.from("onboarding_backlog").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
