import { getServiceSupabase } from "@/lib/supabase";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const MANYCHAT_SOURCE = "manychat dm sync";

interface ManychatContactLinkRow {
  subscriber_id: string;
  client: string;
  ghl_contact_id: string;
}

interface GhlSearchContact {
  id: string;
  source?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  dateAdded?: string | null;
  tags?: string[] | null;
  customFields?: Array<{ id?: string; value?: string | null }> | null;
  attributionSource?: {
    medium?: string | null;
    sessionSource?: string | null;
  } | null;
}

function getHeaders(): Record<string, string> {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) throw new Error("GHL_API_KEY not configured");

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Version: GHL_VERSION,
  };
}

function getLocationId(): string {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) throw new Error("GHL_LOCATION_ID not configured");
  return locationId;
}

async function ghlFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: {
      ...getHeaders(),
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL request failed (${res.status}) ${path}: ${text}`);
  }

  return res.json() as Promise<T>;
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/^@/, "") || "";
}

function normalizeName(value: string | null | undefined): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function buildFullName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function minutesBetween(a?: string | null, b?: string | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const timeA = new Date(a).getTime();
  const timeB = new Date(b).getTime();
  if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) return Number.POSITIVE_INFINITY;
  return Math.abs(timeA - timeB) / 60000;
}

async function searchContacts(query: string): Promise<GhlSearchContact[]> {
  const response = await ghlFetch<{ contacts?: GhlSearchContact[] }>("/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      locationId: getLocationId(),
      pageLimit: 25,
      query,
    }),
  });

  return response.contacts || [];
}

async function fetchGhlContact(contactId: string): Promise<GhlSearchContact | null> {
  const response = await ghlFetch<{ contact?: GhlSearchContact }>(`/contacts/${contactId}`);
  return response.contact || null;
}

async function getContactLinkByGhlContactId(contactId: string): Promise<ManychatContactLinkRow | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("manychat_contact_links")
    .select("subscriber_id, client, ghl_contact_id")
    .eq("ghl_contact_id", contactId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load contact link: ${error.message}`);
  }

  return data;
}

async function getContactLinksByGhlContactIds(contactIds: string[]): Promise<ManychatContactLinkRow[]> {
  if (contactIds.length === 0) return [];

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("manychat_contact_links")
    .select("subscriber_id, client, ghl_contact_id")
    .in("ghl_contact_id", contactIds);

  if (error) {
    throw new Error(`Failed to load candidate contact links: ${error.message}`);
  }

  return data || [];
}

async function saveContactLink(client: string, subscriberId: string, contactId: string) {
  const sb = getServiceSupabase();
  const { error } = await sb.from("manychat_contact_links").upsert(
    {
      client,
      subscriber_id: subscriberId,
      ghl_contact_id: contactId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client,subscriber_id" },
  );

  if (error) {
    throw new Error(`Failed to save contact link: ${error.message}`);
  }
}

function uniqueQueries(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function parseSubscriberIdFromCustomFields(contact: GhlSearchContact): string | null {
  const values = (contact.customFields || [])
    .map((field) => field?.value?.trim())
    .filter((value): value is string => Boolean(value));

  return values.find((value) => /^\d{6,}$/.test(value)) || null;
}

function parseClientFromTags(contact: GhlSearchContact): string | null {
  const tags = (contact.tags || []).map((tag) => normalizeText(tag));
  if (tags.includes("client_tyson_sonnek")) return "tyson_sonnek";
  if (tags.includes("client_keith_holland")) return "keith_holland";
  if (tags.includes("client_zoe_and_emily")) return "zoe_and_emily";
  return null;
}

async function getSearchPoolForIdentity(identity: {
  firstName?: string | null;
  lastName?: string | null;
  instagramHandle?: string | null;
}) {
  const fullName = buildFullName(identity.firstName, identity.lastName);
  const queries = uniqueQueries([
    identity.instagramHandle?.replace(/^@/, ""),
    fullName,
    identity.firstName,
  ]);

  const results = new Map<string, GhlSearchContact>();
  for (const query of queries) {
    const contacts = await searchContacts(query);
    for (const contact of contacts) {
      results.set(contact.id, contact);
    }
  }

  return [...results.values()];
}

function scoreExistingInstagramContact(
  candidate: GhlSearchContact,
  identity: {
    firstName?: string | null;
    lastName?: string | null;
    eventAt?: string | null;
  },
): number {
  let score = 0;
  const source = normalizeText(candidate.source);
  const medium = normalizeText(candidate.attributionSource?.medium);
  const candidateFirst = normalizeName(candidate.firstName);
  const candidateLast = normalizeName(candidate.lastName);
  const candidateName = normalizeName(candidate.contactName);
  const targetFirst = normalizeName(identity.firstName);
  const targetLast = normalizeName(identity.lastName);
  const targetFull = normalizeName(buildFullName(identity.firstName, identity.lastName));

  if (source && source !== MANYCHAT_SOURCE) score += 60;
  if (source === MANYCHAT_SOURCE) score -= 100;
  if (medium === "instagram") score += 50;
  if (candidateFirst && candidateFirst === targetFirst) score += 30;
  if (targetLast && candidateLast && candidateLast === targetLast) score += 20;
  if (targetFull && candidateName === targetFull) score += 20;
  if (targetFull && candidateName && (candidateName.includes(targetFull) || targetFull.includes(candidateName))) {
    score += 10;
  }

  const ageMinutes = minutesBetween(candidate.dateAdded || null, identity.eventAt || null);
  if (ageMinutes <= 2) score += 40;
  else if (ageMinutes <= 10) score += 25;
  else if (ageMinutes <= 60) score += 10;

  return score;
}

function scoreManychatManagedContact(
  candidate: GhlSearchContact,
  identity: {
    firstName?: string | null;
    lastName?: string | null;
    dateAdded?: string | null;
  },
): number {
  let score = 0;
  const source = normalizeText(candidate.source);
  const candidateFirst = normalizeName(candidate.firstName);
  const candidateLast = normalizeName(candidate.lastName);
  const candidateName = normalizeName(candidate.contactName);
  const targetFirst = normalizeName(identity.firstName);
  const targetLast = normalizeName(identity.lastName);
  const targetFull = normalizeName(buildFullName(identity.firstName, identity.lastName));

  if (source === MANYCHAT_SOURCE) score += 80;
  if (candidateFirst && candidateFirst === targetFirst) score += 25;
  if (targetLast && candidateLast && candidateLast === targetLast) score += 20;
  if (targetFull && candidateName === targetFull) score += 20;

  const ageMinutes = minutesBetween(candidate.dateAdded || null, identity.dateAdded || null);
  if (ageMinutes <= 2) score += 40;
  else if (ageMinutes <= 10) score += 25;
  else if (ageMinutes <= 60) score += 10;

  return score;
}

export async function findExistingInstagramContactIdForManychatLead(identity: {
  firstName?: string | null;
  lastName?: string | null;
  instagramHandle?: string | null;
  eventAt?: string | null;
}): Promise<string | null> {
  const pool = await getSearchPoolForIdentity(identity);
  let best: { id: string; score: number } | null = null;

  for (const candidate of pool) {
    const score = scoreExistingInstagramContact(candidate, identity);
    if (score < 70) continue;
    if (!best || score > best.score) {
      best = { id: candidate.id, score };
    }
  }

  return best?.id || null;
}

export async function reconcileConversationContactLink(
  contactId: string,
): Promise<ManychatContactLinkRow | null> {
  const direct = await getContactLinkByGhlContactId(contactId);
  if (direct) return direct;

  const currentContact = await fetchGhlContact(contactId);
  if (!currentContact) return null;

  const pool = await getSearchPoolForIdentity({
    firstName: currentContact.firstName,
    lastName: currentContact.lastName,
  });

  const managedCandidates = pool
    .filter((candidate) => candidate.id !== contactId)
    .map((candidate) => ({
      contact: candidate,
      score: scoreManychatManagedContact(candidate, {
        firstName: currentContact.firstName,
        lastName: currentContact.lastName,
        dateAdded: currentContact.dateAdded || null,
      }),
    }))
    .filter((candidate) => candidate.score >= 80)
    .sort((a, b) => b.score - a.score);

  const candidateLinks = await getContactLinksByGhlContactIds(
    managedCandidates.map((candidate) => candidate.contact.id),
  );

  const linkByContactId = new Map(candidateLinks.map((link) => [link.ghl_contact_id, link]));
  const bestLinkedCandidate = managedCandidates.find((candidate) =>
    linkByContactId.has(candidate.contact.id),
  );

  if (!bestLinkedCandidate) return null;

  const matchedLink = linkByContactId.get(bestLinkedCandidate.contact.id);
  if (matchedLink) {
    await saveContactLink(matchedLink.client, matchedLink.subscriber_id, contactId);
    return {
      ...matchedLink,
      ghl_contact_id: contactId,
    };
  }

  const subscriberId = parseSubscriberIdFromCustomFields(bestLinkedCandidate.contact);
  const client = parseClientFromTags(bestLinkedCandidate.contact);
  if (!subscriberId || !client) return null;

  await saveContactLink(client, subscriberId, contactId);
  return {
    client,
    subscriber_id: subscriberId,
    ghl_contact_id: contactId,
  };
}
