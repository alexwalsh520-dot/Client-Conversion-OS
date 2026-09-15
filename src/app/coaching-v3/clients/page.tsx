import { loadHubV3 } from "@/lib/coaching-v3/hub";
import { getServiceSupabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import ClientsView from "./ClientsView";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const hub = await loadHubV3();
  if (!hub) redirect("/api/auth/signin");

  // Load extras for active clients AND every completed client. Completed
  // clients skip the hub read model (they don't need score / today buckets)
  // and are appended as bare rows so search can find them.
  const db = getServiceSupabase();
  const [extraQ, completedQ] = await Promise.all([
    db
      .from("clients")
      .select("id, start_date")
      .in("status", ["active"]),
    db
      .from("clients")
      .select("id, name, coach_name, program, start_date, end_date")
      .eq("status", "completed"),
  ]);

  const byId = new Map<number, { startDate: string | null }>();
  for (const r of extraQ.data ?? [])
    byId.set(r.id as number, {
      startDate: (r.start_date as string) ?? null,
    });

  const daysFromToday = (dateStr: string | null | undefined): number | null => {
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    if (!m) return null;
    const end = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.round((end - today) / 86_400_000);
  };

  const activeRows = hub.clients.map((c) => {
    const x = byId.get(c.id);
    return {
      id: c.id,
      status: "active" as const,
      name: c.name,
      coach: c.coach,
      program: c.program,
      endDate: c.endDate,
      daysRemaining: c.daysRemaining,
      startDate: x?.startDate ?? null,
      score: c.score,
      workoutsCompleted7d: c.everfit?.workoutsCompleted7d ?? null,
      workoutsAssigned7d: c.everfit?.workoutsAssigned7d ?? null,
      latestCheckInScore: c.latestCheckInScore,
      latestCheckInDaysAgo: c.latestCheckInDaysAgo,
      retentionCycleOpen: c.retentionCycleOpen,
      todayBuckets: c.todayBuckets,
      isGhosting: c.isGhosting,
      zeroWorkoutStreakWeeks: c.zeroWorkoutStreakWeeks,
      weeklyReports: c.weeklyReports.slice(0, 4).map((w) => ({
        weekLabel: w.weekLabel,
        weekEndingAt: w.weekEndingAt,
        workoutPct: w.workoutPct,
        workoutsCompleted: w.workoutsCompleted,
        workoutsAssigned: w.workoutsAssigned,
        note: w.note,
      })),
    };
  });

  // Bare rows for completed clients — enough to be found by search and
  // rendered on the Clients page with a "completed" tag. Numeric signals
  // and weekly reports are omitted (they haven't been active in a while).
  const completedRows = (completedQ.data ?? []).map((c) => ({
    id: c.id as number,
    status: "completed" as const,
    name: (c.name as string) ?? "",
    coach: (c.coach_name as string) ?? "",
    program: (c.program as string) ?? "",
    endDate: (c.end_date as string) ?? null,
    daysRemaining: daysFromToday(c.end_date as string),
    startDate: (c.start_date as string) ?? null,
    score: { score: 0, bucket: "unknown" as const, reasons: [] as string[] },
    workoutsCompleted7d: null,
    workoutsAssigned7d: null,
    latestCheckInScore: null,
    latestCheckInDaysAgo: null,
    retentionCycleOpen: false,
    todayBuckets: [] as string[],
    isGhosting: false,
    zeroWorkoutStreakWeeks: 0,
    weeklyReports: [] as {
      weekLabel: string;
      weekEndingAt: string;
      workoutPct: number | null;
      workoutsCompleted: number | null;
      workoutsAssigned: number | null;
      note: string | null;
    }[],
  }));

  return <ClientsView rows={[...activeRows, ...completedRows]} />;
}
