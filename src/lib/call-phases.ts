// The six phases of the closer script, in call order. Shared by the review
// prompt (call-review-format.ts), the Slack/PDF post, the Deal Analysis API and
// the page, so a phase can never be named two ways. No imports on purpose: the
// client bundle pulls this in.

export const CALL_PHASES = [
  { key: "agenda", name: "Agenda set", short: "Agenda" },
  { key: "discovery", name: "Discovery", short: "Discovery" },
  { key: "problem_label", name: "Problem label", short: "Label" },
  { key: "transition", name: "Transition", short: "Transition" },
  { key: "pitch", name: "Pitch", short: "Pitch" },
  { key: "close", name: "Close", short: "Close" },
] as const;

export type PhaseKey = (typeof CALL_PHASES)[number]["key"];

export interface PhaseResult {
  key: PhaseKey;
  name: string;
  short: string;
  score: number | null;
  ran: boolean;
  startedAt: string | null; // "mm:ss" into the recording
  minutes: number | null; // how long the phase ran
  whatHappened: string | null;
  fix: string | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Normalize Jeremy's `phases` footer (any order, any gaps) into the six
 *  script phases in call order. Missing phases come back with null scores. */
export function phaseResults(fields: unknown): PhaseResult[] {
  const f = (fields && typeof fields === "object" ? fields : {}) as { phases?: unknown };
  const raw = Array.isArray(f.phases) ? (f.phases as Record<string, unknown>[]) : [];
  return CALL_PHASES.map((p) => {
    const hit = raw.find((r) => String(r?.key || "").toLowerCase() === p.key);
    return {
      key: p.key,
      name: p.name,
      short: p.short,
      score: hit ? num(hit.score) : null,
      ran: hit ? hit.ran !== false : false,
      startedAt: hit ? str(hit.started_at) : null,
      minutes: hit && typeof hit.minutes === "number" && Number.isFinite(hit.minutes) ? Math.round(hit.minutes * 10) / 10 : null,
      whatHappened: hit ? str(hit.what_happened) : null,
      fix: hit ? str(hit.fix) : null,
    };
  });
}

/** True when at least one phase carries a score: the review used the
 *  phase-breakdown format (reviews before 2026-09-20 did not). */
export function hasPhases(fields: unknown): boolean {
  return phaseResults(fields).some((p) => p.score != null);
}
