// Coach identity resolver for the auto meal-plan pipeline.
//
// Coaches have an internal name (used in CCOS / `clients.coach_name`)
// and an on-plan alias (printed on the PDF the client receives). Two
// coaches use aliases:
//   - Farrukh on plan reads as "Mark"
//   - Shiraad on plan reads as "Shaun"
//
// Everyone else (Stef, Belkys, Waleed) uses their internal name on
// the plan.
//
// For the Slack ship step we ALSO need to resolve a coach to a Slack
// user (so we can @mention them). Slack user IDs are looked up by
// email via the existing coaching-bot helper; the email mapping
// lives here so a coach rename only touches this one file.

export interface CoachIdentity {
  /** Internal CCOS name. Matches values in clients.coach_name. */
  internal: string;
  /** Name printed on the client-facing meal plan PDF. */
  onPlanAlias: string;
  /** Email used to look up the coach's Slack user ID for @mentions. */
  email: string;
}

/**
 * Source-of-truth roster. Keys are lowercased internal names so
 * lookups are case-insensitive and tolerant of spelling variants
 * (e.g. "Stefanie" vs "Stef" — those are also normalized upstream
 * in src/app/api/coaching/route.ts).
 */
const COACHES: Record<string, CoachIdentity> = {
  farrukh: {
    internal: "Farrukh",
    onPlanAlias: "Mark",
    email: "ahmedfarrukh2007@gmail.com",
  },
  shiraad: {
    internal: "Shiraad",
    onPlanAlias: "Shaun",
    email: "shirradlundall@gmail.com",
  },
  stef: {
    internal: "Stef",
    onPlanAlias: "Stef",
    email: "stefhughes.pt@gmail.com",
  },
  belkys: {
    internal: "Belkys",
    onPlanAlias: "Belkys",
    email: "Belkys.Barrios.Anamey@gmail.com",
  },
  waleed: {
    internal: "Waleed",
    onPlanAlias: "Waleed",
    email: "waleed.261998@gmail.com",
  },
};

/**
 * Resolve an internal coach name (or anything close to one) to the
 * canonical CoachIdentity. Returns null when the name doesn't match
 * any known coach — caller should decide whether to fail closed or
 * proceed without a coach line.
 */
export function resolveCoach(internalName: string | null | undefined): CoachIdentity | null {
  if (!internalName) return null;
  const key = internalName.trim().toLowerCase();
  return COACHES[key] ?? null;
}

/** Convenience: alias only. Falls back to the input if unknown. */
export function coachAlias(internalName: string | null | undefined): string {
  const c = resolveCoach(internalName);
  return c?.onPlanAlias ?? (internalName ?? "(unassigned)");
}

/** Convenience: email only. Returns null when the coach is unknown. */
export function coachEmail(internalName: string | null | undefined): string | null {
  return resolveCoach(internalName)?.email ?? null;
}

/** Internal-name list for diagnostics + admin UI. */
export function listKnownCoaches(): CoachIdentity[] {
  return Object.values(COACHES);
}
