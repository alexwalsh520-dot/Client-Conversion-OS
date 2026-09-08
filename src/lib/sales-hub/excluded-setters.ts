// Setters removed from every Sales Hub surface (owner request). Their
// underlying events still count toward TEAM totals — they just never get a
// per-setter row, leaderboard entry, or roster seat. Leads still attributed
// to them upstream (e.g. ManyChat flows that keep firing with their name)
// fold into "Unassigned" where a bucket is needed.
//
// Erin removed 2026-09-08: no longer a setter, but her ManyChat flows still
// send setter_name=erin until the flows themselves are edited.
export const EXCLUDED_SETTER_KEYS = new Set(["erin"]);

export function isExcludedSetter(nameOrKey: string | null | undefined): boolean {
  if (!nameOrKey) return false;
  return EXCLUDED_SETTER_KEYS.has(nameOrKey.trim().toLowerCase());
}
