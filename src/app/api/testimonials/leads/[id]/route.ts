/**
 * Admin-only per-lead mutations.
 *
 *   PATCH /api/testimonials/leads/[id]
 *     body: { status: "new" | "contacted" | "dismissed" }
 *
 *   DELETE /api/testimonials/leads/[id]
 *     removes the lead row.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import type { TestimonialLeadStatus } from "@/lib/testimonials/types";

export const runtime = "nodejs";
export const maxDuration = 10;

const ALLOWED_STATUSES: TestimonialLeadStatus[] = ["new", "contacted", "dismissed"];

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

interface PatchBody {
  status?: string;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  const { id: idRaw } = await ctx.params;
  const id = parseId(idRaw);
  if (!id) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const status = body.status as TestimonialLeadStatus | undefined;
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("testimonial_leads")
    .update({
      status,
      status_changed_at: new Date().toISOString(),
      status_changed_by: session.user.name || session.user.email || "Unknown",
    })
    .eq("id", id)
    .select("id, name, email, phone, message, status, submitted_at, status_changed_at, status_changed_by")
    .single();
  if (error) {
    console.error(`[api/testimonials/leads/${id} PATCH] failed:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ lead: data });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  const { id: idRaw } = await ctx.params;
  const id = parseId(idRaw);
  if (!id) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error } = await db.from("testimonial_leads").delete().eq("id", id);
  if (error) {
    console.error(`[api/testimonials/leads/${id} DELETE] failed:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
