// Person identity resolution — unifies ManyChat subscribers and GHL contacts into
// ONE person, using only deterministic links (shared subscriber_id / contact_id) plus
// EXACT, UNIQUE full-name matches. Never fuzzy-guesses: a name that maps to more than
// one identity is discarded rather than risk merging two different people.

import type { getServiceSupabase } from "@/lib/supabase";

type SB = ReturnType<typeof getServiceSupabase>;

/** Normalize a display name for matching. Returns null for anything unsafe to match on. */
export function normName(v: unknown): string | null {
  if (!v) return null;
  // Reject ManyChat merge-field placeholders ("{{first_name}} {{last_name}}") — 512+ people
  // share these, so name-matching on them merges strangers. Drop before normalizing.
  if (String(v).includes("{") || String(v).includes("}")) return null;
  const n = String(v)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (n.length < 4) return null; // too short / generic
  if (!n.includes(" ")) return null; // require first + last name to avoid single-name collisions
  return n;
}

export type IdMaps = {
  subByContact: Map<string, string>; // contact_id -> subscriber_id (unique)
  subByName: Map<string, string>; // name -> subscriber_id (unique)
  contactByName: Map<string, string>; // name -> contact_id (unique)
};

/** Collapse a candidate multimap to only the keys that map to exactly one distinct value. */
function unique(multi: Map<string, Set<string>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, set] of multi) if (set.size === 1) out.set(k, [...set][0]);
  return out;
}

async function pageAll(
  sb: SB,
  table: string,
  cols: string,
  onRow: (row: Record<string, unknown>) => void,
): Promise<void> {
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data } = await sb.from(table).select(cols).range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const r of data) onRow(r as unknown as Record<string, unknown>);
    if (data.length < PAGE) break;
    from += PAGE;
  }
}

/** Build the identity maps from the two tables that carry real cross-system links. */
export async function buildIdMaps(sb: SB): Promise<IdMaps> {
  const subByContact = new Map<string, Set<string>>();
  const subByName = new Map<string, Set<string>>();
  const contactByName = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string | null, v: string | null) => {
    if (!k || !v) return;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(v);
  };

  // ads_keyword_events carries subscriber_id alongside contact_id + names.
  await pageAll(
    sb,
    "ads_keyword_events",
    "subscriber_id, contact_id, subscriber_name, contact_name",
    (r) => {
      const sub = r.subscriber_id ? String(r.subscriber_id) : null;
      const contact = r.contact_id ? String(r.contact_id) : null;
      const name = normName((r.subscriber_name as string) ?? (r.contact_name as string));
      add(subByContact, contact, sub);
      add(subByName, name, sub);
    },
  );

  // ghl_appointments gives name -> contact_id (the booking system's own identity).
  await pageAll(sb, "ghl_appointments", "contact_id, contact_name", (r) => {
    const contact = r.contact_id ? String(r.contact_id) : null;
    const name = normName(r.contact_name as string);
    add(contactByName, name, contact);
  });

  return {
    subByContact: unique(subByContact),
    subByName: unique(subByName),
    contactByName: unique(contactByName),
  };
}

export type EvIdentity = {
  subscriber_id?: unknown;
  contact_id?: unknown;
  display_name?: unknown;
};

/**
 * Resolve one event to a canonical person key + how it was linked.
 * Priority: ManyChat subscriber (direct → via contact → via unique name),
 * then GHL contact (direct → via unique name), then the name itself.
 */
export function personKey(ev: EvIdentity, maps: IdMaps): { key: string | null; via: string | null } {
  const nm = normName(ev.display_name);

  // 1) resolve to a ManyChat subscriber if we can
  let sub = ev.subscriber_id ? String(ev.subscriber_id) : null;
  let subVia: string | null = sub ? "subscriber" : null;
  if (!sub && ev.contact_id) {
    const s = maps.subByContact.get(String(ev.contact_id));
    if (s) { sub = s; subVia = "contact"; }
  }
  if (!sub && nm) {
    const s = maps.subByName.get(nm);
    if (s) { sub = s; subVia = "name"; }
  }
  if (sub) return { key: `sub:${sub}`, via: subVia };

  // 2) otherwise resolve to a GHL contact
  let contact = ev.contact_id ? String(ev.contact_id) : null;
  let cVia: string | null = contact ? "contact" : null;
  if (!contact && nm) {
    const c = maps.contactByName.get(nm);
    if (c) { contact = c; cVia = "name"; }
  }
  if (contact) return { key: `ghl:${contact}`, via: cVia };

  // 3) last resort: the (safe, multi-token) name itself
  if (nm) return { key: `name:${nm}`, via: "name" };

  return { key: null, via: null };
}
