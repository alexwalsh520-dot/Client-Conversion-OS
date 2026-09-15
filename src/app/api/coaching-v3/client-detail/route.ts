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
    .select("id, name, coach_name, program, start_date, end_date, status")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const clientNameNorm = (client.name as string).trim();

  const [clientNotesQ, cyclesQ] = await Promise.all([
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
      coachName: client.coach_name,
      program: client.program,
      startDate: client.start_date,
      endDate: client.end_date,
      status: client.status,
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
  });
}
