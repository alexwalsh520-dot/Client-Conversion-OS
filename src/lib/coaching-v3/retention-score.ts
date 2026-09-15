// Retention probability heuristic (MAS-signed-off weighting, 2026-09-15).
//
// A pure 0-100 score from six signals we already have. Not ML — no labeled
// training data yet — so this is deliberately explicit: every point can be
// traced to a signal, and the top-weighted reasons come back out for the UI.
//
// Weighting (must sum to 100):
//   30  latest check-in score (0-100 direct)
//   25  workout completion last 7 days (completed / assigned)
//   15  coach contact recency (last coach msg OR last meeting)
//   15  client message activity in last 14 days
//   10  days remaining sentiment (positive good, extended a boost)
//    5  prior retention on file (been retained before -> more likely again)
//
// Missing signals contribute 0 to their slot and are called out in reasons.
// The composite score is bucketed for display:
//   >= 70   likely     (green)
//   40-69   coin_flip  (amber)
//   <  40   at_risk    (red)
// If we don't even have a check-in and no workout data, we say "unknown"
// instead of pretending confidence.

import type { RetentionBucket, RetentionScore } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScoreInputs {
  latestCheckInScore: number | null; // 0..100
  workoutsCompleted7d: number | null;
  workoutsAssigned7d: number | null;
  lastCoachContactDaysAgo: number | null; // min(last coach msg, last meeting)
  lastClientMessageDaysAgo: number | null;
  daysRemaining: number | null;
  hasBeenRetainedBefore: boolean;
  hasOpenExtendedCycle: boolean; // client already got a +4/+12 recorded this cycle
}

export function computeRetentionScore(i: ScoreInputs): RetentionScore {
  let total = 0;
  const reasons: { weight: number; text: string }[] = [];

  // 30 — check-in score
  if (i.latestCheckInScore !== null) {
    const pts = 30 * (i.latestCheckInScore / 100);
    total += pts;
    reasons.push({
      weight: pts,
      text: `Check-in ${i.latestCheckInScore}/100 (+${Math.round(pts)})`,
    });
  } else {
    reasons.push({ weight: 0, text: "No check-in on file (+0)" });
  }

  // 25 — workout completion
  if (i.workoutsAssigned7d !== null && i.workoutsAssigned7d > 0) {
    const pct = Math.min(1, (i.workoutsCompleted7d ?? 0) / i.workoutsAssigned7d);
    const pts = 25 * pct;
    total += pts;
    reasons.push({
      weight: pts,
      text: `Workouts ${i.workoutsCompleted7d ?? 0}/${i.workoutsAssigned7d} last 7d (+${Math.round(pts)})`,
    });
  } else {
    reasons.push({ weight: 0, text: "No workouts assigned this week (+0)" });
  }

  // 15 — coach contact recency
  if (i.lastCoachContactDaysAgo !== null) {
    // 100 at 0-3 days, tapers linearly to 0 at 28 days.
    const days = i.lastCoachContactDaysAgo;
    const pctRaw =
      days <= 3 ? 1 : days >= 28 ? 0 : (28 - days) / 25;
    const pts = 15 * pctRaw;
    total += pts;
    reasons.push({
      weight: pts,
      text: `Coach contact ${days}d ago (+${Math.round(pts)})`,
    });
  } else {
    reasons.push({ weight: 0, text: "No coach contact recorded (+0)" });
  }

  // 15 — client message activity
  if (i.lastClientMessageDaysAgo !== null) {
    const days = i.lastClientMessageDaysAgo;
    const pctRaw = days <= 3 ? 1 : days >= 14 ? 0 : (14 - days) / 11;
    const pts = 15 * pctRaw;
    total += pts;
    reasons.push({
      weight: pts,
      text: `Client message ${days}d ago (+${Math.round(pts)})`,
    });
  } else {
    reasons.push({ weight: 0, text: "Client silent (+0)" });
  }

  // 10 — days remaining sentiment
  if (i.daysRemaining !== null) {
    let pts: number;
    let label: string;
    if (i.hasOpenExtendedCycle) {
      pts = 10;
      label = `Already extended (+${Math.round(pts)})`;
    } else if (i.daysRemaining >= 15) {
      pts = 10;
      label = `${i.daysRemaining}d left (+${Math.round(pts)})`;
    } else if (i.daysRemaining >= 0) {
      pts = 6;
      label = `${i.daysRemaining}d left (+${Math.round(pts)})`;
    } else {
      pts = 4;
      label = `${Math.abs(i.daysRemaining)}d past end (+${Math.round(pts)})`;
    }
    total += pts;
    reasons.push({ weight: pts, text: label });
  } else {
    reasons.push({ weight: 0, text: "End date unknown (+0)" });
  }

  // 5 — prior retention on file
  if (i.hasBeenRetainedBefore) {
    total += 5;
    reasons.push({ weight: 5, text: "Retained before (+5)" });
  } else {
    reasons.push({ weight: 0, text: "No prior retention (+0)" });
  }

  const score = Math.round(Math.max(0, Math.min(100, total)));
  const unknownData =
    i.latestCheckInScore === null &&
    i.workoutsAssigned7d === null &&
    i.lastClientMessageDaysAgo === null;

  let bucket: RetentionBucket;
  if (unknownData) bucket = "unknown";
  else if (score >= 70) bucket = "likely";
  else if (score >= 40) bucket = "coin_flip";
  else bucket = "at_risk";

  reasons.sort((a, b) => b.weight - a.weight);
  return {
    score,
    bucket,
    reasons: reasons.map((r) => r.text),
  };
}

/** Convert an ISO timestamp to days-ago (rounded floor), or null. */
export function isoToDaysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}
