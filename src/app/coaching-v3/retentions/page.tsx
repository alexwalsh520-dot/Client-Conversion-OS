import { loadHubV3 } from "@/lib/coaching-v3/hub";
import { redirect } from "next/navigation";
import RetentionsView from "./RetentionsView";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function RetentionsPageV3() {
  const hub = await loadHubV3();
  if (!hub) redirect("/api/auth/signin");

  // Load open retention cycles + their notes on the server so the initial
  // render doesn't wait on a second round-trip. Client-side actions still
  // hit /api/coaching/retention for mutations.
  const db = getServiceSupabase();

  // First-of-current-month, UTC. Used for the Conversion Rate KPI —
  // retentions_this_month / opp_lost_this_month, both from retention_cycles
  // so the ratio stays self-consistent (Sales Tracker $ counts drift from
  // the operational state when coaches close cycles manually).
  const now = new Date();
  const monthStartIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();

  const { data: openCycles } = await db
    .from("retention_cycles")
    .select("id, client_id, entered_window_at, end_date_at_entry")
    .is("outcome", null);
  const { data: monthCycles } = await db
    .from("retention_cycles")
    .select("outcome")
    .gte("outcome_at", monthStartIso)
    .in("outcome", ["retained_4wk", "retained_12wk", "retained_manual", "opp_lost"]);
  let monthRetainedCount = 0;
  let monthOppLostCount = 0;
  for (const c of monthCycles ?? []) {
    const o = (c as { outcome: string | null }).outcome;
    if (o === "retained_4wk" || o === "retained_12wk" || o === "retained_manual") {
      monthRetainedCount++;
    } else if (o === "opp_lost") {
      monthOppLostCount++;
    }
  }
  const cycleIds = (openCycles ?? []).map((c) => c.id as number);
  const openClientIds = (openCycles ?? [])
    .map((c) => c.client_id as number | null)
    .filter((v): v is number => v != null);

  const [notesRes, meetingsRes] = await Promise.all([
    cycleIds.length
      ? db
          .from("retention_notes")
          .select("id, cycle_id, note_text, source, batch_id, author_email, created_at")
          .in("cycle_id", cycleIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
    openClientIds.length
      ? db
          .from("coach_meetings")
          .select("id, client_id, meeting_date, notes, fathom_link")
          .in("client_id", openClientIds)
          .order("meeting_date", { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const notes = notesRes.data ?? [];

  // Group meetings per client id, cap at 5 most recent per client (all we
  // render on the card).
  const meetingsByClient = new Map<
    number,
    { id: number; meetingDate: string; notes: string; fathomLink: string | null }[]
  >();
  for (const r of (meetingsRes.data ?? []) as {
    id: number;
    client_id: number | null;
    meeting_date: string;
    notes: string | null;
    fathom_link: string | null;
  }[]) {
    if (r.client_id == null) continue;
    const arr = meetingsByClient.get(r.client_id) ?? [];
    if (arr.length >= 5) continue;
    arr.push({
      id: r.id,
      meetingDate: r.meeting_date,
      notes: r.notes ?? "",
      fathomLink: r.fathom_link ?? null,
    });
    meetingsByClient.set(r.client_id, arr);
  }

  return (
    <RetentionsView
      hubClients={hub.clients.map((c) => ({
        id: c.id,
        name: c.name,
        coach: c.coach,
        program: c.program,
        endDate: c.endDate,
        daysRemaining: c.daysRemaining,
        latestCheckInScore: c.latestCheckInScore,
        latestCheckInDaysAgo: c.latestCheckInDaysAgo,
        workoutsCompleted7d: c.everfit?.workoutsCompleted7d ?? null,
        workoutsAssigned7d: c.everfit?.workoutsAssigned7d ?? null,
        lastClientMessageAt: c.everfit?.lastClientMessageAt ?? null,
        lastCoachMessageDaysAgo: c.lastCoachMessageDaysAgo,
        everfitSummary: c.everfit?.summary ?? null,
        everfitStale: c.everfit?.isStale ?? false,
        retentionCycleOpen: c.retentionCycleOpen,
        hasExtensionRecordedThisCycle: c.hasExtensionRecordedThisCycle,
        score: c.score,
        weeklyReports: c.weeklyReports.slice(0, 3).map((w) => ({
          weekLabel: w.weekLabel,
          workoutPct: w.workoutPct,
          workoutsCompleted: w.workoutsCompleted,
          workoutsAssigned: w.workoutsAssigned,
          note: w.note,
        })),
        meetings: meetingsByClient.get(c.id) ?? [],
      }))}
      openCycles={(openCycles ?? []).map((c) => ({
        id: c.id as number,
        clientId: c.client_id as number,
        enteredWindowAt: c.entered_window_at as string,
        endDateAtEntry: c.end_date_at_entry as string,
      }))}
      notes={(notes ?? []).map((n) => ({
        id: (n as { id: number }).id,
        cycleId: (n as { cycle_id: number }).cycle_id,
        noteText: (n as { note_text: string }).note_text,
        source: (n as { source: string }).source,
        authorEmail: (n as { author_email: string }).author_email,
        createdAt: (n as { created_at: string }).created_at,
      }))}
      monthRetention={hub.monthRetention}
      monthConversion={{
        retainedCount: monthRetainedCount,
        oppLostCount: monthOppLostCount,
      }}
    />
  );
}
