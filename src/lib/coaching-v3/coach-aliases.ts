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
  "stephanie hughes":            "Stef",
  "martin iliev":                "Martin",
  "kevin khalid":                "Kevin",
  "waleed ahmed":                "Waleed",
  "ahmad saeed":                 "Ahmad",
  // Confirmed by MAS 2026-09-15: two Everfit owner names that don't share
  // a first name with their CCOS coach. Also confirmed the Sales Tracker
  // sheet uses the short forms "Mark" / "Shaun" for the same people, so
  // both spellings resolve to CCOS's canonical name.
  "mark":                        "Farrukh",
  "mark smith":                  "Farrukh",
  "shaun":                       "Shiraad",
  "shaun lundall":               "Shiraad",
  // Sheet tab uses "STEPH" for CCOS's "Stef".
  "steph":                       "Stef",
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
