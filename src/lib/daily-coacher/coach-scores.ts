// Daily Coacher Usage Score — coach performance impact.
//
// Per-client score (capped at 10):
//   client_events = (Copy clicks for this client)
//                 + (client_notes rows for this client, ALL sources)
//                 + (coach_meetings rows for this client with non-empty notes)
//   client_score  = min(10, client_events * 0.5)
//
// Coach total: round(average of client_score across the coach's ACTIVE
// clients). Zeros count in the denominator — clients you haven't engaged
// with via Daily Coacher still drag the average down.
//
// Score-to-percentage boost (hard-coded per the spec):
//   0 → +0%, 1 → +1%, 2 → +3%, 3 → +6%, 4 → +10%, 5 → +13%,
//   6 → +15%, 7 → +16%, 8 → +18%, 9 → +20%, 10 → +25%
//
// Browser-safe: this module uses the anon-key supabase client. The tables
// it reads (clients, client_notes, coach_meetings, daily_coacher_tip_uses)
// all have anon SELECT policies.

import { supabase } from "@/lib/supabase";

// Hard-coded score → percentage boost. Index = score (0..10).
// User specified an exact non-linear curve.
export const BOOST_PCT_BY_SCORE: readonly number[] = [
  0,  // score 0
  1,  // score 1
  3,  // score 2
  6,  // score 3
  10, // score 4
  13, // score 5
  15, // score 6
  16, // score 7
  18, // score 8
  20, // score 9
  25, // score 10 (lowkey impossible to get)
];

const EVENT_WEIGHT = 0.5;
const MAX_CLIENT_SCORE = 10;
// Max raw events that can contribute to a single client's score.
// Anything beyond this is wasted (cap kicks in).
const EVENT_CAP = MAX_CLIENT_SCORE / EVENT_WEIGHT; // 20

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the boost percentage to add to a coach's overall score given
 * their Daily Coacher Usage Score (0-10). Out-of-range scores clamp.
 */
export function boostPctForScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  const idx = Math.max(0, Math.min(10, Math.round(score)));
  return BOOST_PCT_BY_SCORE[idx] ?? 0;
}

export interface CoachScoreEntry {
  /** Rounded 0-10 score. */
  score: number;
  /** Boost percentage (already mapped from score via the hard-coded table). */
  boostPct: number;
  /** Active clients counted in the denominator. */
  activeClientCount: number;
  /** Sum of capped per-client scores (0..10*activeClientCount). */
  totalEvents: number;
}

export type CoachScoreMap = Record<string, CoachScoreEntry>;

/**
 * Computes Daily Coacher Usage Scores for every coach with at least one
 * active client. Performs four small queries (clients/notes/meetings/copies)
 * and aggregates in JS — simpler than a single SQL join through the
 * Supabase JS client and cheap enough for the current data volumes.
 *
 * Failures fall back to an empty map so the Coach Performance tab can
 * render without the boost rather than crashing.
 */
export async function getCoachDailyCoacherScores(): Promise<CoachScoreMap> {
  try {
    // 1. Active clients (with assigned coach).
    const { data: clientsData, error: clientsErr } = await supabase
      .from("clients")
      .select("id, name, coach_name")
      .eq("status", "active")
      .not("coach_name", "is", null);
    if (clientsErr) throw clientsErr;
    const activeClients = (clientsData || []).filter(
      (c): c is { id: number; name: string; coach_name: string } =>
        Boolean(c.coach_name && c.name)
    );
    if (activeClients.length === 0) return {};

    const clientIds = activeClients.map((c) => c.id);
    const clientNames = activeClients.map((c) => c.name);

    // 2. Tip-use counts per client_id.
    const { data: tipUses, error: tipErr } = await supabase
      .from("daily_coacher_tip_uses")
      .select("client_id")
      .in("client_id", clientIds);
    if (tipErr) throw tipErr;
    const tipUsesByClient = countBy((tipUses || []) as { client_id: number }[], (r) => r.client_id);

    // 3. client_notes counts per client_name (table is keyed by name).
    const { data: notes, error: notesErr } = await supabase
      .from("client_notes")
      .select("client_name")
      .in("client_name", clientNames);
    if (notesErr) throw notesErr;
    const notesByName = countBy(
      (notes || []) as { client_name: string }[],
      (r) => r.client_name
    );

    // 4. coach_meetings with non-empty notes per client_id.
    const { data: meetings, error: meetingsErr } = await supabase
      .from("coach_meetings")
      .select("client_id, notes")
      .in("client_id", clientIds)
      .not("notes", "is", null)
      .neq("notes", "");
    if (meetingsErr) throw meetingsErr;
    const meetingsByClient = countBy(
      (meetings || []) as { client_id: number; notes: string }[],
      (r) => r.client_id
    );

    // 5. Aggregate per coach.
    const accum: Record<string, { sumScore: number; activeCount: number; totalEvents: number }> = {};
    for (const c of activeClients) {
      const events =
        (tipUsesByClient.get(c.id) ?? 0) +
        (notesByName.get(c.name) ?? 0) +
        (meetingsByClient.get(c.id) ?? 0);
      const cappedEvents = Math.min(EVENT_CAP, events);
      const clientScore = cappedEvents * EVENT_WEIGHT; // 0..10
      const bucket = (accum[c.coach_name] ??= { sumScore: 0, activeCount: 0, totalEvents: 0 });
      bucket.sumScore += clientScore;
      bucket.activeCount += 1;
      bucket.totalEvents += events;
    }

    const result: CoachScoreMap = {};
    for (const [coachName, bucket] of Object.entries(accum)) {
      const avg = bucket.activeCount > 0 ? bucket.sumScore / bucket.activeCount : 0;
      const rounded = Math.max(0, Math.min(10, Math.round(avg)));
      result[coachName] = {
        score: rounded,
        boostPct: boostPctForScore(rounded),
        activeClientCount: bucket.activeCount,
        totalEvents: bucket.totalEvents,
      };
    }
    return result;
  } catch (err) {
    console.warn(
      "[daily-coacher/coach-scores] Failed to compute scores, returning empty:",
      err instanceof Error ? err.message : err
    );
    return {};
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countBy<T, K>(arr: T[], keyFn: (item: T) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const item of arr) {
    const k = keyFn(item);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
