// Coaching V3 Everfit sync — shared type contracts.
//
// The V3 JSON schema is intentionally lean (see 20260915180000 migration
// comment): 7 numbers + 2 timestamps + a one-line summary per client. That
// keeps a 300-client daily upload fast enough for MAS to run 5x/week.

export interface V3ClientRow {
  everfit_id: string;
  name: string;
  coach: string | null;
  workouts_completed_7d: number | null;
  workouts_assigned_7d: number | null;
  client_replies_7d: number | null;
  activity_7d: number | null;
  last_client_message_at: string | null;
  last_coach_message_at: string | null;
  summary: string | null;
}

export interface V3Report {
  schema_version: 3;
  captured_at: string;
  clients: V3ClientRow[];
}

/** Retention probability bucket for at-a-glance rendering. */
export type RetentionBucket = "likely" | "coin_flip" | "at_risk" | "unknown";

export interface RetentionScore {
  score: number; // 0..100
  bucket: RetentionBucket;
  reasons: string[]; // one line each, ordered by weight
}

/** Everfit state joined onto a CCOS client for Coaching V3 render. */
export interface V3EverfitState {
  everfitId: string;
  workoutsCompleted7d: number | null;
  workoutsAssigned7d: number | null;
  clientReplies7d: number | null;
  activity7d: number | null;
  lastClientMessageAt: string | null;
  lastCoachMessageAt: string | null;
  summary: string | null;
  capturedAt: string;
  isStale: boolean; // capturedAt older than 36h
}
