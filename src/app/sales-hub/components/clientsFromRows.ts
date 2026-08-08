import { creatorKeyFromText } from "@/lib/creators";

// ─────────────────────────────────────────────────────────────────────────
// Timeline-driven client derivation — the sales tracker is the source of
// truth for WHICH clients exist in a given date range. Whatever offers appear
// on rows in the selected timeline are the clients the Sales Hub shows, so
// the roster updates itself when clients join or leave (no hardcoded lists).
//
// Keys: when the offer resolves to a known creator (creators.ts matchTokens,
// e.g. "Tyson Sonnek" → "tyson", "Jake Divijak" → "jake"), we use that short
// key so DM-side endpoints (response times, ManyChat metrics) line up. For
// anything else the normalized lowercase offer text is the key — sheet-data's
// fuzzy `offer.includes(client)` matching handles those too.
// ─────────────────────────────────────────────────────────────────────────

interface OfferRowLike {
  offer: string;
}

export interface DerivedClient {
  key: string;
  name: string;
  count: number;
}

export function clientsFromRows(rows: OfferRowLike[]): DerivedClient[] {
  const groups = new Map<string, { count: number; casings: Map<string, number> }>();

  for (const row of rows) {
    const raw = (row.offer || "").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const key = creatorKeyFromText(raw) ?? raw.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { count: 0, casings: new Map() };
      groups.set(key, group);
    }
    group.count += 1;
    group.casings.set(raw, (group.casings.get(raw) || 0) + 1);
  }

  return [...groups.entries()]
    .map(([key, g]) => {
      // Display the offer exactly as the tracker most often writes it.
      const name = [...g.casings.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { key, name, count: g.count };
    })
    .sort((a, b) => b.count - a.count);
}

/** Does this tracker row belong to the derived client key? */
export function rowMatchesClientKey(row: OfferRowLike, key: string): boolean {
  const raw = (row.offer || "").replace(/\s+/g, " ").trim();
  if (!raw) return false;
  const creator = creatorKeyFromText(raw);
  if (creator) return creator === key;
  return raw.toLowerCase().includes(key);
}
