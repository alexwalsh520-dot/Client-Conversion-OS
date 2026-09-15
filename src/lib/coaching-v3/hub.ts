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
import type { RetentionScore, V3EverfitState } from "./types";

const DAY_MS = 86_400_000;
const V3_STALE_HOURS = 36;

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

export type TodayBucket =
  | "past_end"
  | "retention_ask"
  | "zero_workouts"
  | "concerning_note"
  | "silent_2wk";

/** Words in an assistant note that flag "MAS should look" (case-insensitive
 *  substring match on latest note). Kept intentionally short — false positives
 *  are more costly than false negatives here, since a coach chat can also
 *  trigger buckets. */
const CONCERNING_TERMS = [
  "cancel",
  "cancell",       // "cancelled" / "cancellation"
  "quit",
  "refund",
  "dispute",
  "unhappy",
  "frustrat",
  "leaving",
  "not happy",
  "considering",
  "chargeback",
  "ghost",
  "no response",
  "no reply",
  "unresponsive",
];

export interface WeeklyReport {
  weekLabel: string;
  weekEndingAt: string;
  workoutPct: number | null;
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
    total: number;
    retained: number;
    lost: number;
    pct: number | null;
    byCoach: {
      coach: string;
      total: number;
      retained: number;
      lost: number;
      pct: number | null;
    }[];
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
    monthCyclesQ,
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
      .select("client_id, client_name, coach_name, week_label, week_ending_at, workout_pct, note")
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
      .from("retention_cycles")
      .select("client_id, outcome, outcome_at")
      .not("outcome", "is", null)
      .gte("outcome_at", monthStart)
      .in("outcome", ["retained_4wk", "retained_12wk", "opp_lost"]),
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
  for (const r of meetingsQ.data ?? []) {
    const k = norm(r.client_name as string);
    if (lastMeetingByName.has(k)) continue;
    const d = daysFromToday(r.meeting_date as string);
    lastMeetingByName.set(k, d !== null ? Math.max(0, -d) : null);
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
    });

    // ---- Today buckets (post sheet-sync redesign, 2026-09-15). Order:
    //      past_end > retention_ask > zero_workouts > concerning_note >
    //      silent_2wk. Bucketed off the sheet weekly reports + DB state.
    const todayBuckets: TodayBucket[] = [];
    if (daysRemaining !== null && daysRemaining < 0 && cycleOpen) {
      todayBuckets.push("past_end");
    }
    if (
      daysRemaining !== null &&
      daysRemaining >= 0 &&
      daysRemaining <= 14 &&
      !ms?.retentionCompleted &&
      !ms?.retentionPromptedDate
    ) {
      todayBuckets.push("retention_ask");
    }
    if (
      latestWeek &&
      latestWeek.workoutPct !== null &&
      latestWeek.workoutPct === 0
    ) {
      todayBuckets.push("zero_workouts");
    }
    const noteBody = (latestWeek?.note ?? "").toLowerCase();
    if (noteBody && CONCERNING_TERMS.some((t) => noteBody.includes(t))) {
      todayBuckets.push("concerning_note");
    }
    // Silent = last two weekly reports both have empty notes AND client is
    // active. Only fires when we have at least 2 weeks of history for them
    // (otherwise it's just a new client, not a signal).
    if (
      row.status === "active" &&
      priorWeek &&
      !latestWeek?.note &&
      !priorWeek.note
    ) {
      todayBuckets.push("silent_2wk");
    }

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
    };
  });

  const visible = visibleCoach
    ? clients.filter((c) => norm(c.coach) === norm(visibleCoach))
    : clients;

  // Month retention rollup — from closed retention cycles this calendar month.
  const monthRows = (monthCyclesQ.data ?? []) as {
    client_id: number;
    outcome: "retained_4wk" | "retained_12wk" | "opp_lost";
  }[];
  const clientCoachMap = new Map<number, string>();
  for (const c of clientsRaw) clientCoachMap.set(c.id, c.coach_name ?? "");
  const perCoach = new Map<string, { total: number; retained: number; lost: number }>();
  let totalAll = 0,
    retainedAll = 0,
    lostAll = 0;
  for (const r of monthRows) {
    const coach = clientCoachMap.get(r.client_id) ?? "Unknown";
    const bucket = perCoach.get(coach) ?? { total: 0, retained: 0, lost: 0 };
    bucket.total += 1;
    totalAll += 1;
    if (r.outcome === "opp_lost") {
      bucket.lost += 1;
      lostAll += 1;
    } else {
      bucket.retained += 1;
      retainedAll += 1;
    }
    perCoach.set(coach, bucket);
  }

  const byCoach = [...perCoach.entries()]
    .map(([coach, v]) => ({
      coach,
      total: v.total,
      retained: v.retained,
      lost: v.lost,
      pct: v.total > 0 ? Math.round((v.retained / v.total) * 100) : null,
    }))
    .sort(
      (a, b) =>
        (b.pct ?? -1) - (a.pct ?? -1) || b.total - a.total || a.coach.localeCompare(b.coach),
    );

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
      total: totalAll,
      retained: retainedAll,
      lost: lostAll,
      pct: totalAll > 0 ? Math.round((retainedAll / totalAll) * 100) : null,
      byCoach,
    },
  };
}
