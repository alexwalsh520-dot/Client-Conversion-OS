/**
 * DELETE /api/check-in/submissions/[id] — delete a single submission.
 *
 * Restricted to Saeed personally (email match), NOT all admins. This is
 * per explicit product requirement: only the owner should be able to
 * rewrite client-progress history. Other admins get a 403.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 5;

// Hard-coded — single-user authorization, not a role check.
const OWNER_EMAIL = "saeed16765@gmail.com";

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.email.toLowerCase() !== OWNER_EMAIL) {
    return NextResponse.json(
      { error: "Only the owner can delete check-in submissions." },
      { status: 403 }
    );
  }

  const { id: idRaw } = await ctx.params;
  const id = parseId(idRaw);
  if (!id) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error } = await db.from("client_check_ins").delete().eq("id", id);
  if (error) {
    console.error(`[api/check-in/submissions/${id} DELETE] failed:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
