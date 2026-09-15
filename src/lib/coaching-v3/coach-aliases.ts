// Coach name aliases for the Coaching V3 Everfit sync.
//
// The V3 JSON reports each client's coach using the Everfit "owner" name,
// which is typically a full name (e.g. "Stephanie Hughes"). CCOS's own
// clients.coach_name column uses the internal first name (e.g. "Stef").
// Without this map, the (coach + name) match in the sync ingest never
// fires and every row falls back to the weaker unique-name match — that
// leaves clients whose name collides across coaches unlinked.
//
// Order of resolution:
//   1. Exact case-insensitive match on this map's keys.
//   2. Otherwise return the incoming value unchanged.
//
// Add new aliases by extending the map. Comments below carry the CCOS
// count at time of writing so future readers know which side is which.

const CANONICAL: Record<string, string> = {
  // Everfit owner name       -> CCOS coach_name (internal)
  "stephanie hughes":            "Stef",     // 46 on Everfit / 51 active in CCOS
  "martin iliev":                "Martin",
  "kevin khalid":                "Kevin",
  "waleed ahmed":                "Waleed",
  "ahmad saeed":                 "Ahmad",
  // Left intentionally without a map (owner name doesn't cleanly map to a
  // single CCOS coach — the sync will still link most rows via unique-name):
  //   "mark smith"    (67 rows) — verify with MAS which CCOS coach owns these
  //   "shaun lundall" (42 rows) — verify with MAS which CCOS coach owns these
};

const HAY = new Set(Object.keys(CANONICAL));

/** Case- and whitespace-insensitive canonicalizer. */
export function canonicalCoachName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  if (HAY.has(key)) return CANONICAL[key];
  return raw.trim();
}
