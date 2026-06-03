// POST /api/testimonials/video/request
// Authed: a coach/admin in the Milestones tab generates (or re-fetches) the
// sendable recording link for a specific client. Reuses an existing pending
// request for the client so copying the link twice yields the same URL.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { generateTestimonialToken, recordingUrl } from "@/lib/testimonials/video";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const clientId = Number(body.clientId);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
  }

  const db = getServiceSupabase();

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, name, coach_name, email")
    .eq("id", clientId)
    .maybeSingle();

  if (clientErr) {
    return NextResponse.json({ error: clientErr.message }, { status: 500 });
  }
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // Reuse a still-pending request so the link is stable across copies.
  const { data: pending } = await db
    .from("video_testimonials")
    .select("token")
    .eq("client_id", clientId)
    .eq("status", "requested")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let token = pending?.token as string | undefined;

  if (!token) {
    token = generateTestimonialToken();
    const { error: insertErr } = await db.from("video_testimonials").insert({
      token,
      client_id: clientId,
      client_name: client.name,
      coach_name: client.coach_name ?? null,
      status: "requested",
      created_by: session.user.name || session.user.email || "unknown",
    });
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    token,
    url: recordingUrl(token),
    clientEmail: client.email || null,
    reused: Boolean(pending?.token),
  });
}
