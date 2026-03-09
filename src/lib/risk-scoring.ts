// No-show risk scoring engine for the Sales Manager Hub
// Computes a 0-100 risk score based on multiple weighted signals
// Used to predict which booked calls are likely to no-show

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskSignal {
  name: string;
  score: number; // 0-100 contribution to total
  maxScore: number; // maximum possible for this signal
  detail: string; // human-readable explanation
}

export interface RiskAssessment {
  totalScore: number; // 0-100
  category: "low" | "medium" | "high";
  signals: RiskSignal[];
}

export interface LeadData {
  bookingDate: string; // when they booked (ISO date or parseable string)
  callDate: string; // when the call is scheduled (ISO date)
  callTime: string; // time of day (e.g., "09:00", "14:30")
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  hasRescheduled: boolean; // whether they've rescheduled before
  dmEngagementTags: number; // number of engagement tags from DMs
  emailOpened: boolean | null; // null = unknown / not tracked
  textResponded: boolean | null; // null = unknown (SendBlue not connected)
}

// ---------------------------------------------------------------------------
// Scoring weights (max points per signal)
// ---------------------------------------------------------------------------

const WEIGHTS = {
  DM_ENGAGEMENT: 20,
  EMAIL_OPENS: 20,
  TEXT_RESPONSE: 20,
  BOOKING_GAP: 15,
  TIME_OF_DAY: 10,
  DAY_OF_WEEK: 5,
  RESCHEDULED: 10,
} as const;

// ---------------------------------------------------------------------------
// Individual signal scorers
// ---------------------------------------------------------------------------

/**
 * DM Engagement Quality (20pts max)
 * Fewer engagement tags = higher risk
 */
function scoreDmEngagement(tags: number): RiskSignal {
  const max = WEIGHTS.DM_ENGAGEMENT;
  let score: number;
  let detail: string;

  if (tags >= 5) {
    score = 0;
    detail = `${tags} engagement tags — strong DM engagement`;
  } else if (tags >= 3) {
    score = Math.round(max * 0.25);
    detail = `${tags} engagement tags — moderate DM engagement`;
  } else if (tags >= 1) {
    score = Math.round(max * 0.6);
    detail = `${tags} engagement tag(s) — low DM engagement`;
  } else {
    score = max;
    detail = "No engagement tags — minimal DM interaction";
  }

  return { name: "DM Engagement", score, maxScore: max, detail };
}

/**
 * Pre-call Email Opens (20pts max)
 * No opens = high risk. null = unknown, gets a partial score.
 */
function scoreEmailOpens(opened: boolean | null): RiskSignal {
  const max = WEIGHTS.EMAIL_OPENS;
  let score: number;
  let detail: string;

  if (opened === null) {
    // Unknown — assign partial risk
    score = Math.round(max * 0.5);
    detail = "Email open status unknown — partial risk applied";
  } else if (opened) {
    score = 0;
    detail = "Pre-call email opened — lead is engaged";
  } else {
    score = max;
    detail = "Pre-call email not opened — lead may not be engaged";
  }

  return { name: "Email Opens", score, maxScore: max, detail };
}

/**
 * SendBlue Text Response (20pts max)
 * No response = higher risk. null = SendBlue not connected, partial score.
 */
function scoreTextResponse(responded: boolean | null): RiskSignal {
  const max = WEIGHTS.TEXT_RESPONSE;
  let score: number;
  let detail: string;

  if (responded === null) {
    // SendBlue not connected — assign partial risk with explanatory detail
    score = Math.round(max * 0.5);
    detail = "SendBlue not connected — text response status unknown";
  } else if (responded) {
    score = 0;
    detail = "Lead responded to text — confirmed engagement";
  } else {
    score = max;
    detail = "No text response — lead has not engaged via SMS";
  }

  return { name: "Text Response", score, maxScore: max, detail };
}

/**
 * Booking-to-Call Gap (15pts max)
 * Same day = low risk, >48h = increasing, >72h = high risk
 */
function scoreBookingGap(bookingDate: string, callDate: string): RiskSignal {
  const max = WEIGHTS.BOOKING_GAP;

  const booking = new Date(bookingDate);
  const call = new Date(callDate);

  // Guard against invalid dates
  if (isNaN(booking.getTime()) || isNaN(call.getTime())) {
    return {
      name: "Booking Gap",
      score: Math.round(max * 0.5),
      maxScore: max,
      detail: "Could not parse booking/call dates — partial risk applied",
    };
  }

  const diffMs = call.getTime() - booking.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  let score: number;
  let detail: string;

  if (diffHours <= 24) {
    score = 0;
    detail = `Same-day or next-day booking (${Math.round(diffHours)}h gap) — low risk`;
  } else if (diffHours <= 48) {
    score = Math.round(max * 0.2);
    detail = `${Math.round(diffHours)}h gap between booking and call — slight risk`;
  } else if (diffHours <= 72) {
    score = Math.round(max * 0.6);
    detail = `${Math.round(diffHours)}h gap — moderate risk, momentum may fade`;
  } else if (diffHours <= 120) {
    score = Math.round(max * 0.8);
    detail = `${Math.round(diffHours)}h gap — elevated risk, consider re-engagement`;
  } else {
    score = max;
    detail = `${Math.round(diffHours)}h gap (${Math.round(diffHours / 24)} days) — high risk, lead likely cooling off`;
  }

  return { name: "Booking Gap", score, maxScore: max, detail };
}

/**
 * Time of Day (10pts max)
 * Early morning (<8am) and late evening (>7pm) are higher risk
 */
function scoreTimeOfDay(callTime: string): RiskSignal {
  const max = WEIGHTS.TIME_OF_DAY;

  // Parse hour from time string like "09:00", "14:30", "9:00 AM"
  let hour: number;
  const timeMatch = callTime.match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10);
    // Handle AM/PM
    const lower = callTime.toLowerCase();
    if (lower.includes("pm") && hour < 12) hour += 12;
    if (lower.includes("am") && hour === 12) hour = 0;
  } else {
    // Can't parse — assign small partial risk
    return {
      name: "Time of Day",
      score: Math.round(max * 0.3),
      maxScore: max,
      detail: `Could not parse call time "${callTime}" — small risk applied`,
    };
  }

  let score: number;
  let detail: string;

  if (hour < 8) {
    score = max;
    detail = `Early morning call (${callTime}) — higher no-show risk`;
  } else if (hour >= 19) {
    score = Math.round(max * 0.8);
    detail = `Late evening call (${callTime}) — elevated no-show risk`;
  } else if (hour >= 9 && hour <= 17) {
    score = 0;
    detail = `Business hours call (${callTime}) — normal risk`;
  } else {
    // 8-9am or 5-7pm — slight risk
    score = Math.round(max * 0.3);
    detail = `Edge-of-business-hours call (${callTime}) — slight risk`;
  }

  return { name: "Time of Day", score, maxScore: max, detail };
}

/**
 * Day of Week (5pts max)
 * Monday and Friday are higher risk days for no-shows
 */
function scoreDayOfWeek(dayOfWeek: number): RiskSignal {
  const max = WEIGHTS.DAY_OF_WEEK;
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const dayName = dayNames[dayOfWeek] || "Unknown";

  let score: number;
  let detail: string;

  switch (dayOfWeek) {
    case 1: // Monday
      score = max;
      detail = `${dayName} — highest no-show risk day`;
      break;
    case 5: // Friday
      score = Math.round(max * 0.8);
      detail = `${dayName} — elevated no-show risk`;
      break;
    case 0: // Sunday
    case 6: // Saturday
      score = Math.round(max * 0.4);
      detail = `${dayName} — weekend call, moderate risk`;
      break;
    default: // Tue-Thu
      score = 0;
      detail = `${dayName} — mid-week, lowest no-show risk`;
      break;
  }

  return { name: "Day of Week", score, maxScore: max, detail };
}

/**
 * Rescheduled Before (10pts max)
 * If the lead has already rescheduled, risk is higher
 */
function scoreRescheduled(hasRescheduled: boolean): RiskSignal {
  const max = WEIGHTS.RESCHEDULED;

  if (hasRescheduled) {
    return {
      name: "Rescheduled",
      score: max,
      maxScore: max,
      detail: "Lead has rescheduled before — higher no-show probability",
    };
  }

  return {
    name: "Rescheduled",
    score: 0,
    maxScore: max,
    detail: "No prior reschedules — good sign",
  };
}

// ---------------------------------------------------------------------------
// Category assignment
// ---------------------------------------------------------------------------

function getCategory(score: number): "low" | "medium" | "high" {
  if (score <= 30) return "low";
  if (score <= 60) return "medium";
  return "high";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the no-show risk score for a lead.
 *
 * Evaluates 7 weighted signals and produces a total score from 0-100:
 *   - 0-30:  LOW risk (green)
 *   - 31-60: MEDIUM risk (yellow)
 *   - 61-100: HIGH risk (red)
 *
 * @param lead - Lead data containing booking info and engagement signals
 * @returns RiskAssessment with total score, category, and individual signal breakdowns
 */
export function computeRiskScore(lead: LeadData): RiskAssessment {
  const signals: RiskSignal[] = [
    scoreDmEngagement(lead.dmEngagementTags),
    scoreEmailOpens(lead.emailOpened),
    scoreTextResponse(lead.textResponded),
    scoreBookingGap(lead.bookingDate, lead.callDate),
    scoreTimeOfDay(lead.callTime),
    scoreDayOfWeek(lead.dayOfWeek),
    scoreRescheduled(lead.hasRescheduled),
  ];

  const totalScore = signals.reduce((sum, s) => sum + s.score, 0);

  // Clamp to 0-100 range (should already be within, but defensive)
  const clampedScore = Math.min(100, Math.max(0, totalScore));

  return {
    totalScore: clampedScore,
    category: getCategory(clampedScore),
    signals,
  };
}
