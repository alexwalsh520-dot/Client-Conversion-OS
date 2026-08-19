// Display-only coach name aliases for the Sunday weekly reports.
//
// Farrukh now officially goes by Mark. The database still stores
// "Farrukh" as coach_name on clients, coach_meetings and
// client_check_ins, and every other surface (Coaching Hub, Client
// Roster, Client Progress) keeps reading the stored value. This maps
// the name at render time, in the weekly digest only, so no historical
// data is rewritten and nothing else in the app shifts.
//
// Add future aliases here as lowercase stored-name keys.

const COACH_DISPLAY_ALIASES: Record<string, string> = {
  farrukh: "Mark",
};

/**
 * Map a stored coach_name to the name that should be shown in the
 * weekly reports. Returns null for a missing coach so callers can pick
 * their own fallback wording.
 */
export function displayCoachName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return COACH_DISPLAY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}
