// Client Check-In types — shared between the public form and the admin
// Client Progress tab.

export interface ClientCheckIn {
  id: number;
  clientId: number | null;
  clientName: string;
  clientEmail: string | null;
  coachName: string | null;
  q1Overall: number;
  q2Strength: number;
  q3Adherence: number;
  q4Progress: number;
  q5OpenResponse: string | null;
  score0to100: number;
  submittedAt: string;
}

// Public dropdown row — minimal client info exposed to anonymous typeahead.
export interface CheckInClientOption {
  id: number;
  name: string;
  email: string | null;
}

/** Admin-side row returned by GET /api/check-in/submissions. Joined with
 *  the clients table so the Client Progress UI can compute days_left
 *  without an extra round-trip. */
export interface CheckInSubmissionRow {
  id: number;
  clientId: number | null;
  clientName: string;
  clientEmail: string | null;
  coachName: string | null;
  q1Overall: number;
  q2Strength: number;
  q3Adherence: number;
  q4Progress: number;
  q5OpenResponse: string | null;
  score0to100: number;
  submittedAt: string;
  // Joined from clients table at read time (may differ from snapshot if
  // coach was reassigned). Snapshot wins for scoring; this is for UI.
  clientEndDate: string | null;
  clientStatus: string | null;
}

/**
 * Compute a coach's Client Progress boost (added to their Coach
 * Performance % score). Logic per spec:
 *   - Average of (per-client avg effectiveness) across this coach's
 *     submitting clients
 *   - Divide by 10 to convert 0-100 score → 0-10 percentage points
 *   - Coach with zero submissions = 0 boost (no penalty, no credit)
 */
export function computeCoachProgressBoost(
  coachName: string,
  submissions: CheckInSubmissionRow[]
): { boostPct: number; avgScore: number; clientCount: number; submissionCount: number } {
  const coachSubs = submissions.filter((s) => s.coachName === coachName);
  if (coachSubs.length === 0) {
    return { boostPct: 0, avgScore: 0, clientCount: 0, submissionCount: 0 };
  }

  // Group by client → per-client avg → average those (so a client with
  // 10 submissions doesn't dominate a client with 1).
  const byClient = new Map<string, number[]>();
  for (const s of coachSubs) {
    const key = s.clientId ? `id:${s.clientId}` : `name:${s.clientName}`;
    const arr = byClient.get(key) ?? [];
    arr.push(s.score0to100);
    byClient.set(key, arr);
  }
  const perClientAvg = Array.from(byClient.values()).map(
    (scores) => scores.reduce((a, b) => a + b, 0) / scores.length
  );
  const overallAvg =
    perClientAvg.reduce((a, b) => a + b, 0) / perClientAvg.length;

  return {
    boostPct: Math.round(overallAvg / 10), // 0-100 score → 0-10 boost points
    avgScore: Math.round(overallAvg),
    clientCount: byClient.size,
    submissionCount: coachSubs.length,
  };
}

/**
 * Program Effectiveness Score computation. Stored in the row at insert
 * so admin reads never have to recalculate.
 *
 * Formula: round( (q1 + q2 + q3 + q4) / 4 * 10 )  →  integer 0..100
 *
 * Examples:
 *   (10, 10, 10, 10) → 100
 *   (6, 8, 7, 9)     → 75
 *   (5, 5, 5, 5)     → 50
 *   (0, 1, 1, 1)     → 8  (rounds from 7.5)
 */
export function computeScore0to100(
  q1: number,
  q2: number,
  q3: number,
  q4: number
): number {
  const avg = (q1 + q2 + q3 + q4) / 4; // 0..10 scale
  return Math.round(avg * 10); // 0..100
}

export const LOW_SCORE_ALERT_THRESHOLD = 50;
