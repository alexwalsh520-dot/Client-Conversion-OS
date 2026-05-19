/**
 * GET /api/testimonials/leads — admin-only list of all leads.
 * Returns leads ordered by submitted_at DESC.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import type { TestimonialLead } from "@/lib/testimonials/types";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("testimonial_leads")
    .select("id, name, email, phone, message, status, submitted_at, status_changed_at, status_changed_by")
    .order("submitted_at", { ascending: false });
  if (error) {
    console.error("[api/testimonials/leads GET] failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ leads: (data ?? []) as TestimonialLead[] });
}
