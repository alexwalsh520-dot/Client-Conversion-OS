import { loadHubV3 } from "@/lib/coaching-v3/hub";
import { getServiceSupabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import ClientsView from "./ClientsView";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const hub = await loadHubV3();
  if (!hub) redirect("/api/auth/signin");

  // Extra fields the table wants but hub.ts doesn't already carry.
  const db = getServiceSupabase();
  const { data: extra } = await db
    .from("clients")
    .select("id, nutrition_status, nutrition_assigned_at, start_date")
    .in("status", ["active"]);
  const byId = new Map<number, { nutritionStatus: string; nutritionAssignedAt: string | null; startDate: string | null }>();
  for (const r of extra ?? [])
    byId.set(r.id as number, {
      nutritionStatus: (r.nutrition_status as string) ?? "",
      nutritionAssignedAt: (r.nutrition_assigned_at as string) ?? null,
      startDate: (r.start_date as string) ?? null,
    });

  const rows = hub.clients.map((c) => {
    const x = byId.get(c.id);
    return {
      id: c.id,
      name: c.name,
      coach: c.coach,
      program: c.program,
      endDate: c.endDate,
      daysRemaining: c.daysRemaining,
      startDate: x?.startDate ?? null,
      score: c.score,
      workoutsCompleted7d: c.everfit?.workoutsCompleted7d ?? null,
      workoutsAssigned7d: c.everfit?.workoutsAssigned7d ?? null,
      lastClientMessageAt: c.everfit?.lastClientMessageAt ?? null,
      lastCoachMessageDaysAgo: c.lastCoachMessageDaysAgo,
      latestCheckInScore: c.latestCheckInScore,
      latestCheckInDaysAgo: c.latestCheckInDaysAgo,
      retentionCycleOpen: c.retentionCycleOpen,
      nutritionStatus: x?.nutritionStatus ?? "",
      everfitReplies7d: c.everfit?.clientReplies7d ?? null,
      everfitActivity7d: c.everfit?.activity7d ?? null,
      everfitStale: c.everfit?.isStale ?? false,
      everfitSummary: c.everfit?.summary ?? null,
      todayBuckets: c.todayBuckets,
      weeklyReports: c.weeklyReports.slice(0, 4).map((w) => ({
        weekLabel: w.weekLabel,
        weekEndingAt: w.weekEndingAt,
        workoutPct: w.workoutPct,
        note: w.note,
      })),
    };
  });

  return <ClientsView rows={rows} />;
}
