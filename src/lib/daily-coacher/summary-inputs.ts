// Daily Coacher: gather the five context inputs that feed the persistent
// client summary.
//
// The five inputs (matches the build spec):
//   1. Client notes  (public.client_notes WHERE client_name = ...)
//   2. Meeting notes (public.coach_meetings WHERE client_id = ...)
//   3. Onboarding Fathom transcript (public.clients.onboarding_transcript_cached
//      — populated by getOnboardingTranscript in transcript.ts)
//   4. Nutrition intake form (public.nutrition_intake_forms via nutrition_form_id)
//   5. Recent 20 live messages (public.daily_coacher_live_messages, latest 20)
//
// This module also computes the program-progress derived fields (days elapsed,
// days remaining, percent through) that the summary generator stitches in.
//
// Sparse data is handled gracefully — any of the five can be missing/empty
// and the summary still generates.

import { getServiceSupabase } from "@/lib/supabase";
import { getOnboardingTranscript } from "./transcript";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientCore {
  id: number;
  name: string;
  coach_name: string | null;
  program: string | null;
  offer: string | null;
  start_date: string | null;
  end_date: string | null;
  onboarding_date: string | null;
  onboarding_fathom_link: string | null;
  nutrition_form_id: number | null;
  daily_coacher_summary: string | null;
  daily_coacher_summary_updated_at: string | null;
  onboarding_transcript_cached: string | null;
  onboarding_transcript_fetched_at: string | null;
}

export interface NutritionIntake {
  age: number | null;
  height: string | null;
  current_weight: string | null;
  goal_weight: string | null;
  fitness_goal: string | null;
  foods_enjoy: string | null;
  foods_avoid: string | null;
  allergies: string | null;
  protein_preferences: string | null;
  can_cook: string | null;
  meal_count: string | null;
  medications: string | null;
  supplements: string | null;
  sleep_hours: string | null;
  water_intake: string | null;
  daily_meals_description: string | null;
  daily_meals_description_2: string | null;
  medical_supervision_yn: string | null;
  medical_supervision_detail: string | null;
  synced_at: string | null;
}

export interface MeetingNote {
  meeting_date: string | null;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string | null;
}

export interface ClientNoteRow {
  coach_name: string | null;
  note: string | null;
  created_at: string | null;
}

export interface LiveMessage {
  role: "coach" | "client";
  message: string;
  created_at: string;
}

/** Weekly check-in form submission. Stored in public.client_check_ins;
 *  the client picks themselves from a public dropdown at /check-in and
 *  fills out 4 sliders (Q1: 0-10, Q2-Q4: 1-10) plus an optional paragraph.
 *  See src/lib/check-in/types.ts for the scoring formula. */
export interface CheckInRow {
  q1_overall: number;
  q2_strength: number;
  q3_lifestyle: number;
  q4_progress: number;
  q5_open_response: string | null;
  score_0_100: number;
  submitted_at: string;
}

export interface ProgramProgress {
  daysElapsed: number | null;
  daysRemaining: number | null;
  programDays: number | null;
  percentThrough: number | null; // 0-100
  phase:
    | "onboarding"
    | "early_program"
    | "mid_program"
    | "late_mid"
    | "end_game"
    | "post_program"
    | "unknown";
}

export interface SummaryInputs {
  client: ClientCore;
  progress: ProgramProgress;
  intake: NutritionIntake | null;
  meetings: MeetingNote[]; // chronological, oldest first
  transcript: string | null; // may be null if not yet processed or no link
  clientNotes: ClientNoteRow[]; // chronological, oldest first
  liveMessages: LiveMessage[]; // chronological, oldest first (so order reads naturally)
  /** Weekly client check-in submissions (newest first). May be empty
   *  if the client has never filled out the public /check-in form. */
  checkIns: CheckInRow[];
  /** ISO timestamp of the newest input across all sources. Used by callers
   *  (e.g. the GET /summary route) to decide whether the cached summary is stale. */
  latestInputAt: string | null;
}

// ---------------------------------------------------------------------------
// Program-progress derivation
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function deriveProgress(
  startDate: string | null,
  endDate: string | null,
  todayIso: string = new Date().toISOString()
): ProgramProgress {
  if (!startDate || !endDate) {
    return {
      daysElapsed: null,
      daysRemaining: null,
      programDays: null,
      percentThrough: null,
      phase: "unknown",
    };
  }

  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const today = new Date(todayIso).getTime();
  if (isNaN(start) || isNaN(end)) {
    return {
      daysElapsed: null,
      daysRemaining: null,
      programDays: null,
      percentThrough: null,
      phase: "unknown",
    };
  }

  const programDays = Math.max(0, Math.round((end - start) / DAY_MS));
  const daysElapsed = Math.max(0, Math.round((today - start) / DAY_MS));
  const daysRemaining = Math.max(0, Math.round((end - today) / DAY_MS));
  const percentThrough = programDays > 0
    ? Math.min(100, Math.round((daysElapsed / programDays) * 100))
    : null;

  let phase: ProgramProgress["phase"] = "unknown";
  if (today > end) {
    phase = "post_program";
  } else if (daysElapsed <= 14) {
    phase = "onboarding";
  } else if (daysElapsed <= 30) {
    phase = "early_program";
  } else if (percentThrough !== null && percentThrough < 70) {
    phase = "mid_program";
  } else if (percentThrough !== null && percentThrough < 85) {
    phase = "late_mid";
  } else if (daysRemaining <= 14) {
    phase = "end_game";
  } else {
    phase = "mid_program";
  }

  return { daysElapsed, daysRemaining, programDays, percentThrough, phase };
}

// ---------------------------------------------------------------------------
// Input gathering
// ---------------------------------------------------------------------------

/**
 * Loads the full set of summary inputs for a client. Each fetch fails open —
 * a missing or empty source becomes null/empty in the result, never an error.
 *
 * If the client has an onboarding Fathom link but no cached transcript, this
 * will attempt to fetch the transcript via getOnboardingTranscript (which
 * itself fails gracefully and writes to cache on success).
 */
export async function gatherSummaryInputs(
  clientId: number
): Promise<SummaryInputs | null> {
  const supabase = getServiceSupabase();

  // 1. Client core record
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select(
      "id, name, coach_name, program, offer, start_date, end_date, onboarding_date, onboarding_fathom_link, nutrition_form_id, daily_coacher_summary, daily_coacher_summary_updated_at, onboarding_transcript_cached, onboarding_transcript_fetched_at"
    )
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    console.error(
      `[daily-coacher/summary-inputs] Failed to load client ${clientId}:`,
      clientError?.message
    );
    return null;
  }

  const c = client as ClientCore;

  // 2. Nutrition intake (optional, via foreign key)
  let intake: NutritionIntake | null = null;
  if (c.nutrition_form_id) {
    const { data: intakeData } = await supabase
      .from("nutrition_intake_forms")
      .select(
        "age, height, current_weight, goal_weight, fitness_goal, foods_enjoy, foods_avoid, allergies, protein_preferences, can_cook, meal_count, medications, supplements, sleep_hours, water_intake, daily_meals_description, daily_meals_description_2, medical_supervision_yn, medical_supervision_detail, synced_at"
      )
      .eq("id", c.nutrition_form_id)
      .single();
    intake = (intakeData as NutritionIntake) || null;
  }

  // 3. Meeting notes (by client_id; only meetings with non-empty notes)
  const { data: meetingsData } = await supabase
    .from("coach_meetings")
    .select("meeting_date, duration_minutes, notes, created_at")
    .eq("client_id", c.id)
    .order("meeting_date", { ascending: true, nullsFirst: false });
  const meetings: MeetingNote[] = (meetingsData || []).filter(
    (m): m is MeetingNote => Boolean(m.notes && m.notes.trim().length > 0)
  );

  // 4. Client notes (by client_name — client_notes is keyed by name, not id)
  const { data: notesData } = await supabase
    .from("client_notes")
    .select("coach_name, note, created_at")
    .eq("client_name", c.name)
    .order("created_at", { ascending: true });
  const clientNotes: ClientNoteRow[] = (notesData as ClientNoteRow[]) || [];

  // 5. Recent 20 live messages (latest 20 by created_at, then reverse to
  //    chronological order for natural reading)
  const { data: liveData } = await supabase
    .from("daily_coacher_live_messages")
    .select("role, message, created_at")
    .eq("client_id", c.id)
    .order("created_at", { ascending: false })
    .limit(20);
  const liveMessages: LiveMessage[] = ((liveData as LiveMessage[]) || []).reverse();

  // 5b. Recent client check-in submissions (newest first). Fed into the
  //     per-client summary so the LLM can incorporate client-reported
  //     sentiment ("client reported low adherence to nutrition last week").
  const { data: checkInData } = await supabase
    .from("client_check_ins")
    .select(
      "q1_overall, q2_strength, q3_lifestyle, q4_progress, q5_open_response, score_0_100, submitted_at"
    )
    .eq("client_id", c.id)
    .order("submitted_at", { ascending: false });
  const checkIns: CheckInRow[] = (checkInData as CheckInRow[]) || [];

  // 6. Onboarding transcript — use cache, fall back to Fathom fetch
  let transcript: string | null = c.onboarding_transcript_cached;
  if (!transcript && c.onboarding_fathom_link) {
    transcript = await getOnboardingTranscript({
      id: c.id,
      onboardingFathomLink: c.onboarding_fathom_link,
      onboardingDate: c.onboarding_date,
    });
  }

  // 7. Compute "latest input timestamp" across all sources for staleness check.
  const candidates: (string | null | undefined)[] = [
    intake?.synced_at,
    ...meetings.map((m) => m.created_at),
    ...clientNotes.map((n) => n.created_at),
    ...liveMessages.map((lm) => lm.created_at),
    ...checkIns.map((ci) => ci.submitted_at),
    c.onboarding_transcript_fetched_at,
  ];
  const latestInputAt = candidates
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop() ?? null;

  return {
    client: c,
    progress: deriveProgress(c.start_date, c.end_date),
    intake,
    meetings,
    transcript,
    clientNotes,
    liveMessages,
    checkIns,
    latestInputAt,
  };
}

/**
 * Returns true if the cached summary is older than any of the inputs that
 * feed into it. Returns true when there's no summary yet (`null` timestamp).
 */
export function isSummaryStale(inputs: SummaryInputs): boolean {
  const summaryAt = inputs.client.daily_coacher_summary_updated_at;
  if (!summaryAt) return true;
  if (!inputs.latestInputAt) return false; // nothing newer to compare against
  return new Date(inputs.latestInputAt) > new Date(summaryAt);
}
