import { loadHubV3, type HubClientV3 } from "@/lib/coaching-v3/hub";
import { getServiceSupabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import SyncBar from "./components/SyncBar";
import TodayView, { type CheckInSubmission, type ClientRow } from "./TodayView";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const hub = await loadHubV3();
  if (!hub) redirect("/api/auth/signin");

  // Low check-ins (score < 60) from the last 7 days, most recent first.
  const db = getServiceSupabase();
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: checkinRows } = await db
    .from("client_check_ins")
    .select(
      "id, client_id, client_name, coach_name, q1_overall, q2_strength, q3_lifestyle, q4_progress, q5_open_response, score_0_100, submitted_at",
    )
    .lt("score_0_100", 60)
    .gte("submitted_at", sevenDaysAgoIso)
    .order("submitted_at", { ascending: false })
    .limit(500);

  const norm = (s: string | null | undefined) =>
    (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const INACTIVE = new Set(["fatima", "belkys"]);
  const checkIns: CheckInSubmission[] = (checkinRows ?? [])
    .filter((r) => !INACTIVE.has(norm(r.coach_name as string)))
    .map((r) => ({
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
    }));

  const clientProps: ClientRow[] = hub.clients.map(mapClient);

  return (
    <>
      <SyncBar latest={hub.latestSheetSync} />
      <TodayView
        clients={clientProps}
        checkIns={checkIns}
        latestSheetSync={hub.latestSheetSync}
        monthRetention={{
          retentionCount: hub.monthRetention.retentionCount,
          retentionRevenue: hub.monthRetention.retentionRevenue,
          refundCount: hub.monthRetention.refundCount,
          refundAmount: hub.monthRetention.refundAmount,
        }}
      />
    </>
  );
}

function mapClient(c: HubClientV3): ClientRow {
  return {
    id: c.id,
    name: c.name,
    coach: c.coach,
    endDate: c.endDate,
    daysRemaining: c.daysRemaining,
    latestCheckInScore: c.latestCheckInScore,
    latestCheckInDaysAgo: c.latestCheckInDaysAgo,
    workoutsCompleted7d: c.everfit?.workoutsCompleted7d ?? null,
    workoutsAssigned7d: c.everfit?.workoutsAssigned7d ?? null,
    todayBuckets: c.todayBuckets,
    weeklyReports: c.weeklyReports.slice(0, 4).map((w) => ({
      weekLabel: w.weekLabel,
      workoutPct: w.workoutPct,
      workoutsCompleted: w.workoutsCompleted,
      workoutsAssigned: w.workoutsAssigned,
      note: w.note,
    })),
    isGhosting: c.isGhosting,
    zeroWorkoutStreakWeeks: c.zeroWorkoutStreakWeeks,
  };
}
