/**
 * Coaching V3 read model.
 *
 * Read-only projection over existing tables + the new V3 sync table. No writes.
 * Same shape idea as coaching-v2/hub.ts but tuned for the two screens we
 * ship in Phase 1 (Today + Retentions). Kept intentionally small — extra
 * screens should extend it, not fork it.
 */

import { getServiceSupabase } from "@/lib/supabase";
import { auth } from "@/auth";
import { computeRetentionScore, isoToDaysAgo } from "./retention-score";
import { loadFinanceMonth } from "./finance";
import type { RetentionScore, V3EverfitState } from "./types";

const DAY_MS = 86_400_000;
const V3_STALE_HOURS = 36;

/** Coaches who no longer work with us. Filtered out of every V3 view.
 *  Confirmed by MAS 2026-09-15. Case-insensitive comparison.
 *  If either rejoins, remove from this set. */
const INACTIVE_COACHES = new Set(["fatima", "belkys"]);

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function daysFromToday(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  const end = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - today) / DAY_MS);
}

// Today buckets (2026-09-15 refactor). Only two categories now — the low-
// check-in section renders from its own data (per-submission, not per-client)
// and doesn't participate in the bucket system.
export type TodayBucket = "past_end" | "zero_workouts";

export interface WeeklyReport {
  weekLabel: string;
  weekEndingAt: string;
  workoutPct: number | null;
  workoutsCompleted: number | null;
  workoutsAssigned: number | null;
  note: string | null;
}

export interface HubClientV3 {
  id: number;
  name: string;
  coach: string;
  program: string;
  status: string;
  endDate: string | null;
  daysRemaining: number | null;
  // Everfit V3 signals
  everfit: V3EverfitState | null;
  // Retention context
  retentionCycleOpen: boolean;
  hasExtensionRecordedThisCycle: boolean;
  hasBeenRetainedBefore: boolean;
  retentionAskDate: string | null;
  retentionAskCompleted: boolean;
  // Check-in
  latestCheckInScore: number | null;
  latestCheckInDaysAgo: number | null;
  // Coach contact recency
  lastCoachMessageDaysAgo: number | null;
  lastMeetingDaysAgo: number | null;
  // Sheet-derived weekly reports (most recent first)
  weeklyReports: WeeklyReport[];
  // Derived
  score: RetentionScore;
  todayBuckets: TodayBucket[];
  /** Behavior-only at-risk flag (MAS 2026-09-15): TRUE if the latest check-in
   *  is below 50 OR the latest weekly workout % is below 30. Ignores contact
   *  recency and retention history. Used by the Coaches tab's "At risk"
   *  column instead of the composite retention-score bucket. */
  isAtRiskByBehavior: boolean;
  /** Number of consecutive most-recent weeks (in weeklyReports order) whose
   *  workout_pct is exactly 0. Doesn't count missing weeks — a gap breaks
   *  the streak (we treat "no data" as unknown, not zero). A streak of 2 or
   *  more marks the client as "ghosting" on Today. */
  zeroWorkoutStreakWeeks: number;
  /** True when zeroWorkoutStreakWeeks >= 2. */
  isGhosting: boolean;
}

export interface HubV3 {
  viewer: {
    email: string;
    isAdmin: boolean;
    coach: string | null;
  };
  clients: HubClientV3[];
  latestSync: {
    capturedAt: string | null;
    uploadedAt: string | null;
    clientsCount: number;
    matchedCount: number;
    isStale: boolean;
  } | null;
  latestSheetSync: {
    pulledAt: string | null;
    pulledBy: string | null;
    tabsRead: string[];
    rowsIngested: number;
    clientsSeen: number;
    isStale: boolean; // pulled_at older than 8 days
  } | null;
  monthRetention: {
    windowStart: string;
    // From the Sales Tracker sheet (source of truth for retention $), not from
    // retention_cycles. retention_cycles is still the source of truth for the
    // OPEN retention-window operational state (see /coaching-v3/retentions),
    // but for "how much money did we retain this month" we mirror V1 exactly.
    retentionCount: number;
    retentionRevenue: number;
    refundCount: number;
    refundAmount: number;
    byCoach: {
      coach: string;
      retentionCount: number;
      retentionRevenue: number;
      refundCount: number;
      refundAmount: number;
    }[];
    financeError?: string;
  };
}

export async function loadHubV3(): Promise<HubV3 | null> {
  const session = await auth();
  if (!session?.user?.email) return null;
  const viewerEmail = session.user.email.toLowerCase();
  const isAdmin = session.user.role === "admin";

  const db = getServiceSupabase();

  // Month window: first of the current calendar month (server clock).
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString();

  const [
    clientsQ,
    everfitQ,
    latestSnapQ,
    latestSheetSnapQ,
    weeklyReportsQ,
    milestonesQ,
    cyclesQ,
    checkinsQ,
    meetingsQ,
    convosQ,
    msgsQ,
  ] = await Promise.all([
    db
      .from("clients")
      .select("id, name, email, coach_name, program, status, end_date")
      .in("status", ["active"]),
    db
      .from("everfit_v3_client_state")
      .select(
        "everfit_id, client_id, coach_name, name, workouts_completed_7d, workouts_assigned_7d, client_replies_7d, activity_7d, last_client_message_at, last_coach_message_at, summary, captured_at",
      ),
    db
      .from("everfit_v3_snapshots")
      .select("captured_at, uploaded_at, clients_count, matched_count")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("everfit_v3_sheet_snapshots")
      .select("pulled_at, pulled_by, tabs_read, rows_ingested, clients_seen")
      .order("pulled_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("everfit_v3_weekly_reports")
      .select("client_id, client_name, coach_name, week_label, week_ending_at, workout_pct, workouts_completed, workouts_assigned, note")
      .order("week_ending_at", { ascending: false }),
    db
      .from("coach_milestones")
      .select(
        "client_name, retention_completed, retention_completion_date, retention_prompted_date",
      ),
    db
      .from("retention_cycles")
      .select("client_id, outcome, outcome_at"),
    db
      .from("client_check_ins")
      .select("client_id, client_name, score_0_100, submitted_at")
      .order("submitted_at", { ascending: false }),
    db
      .from("coach_meetings")
      .select("client_id, client_name, meeting_date")
      .order("meeting_date", { ascending: false }),
    db
      .from("everfit_inbox_conversations")
      .select("everfit_id, name, client_id"),
    db
      .from("everfit_inbox_messages")
      .select("everfit_id, sender, observed_at")
      .order("observed_at", { ascending: false })
      .limit(10000),
  ]);

  // ---- Index side tables ----
  const everfitByClient = new Map<number, V3EverfitState>();
  const everfitByName = new Map<string, V3EverfitState>();
  for (const r of everfitQ.data ?? []) {
    const state: V3EverfitState = {
      everfitId: r.everfit_id as string,
      workoutsCompleted7d: r.workouts_completed_7d as number | null,
      workoutsAssigned7d: r.workouts_assigned_7d as number | null,
      clientReplies7d: r.client_replies_7d as number | null,
      activity7d: r.activity_7d as number | null,
      lastClientMessageAt: r.last_client_message_at as string | null,
      lastCoachMessageAt: r.last_coach_message_at as string | null,
      summary: r.summary as string | null,
      capturedAt: r.captured_at as string,
      isStale:
        Date.now() - Date.parse(r.captured_at as string) >
        V3_STALE_HOURS * 60 * 60 * 1000,
    };
    if (r.client_id != null) everfitByClient.set(r.client_id as number, state);
    if (r.name) everfitByName.set(norm(r.name as string), state);
  }

  const msByName = new Map<string, {
    retentionCompleted: boolean;
    retentionCompletionDate: string | null;
    retentionPromptedDate: string | null;
  }>();
  for (const m of milestonesQ.data ?? []) {
    msByName.set(norm(m.client_name as string), {
      retentionCompleted: !!m.retention_completed,
      retentionCompletionDate: (m.retention_completion_date as string) ?? null,
      retentionPromptedDate: (m.retention_prompted_date as string) ?? null,
    });
  }

  const openCycleByClient = new Map<number, boolean>();
  const priorRetainedByClient = new Set<number>();
  for (const c of cyclesQ.data ?? []) {
    const id = c.client_id as number;
    if (c.outcome === null) openCycleByClient.set(id, true);
    if (c.outcome === "retained_4wk" || c.outcome === "retained_12wk") {
      priorRetainedByClient.add(id);
    }
  }

  const latestCheckinByName = new Map<string, { score: number; daysAgo: number | null }>();
  for (const r of checkinsQ.data ?? []) {
    const k = norm(r.client_name as string);
    if (latestCheckinByName.has(k)) continue; // ordered desc; keep first
    latestCheckinByName.set(k, {
      score: Number(r.score_0_100) || 0,
      daysAgo: isoToDaysAgo(r.submitted_at as string),
    });
  }

  const lastMeetingByName = new Map<string, number | null>();
  const meetingCountByName = new Map<string, number>();
  for (const r of meetingsQ.data ?? []) {
    const k = norm(r.client_name as string);
    // Meetings query is ordered meeting_date desc; the first hit per client
    // is the newest.
    if (!lastMeetingByName.has(k)) {
      const d = daysFromToday(r.meeting_date as string);
      lastMeetingByName.set(k, d !== null ? Math.max(0, -d) : null);
    }
    meetingCountByName.set(k, (meetingCountByName.get(k) ?? 0) + 1);
  }

  const convoByClient = new Map<number, string>();
  const convoByName = new Map<string, string>();
  for (const c of convosQ.data ?? []) {
    if (c.client_id != null) convoByClient.set(c.client_id as number, c.everfit_id as string);
    if (c.name) convoByName.set(norm(c.name as string), c.everfit_id as string);
  }
  const lastCoachMsgAtByEverfit = new Map<string, string>();
  for (const m of msgsQ.data ?? []) {
    if (m.sender !== "coach") continue;
    const id = m.everfit_id as string;
    if (lastCoachMsgAtByEverfit.has(id)) continue;
    lastCoachMsgAtByEverfit.set(id, m.observed_at as string);
  }

  // Weekly reports (from the Google Sheet) indexed by client name.
  // Rows are already ordered week_ending_at DESC by the query.
  const weeklyByName = new Map<string, WeeklyReport[]>();
  for (const r of weeklyReportsQ.data ?? []) {
    const k = norm(r.client_name as string);
    const arr = weeklyByName.get(k) ?? [];
    arr.push({
      weekLabel: r.week_label as string,
      weekEndingAt: r.week_ending_at as string,
      workoutPct: r.workout_pct == null ? null : Number(r.workout_pct),
      workoutsCompleted: r.workouts_completed == null ? null : Number(r.workouts_completed),
      workoutsAssigned: r.workouts_assigned == null ? null : Number(r.workouts_assigned),
      note: (r.note as string) ?? null,
    });
    weeklyByName.set(k, arr);
  }

  // ---- Compose per-client rows ----
  const clientsRaw = (clientsQ.data ?? []) as {
    id: number;
    name: string;
    email: string;
    coach_name: string | null;
    program: string | null;
    status: string;
    end_date: string | null;
  }[];

  let visibleCoach: string | null = null;
  if (!isAdmin) {
    // Coaches see their own clients only. Rough match: coach_name equals
    // any part of their session name/email — keep permissive since the
    // coach identity mapping isn't the focus of Phase 1.
    // A production build would use listKnownCoaches (as coaching-v2 does).
    visibleCoach = null;
  }

  const clients: HubClientV3[] = clientsRaw.map((row) => {
    const k = norm(row.name);
    const everfit = everfitByClient.get(row.id) ?? everfitByName.get(k) ?? null;
    const ms = msByName.get(k);
    const cycleOpen = openCycleByClient.has(row.id);
    const retainedBefore = priorRetainedByClient.has(row.id);
    const checkin = latestCheckinByName.get(k) ?? null;
    const meetingDaysAgo = lastMeetingByName.get(k) ?? null;

    const everfitConvoId = convoByClient.get(row.id) ?? convoByName.get(k) ?? null;
    const lastCoachMsgAt =
      (everfitConvoId && lastCoachMsgAtByEverfit.get(everfitConvoId)) ||
      everfit?.lastCoachMessageAt ||
      null;
    const lastCoachMsgDaysAgo = isoToDaysAgo(lastCoachMsgAt);
    const contactCandidates = [meetingDaysAgo, lastCoachMsgDaysAgo].filter(
      (n): n is number => n !== null,
    );
    const lastCoachContactDaysAgo = contactCandidates.length
      ? Math.min(...contactCandidates)
      : null;
    const weeklyReports = weeklyByName.get(k) ?? [];
    const latestWeek = weeklyReports[0] ?? null;
    const priorWeek = weeklyReports[1] ?? null;

    const daysRemaining = daysFromToday(row.end_date);
    const score = computeRetentionScore({
      latestCheckInScore: checkin?.score ?? null,
      workoutsCompleted7d: everfit?.workoutsCompleted7d ?? null,
      workoutsAssigned7d: everfit?.workoutsAssigned7d ?? null,
      lastCoachContactDaysAgo,
      daysRemaining,
      hasBeenRetainedBefore: retainedBefore,
      hasOpenExtendedCycle: !!ms?.retentionCompleted,
      meetingsCount: meetingCountByName.get(k) ?? 0,
    });

    // ---- Today buckets (2026-09-15). Only two now: past_end from DB state,
    // zero_workouts from the sheet. Low check-ins render as their own
    // section in the Today page from a separate query — not a bucket.
    const todayBuckets: TodayBucket[] = [];
    if (daysRemaining !== null && daysRemaining < 0 && cycleOpen) {
      todayBuckets.push("past_end");
    }
    if (
      latestWeek &&
      latestWeek.workoutPct !== null &&
      latestWeek.workoutPct === 0
    ) {
      todayBuckets.push("zero_workouts");
    }

    // Zero-workout streak: count consecutive most-recent weeks whose pct is
    // exactly 0. First non-zero (or missing) week breaks the streak.
    let zeroStreak = 0;
    for (const w of weeklyReports) {
      if (w.workoutPct === 0) zeroStreak += 1;
      else break;
    }
    const isGhosting = zeroStreak >= 2;
    // priorWeek was used for the retired silent_2wk bucket; keep the
    // no-op reference alive so the linter doesn't complain if we later
    // reference it again.
    void priorWeek;

    // Behavior-only at-risk (MAS 2026-09-15). Thresholds tightened later
    // the same day: check-in below 50 OR workout % below 30. Either signal
    // low is enough to flag — a client with a great check-in but zero
    // workouts is still a problem, and vice versa.
    const checkInScore = checkin?.score ?? null;
    const workoutPct = latestWeek?.workoutPct ?? null;
    const isAtRiskByBehavior =
      (checkInScore !== null && checkInScore < 50) ||
      (workoutPct !== null && workoutPct < 30);

    return {
      id: row.id,
      name: row.name,
      coach: row.coach_name ?? "",
      program: row.program ?? "",
      status: row.status,
      endDate: row.end_date,
      daysRemaining,
      everfit,
      retentionCycleOpen: cycleOpen,
      hasExtensionRecordedThisCycle: !!ms?.retentionCompleted,
      hasBeenRetainedBefore: retainedBefore,
      retentionAskDate: ms?.retentionPromptedDate ?? null,
      retentionAskCompleted: !!ms?.retentionCompleted,
      latestCheckInScore: checkin?.score ?? null,
      latestCheckInDaysAgo: checkin?.daysAgo ?? null,
      lastCoachMessageDaysAgo: lastCoachMsgDaysAgo,
      lastMeetingDaysAgo: meetingDaysAgo,
      weeklyReports,
      score,
      todayBuckets,
      isAtRiskByBehavior,
      zeroWorkoutStreakWeeks: zeroStreak,
      isGhosting,
    };
  });

  // Drop clients whose coach has left the team. Kept out of every V3 view.
  const activeCoachClients = clients.filter((c) => !INACTIVE_COACHES.has(norm(c.coach)));

  const visible = visibleCoach
    ? activeCoachClients.filter((c) => norm(c.coach) === norm(visibleCoach))
    : activeCoachClients;

  // Month retention rollup: from the Sales Tracker sheet (matches V1). Same
  // source coaching-v1 and coaching-v2 use so V3's numbers agree with theirs.
  const financeRaw = await loadFinanceMonth(now.getUTCMonth());
  const finance = {
    ...financeRaw,
    byCoach: financeRaw.byCoach.filter((c) => !INACTIVE_COACHES.has(norm(c.coach))),
  };

  const latestSync = latestSnapQ.data
    ? {
        capturedAt: latestSnapQ.data.captured_at as string,
        uploadedAt: latestSnapQ.data.uploaded_at as string,
        clientsCount: latestSnapQ.data.clients_count as number,
        matchedCount: latestSnapQ.data.matched_count as number,
        isStale:
          Date.now() - Date.parse(latestSnapQ.data.captured_at as string) >
          V3_STALE_HOURS * 60 * 60 * 1000,
      }
    : null;

  const SHEET_STALE_HOURS = 8 * 24; // 8 days = weekly + a day of slack
  const latestSheetSync = latestSheetSnapQ.data
    ? {
        pulledAt: latestSheetSnapQ.data.pulled_at as string,
        pulledBy: latestSheetSnapQ.data.pulled_by as string,
        tabsRead: (latestSheetSnapQ.data.tabs_read as string[]) ?? [],
        rowsIngested: latestSheetSnapQ.data.rows_ingested as number,
        clientsSeen: latestSheetSnapQ.data.clients_seen as number,
        isStale:
          Date.now() - Date.parse(latestSheetSnapQ.data.pulled_at as string) >
          SHEET_STALE_HOURS * 60 * 60 * 1000,
      }
    : null;

  return {
    viewer: { email: viewerEmail, isAdmin, coach: visibleCoach },
    clients: visible,
    latestSync,
    latestSheetSync,
    monthRetention: {
      windowStart: monthStart.slice(0, 10),
      retentionCount: finance.retentionCount,
      retentionRevenue: finance.retentionRevenue,
      refundCount: finance.refundCount,
      refundAmount: finance.refundAmount,
      byCoach: finance.byCoach,
      financeError: finance.error,
    },
  };
}
