/**
 * GET /api/coaching-v3/client-detail?clientId=X
 *
 * Payload for the Today popups (past-end + zero-workouts notes). Returns
 * both client_notes (coach-authored) and retention_notes (from every
 * retention cycle this client has been through, current + historical).
 * Kept lightweight so the popup is snappy.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = Number(new URL(req.url).searchParams.get("clientId"));
  if (!clientId || !Number.isFinite(clientId)) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }
  const db = getServiceSupabase();

  const { data: client } = await db
    .from("clients")
    .select(
      "id, name, email, phone_number, coach_name, program, offer, start_date, end_date, status, amount_paid, sales_person, payment_platform",
    )
    .eq("id", clientId)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const clientNameNorm = (client.name as string).trim();

  const [clientNotesQ, cyclesQ, checkInsQ, meetingsQ, milestoneQ] = await Promise.all([
    db
      .from("client_notes")
      .select("note, coach_name, created_at")
      .eq("client_name", clientNameNorm)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("retention_cycles")
      .select("id, entered_window_at, outcome, outcome_at, outcome_by")
      .eq("client_id", clientId)
      .order("entered_window_at", { ascending: false }),
    db
      .from("client_check_ins")
      .select("id, client_id, client_name, coach_name, q1_overall, q2_strength, q3_lifestyle, q4_progress, q5_open_response, score_0_100, submitted_at")
      .eq("client_id", clientId)
      .order("submitted_at", { ascending: false })
      .limit(100),
    db
      .from("coach_meetings")
      .select("id, client_id, client_name, coach_name, meeting_date, notes, fathom_link, fathom_link_added_at, created_at")
      .eq("client_id", clientId)
      .order("meeting_date", { ascending: false })
      .limit(100),
    db
      .from("coach_milestones")
      .select(
        "id, video_testimonial_prompted_date, video_testimonial_completed, video_testimonial_completion_date, trust_pilot_prompted_date, trust_pilot_completed, trust_pilot_completion_date",
      )
      .eq("client_id", clientId)
      .maybeSingle(),
  ]);

  const cycleIds = (cyclesQ.data ?? []).map((c) => c.id as number);
  const retNotes = cycleIds.length
    ? await db
        .from("retention_notes")
        .select("id, cycle_id, note_text, source, author_email, created_at")
        .in("cycle_id", cycleIds)
        .order("created_at", { ascending: false })
    : { data: [] as unknown[] };

  return NextResponse.json({
    client: {
      id: client.id,
      name: client.name,
      email: (client.email as string | null) ?? "",
      phoneNumber: (client.phone_number as string | null) ?? "",
      coachName: (client.coach_name as string | null) ?? "",
      program: (client.program as string | null) ?? "",
      offer: (client.offer as string | null) ?? "",
      startDate: (client.start_date as string | null) ?? "",
      endDate: (client.end_date as string | null) ?? "",
      status: client.status,
      amountPaid: Number(client.amount_paid) || 0,
      salesPerson: (client.sales_person as string | null) ?? "",
      paymentPlatform: (client.payment_platform as string | null) ?? "",
    },
    clientNotes: (clientNotesQ.data ?? []).map((r) => ({
      text: r.note as string,
      by: (r.coach_name as string) ?? "",
      at: r.created_at as string,
    })),
    cycles: (cyclesQ.data ?? []).map((c) => ({
      id: c.id as number,
      enteredWindowAt: c.entered_window_at as string,
      outcome: c.outcome as string | null,
      outcomeAt: c.outcome_at as string | null,
      outcomeBy: c.outcome_by as string | null,
    })),
    retentionNotes: (retNotes.data ?? []).map((n) => ({
      id: (n as { id: number }).id,
      cycleId: (n as { cycle_id: number }).cycle_id,
      text: (n as { note_text: string }).note_text,
      source: (n as { source: string }).source,
      author: (n as { author_email: string }).author_email,
      at: (n as { created_at: string }).created_at,
    })),
    checkIns: (checkInsQ.data ?? []).map((r) => ({
      id: r.id as number,
      clientId: (r.client_id as number) ?? null,
      clientName: (r.client_name as string) ?? "",
      coachName: (r.coach_name as string) ?? "",
      score: Number(r.score_0_100) || 0,
      q1: Number(r.q1_overall) || 0,
      q2: Number(r.q2_strength) || 0,
      q3: Number(r.q3_lifestyle) || 0,
      q4: Number(r.q4_progress) || 0,
      text: ((r.q5_open_response as string) ?? "").trim(),
      submittedAt: r.submitted_at as string,
    })),
    meetings: (meetingsQ.data ?? []).map((r) => ({
      id: r.id as number,
      clientId: (r.client_id as number) ?? null,
      clientName: (r.client_name as string) ?? "",
      coachName: (r.coach_name as string) ?? "",
      meetingDate: (r.meeting_date as string) ?? "",
      notes: (r.notes as string) ?? "",
      fathomLink: (r.fathom_link as string) ?? null,
      fathomLinkAddedAt: (r.fathom_link_added_at as string) ?? null,
      createdAt: (r.created_at as string) ?? null,
    })),
    milestone: milestoneQ.data
      ? {
          id: milestoneQ.data.id as number,
          videoTestimonial: {
            promptedDate: (milestoneQ.data.video_testimonial_prompted_date as string) ?? null,
            completed: !!milestoneQ.data.video_testimonial_completed,
            completionDate: (milestoneQ.data.video_testimonial_completion_date as string) ?? null,
          },
          writtenTestimonial: {
            promptedDate: (milestoneQ.data.trust_pilot_prompted_date as string) ?? null,
            completed: !!milestoneQ.data.trust_pilot_completed,
            completionDate: (milestoneQ.data.trust_pilot_completion_date as string) ?? null,
          },
        }
      : null,
  });
}
