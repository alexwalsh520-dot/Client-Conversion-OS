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
  const { data: openCycles } = await db
    .from("retention_cycles")
    .select("id, client_id, entered_window_at, end_date_at_entry")
    .is("outcome", null);
  const cycleIds = (openCycles ?? []).map((c) => c.id as number);
  const { data: notes } = cycleIds.length
    ? await db
        .from("retention_notes")
        .select("id, cycle_id, note_text, source, batch_id, author_email, created_at")
        .in("cycle_id", cycleIds)
        .order("created_at", { ascending: false })
    : { data: [] as unknown[] };

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
    />
  );
}
