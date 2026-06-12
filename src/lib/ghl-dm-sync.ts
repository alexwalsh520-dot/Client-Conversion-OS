import { getServiceSupabase } from "@/lib/supabase";
import { findExistingInstagramContactIdForManychatLead } from "@/lib/dm-contact-linking";
import {
  buildDmFollowupGhlNote,
  buildDmFollowupLinkBundle,
  isFollowupQueueTag,
} from "@/lib/meta-business-suite";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export interface ManychatDmEvent {
  subscriberId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  instagramHandle?: string | null;
  instagramProfileUrl?: string | null;
  manychatInboxUrl?: string | null;
  metaBusinessSuiteUrl?: string | null;
  metaThreadId?: string | null;
  metaAssetId?: string | null;
  metaMailboxId?: string | null;
  metaBusinessId?: string | null;
  tagName: string;
  client: string;
  setterName?: string | null;
  eventAt: string;
}

export type ClientKey = string;

const CLIENT_LABELS: Record<ClientKey, string> = {
  tyson_sonnek: "Tyson Sonnek",
  keith_holland: "Keith Holland",
  lucy_hubbard: "Lucy Hubbard",
  antwan_rarcus: "Antwan Rarcus",
};

const TAG_TO_DATE_FIELD: Record<string, string> = {
  new_lead: "dm_new_lead_at",
  lead_engaged: "dm_lead_engaged_at",
  call_link_sent: "dm_call_link_sent_at",
  sub_link_sent: "dm_sub_link_sent_at",
};

interface CustomFieldDefinition {
  id: string;
  name?: string;
  fieldKey?: string;
  key?: string;
}

interface ContactLinkRow {
  subscriber_id: string;
  client: string;
  ghl_contact_id: string;
}

interface GhlNote {
  id?: string | null;
  _id?: string | null;
  body?: string | null;
  content?: string | null;
  note?: string | null;
}

let cachedFieldIds: Record<string, string> | null = null;

function getHeaders(): Record<string, string> {
  const apiKey =
    process.env.DM_SETTER_GHL_API_KEY?.trim() ||
    process.env.GHL_API_KEY?.trim();
  if (!apiKey) throw new Error("DM_SETTER_GHL_API_KEY or GHL_API_KEY not configured");

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Version: GHL_VERSION,
  };
}

function getLocationId(): string {
  const locationId =
    process.env.DM_SETTER_GHL_LOCATION_ID?.trim() ||
    process.env.GHL_LOCATION_ID?.trim();
  if (!locationId) throw new Error("DM_SETTER_GHL_LOCATION_ID or GHL_LOCATION_ID not configured");
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

async function addContactNote(contactId: string, body: string) {
  await ghlFetch(`/contacts/${contactId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

async function getContactNotes(contactId: string) {
  const response = await ghlFetch<{
    notes?: GhlNote[];
    contactNotes?: GhlNote[];
  }>(`/contacts/${contactId}/notes`);

  return response.notes || response.contactNotes || [];
}

async function deleteContactNote(contactId: string, noteId: string) {
  await ghlFetch(`/contacts/${contactId}/notes/${noteId}`, {
    method: "DELETE",
  });
}

function noteBody(note: GhlNote) {
  return note.body || note.content || note.note || "";
}

function noteId(note: GhlNote) {
  return note.id || note._id || null;
}

function isOldCcosFollowupNote(body: string) {
  return (
    body.includes("CCOS Instagram follow-up links") ||
    body.includes("CCOS_META_INBOX_LINK:")
  );
}

function normalizeTagName(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeSetterKey(value?: string | null): string | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase().replace(/^setter[_:]/, "");

  if (["amara", "amara edwin"].includes(normalized)) return "amara";
  if (["gideon", "gideon adebowale"].includes(normalized)) return "gideon";
  if (["debbie", "debbie nwosu", "deborah", "deb"].includes(normalized)) return "debbie";
  if (["kelechi", "kels", "kel", "kelechi umunna"].includes(normalized)) return "kelechi";

  return normalized;
}

export function normalizeClientKey(raw: string): ClientKey {
  const value = raw.trim().toLowerCase();

  if (["tyson", "tyson_sonnek", "client_tyson_sonnek", "tyson sonnek"].includes(value)) {
    return "tyson_sonnek";
  }
  if (["keith", "keith_holland", "client_keith_holland", "keith holland"].includes(value)) {
    return "keith_holland";
  }
  if (
    [
      "lucy",
      "hubbard",
      "lucy_hubbard",
      "client_lucy_hubbard",
      "lucy hubbard",
      "lucy_h",
    ].includes(value)
  ) {
    return "lucy_hubbard";
  }
  if (
    [
      "antwan",
      "rarcus",
      "antwan_rarcus",
      "client_antwan",
      "client_antwan_rarcus",
      "antwan rarcus",
    ].includes(value)
  ) {
    // Long form to match the rest of the Sales Hub + the Instagram connection
    // (response-times, lead-hours, time-to-eat all query "antwan_rarcus"),
    // exactly like tyson → "tyson_sonnek". The ads path remaps this back to the
    // short "antwan" via creatorKeyFromText(), so ads attribution is unaffected.
    return "antwan_rarcus";
  }

  const slug = value.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!slug) throw new Error(`Unsupported client value: ${raw}`);
  return slug;
}

export function getClientLabel(clientKey: ClientKey): string {
  const label = CLIENT_LABELS[clientKey];
  if (label) return label;

  return clientKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildDisplayName(event: ManychatDmEvent): { firstName: string; lastName?: string } {
  const firstName = event.firstName?.trim();
  const lastName = event.lastName?.trim();
  const handle = event.instagramHandle?.trim()?.replace(/^@/, "");

  if (firstName) {
    return { firstName, lastName: lastName || undefined };
  }

  if (handle) {
    return { firstName: handle };
  }

  return { firstName: "Instagram Lead", lastName: event.subscriberId.slice(-6) };
}

function toDateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map((value) => value.trim()))];
}

async function getCustomFieldIds(): Promise<Record<string, string>> {
  if (cachedFieldIds) return cachedFieldIds;

  const locationId = getLocationId();
  const response = await ghlFetch<{
    customFields?: CustomFieldDefinition[];
    fields?: CustomFieldDefinition[];
  }>(`/locations/${locationId}/customFields`);

  const list = response.customFields || response.fields || [];
  const ids: Record<string, string> = {};

  for (const field of list) {
    const names = uniqueStrings([
      field.name,
      field.fieldKey,
      field.key,
      field.fieldKey?.replace(/^contact\./, ""),
      field.key?.replace(/^contact\./, ""),
    ]);

    for (const name of names) {
      ids[name] = field.id;
    }
  }

  cachedFieldIds = ids;
  return ids;
}

async function getExistingContactLink(
  client: string,
  subscriberId: string
): Promise<ContactLinkRow | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("manychat_contact_links")
    .select("subscriber_id, client, ghl_contact_id")
    .eq("client", client)
    .eq("subscriber_id", subscriberId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load contact link: ${error.message}`);
  }

  return data;
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
    { onConflict: "client,subscriber_id" }
  );

  if (error) {
    throw new Error(`Failed to save contact link: ${error.message}`);
  }
}

function buildCustomFieldsPayload(
  fieldIds: Record<string, string>,
  event: ManychatDmEvent,
  clientLabel: string
) {
  const eventFieldName = TAG_TO_DATE_FIELD[normalizeTagName(event.tagName)];
  const pairs: Array<[string, string]> = [
    ["cc_client", clientLabel],
    ["manychat_user_id", event.subscriberId],
  ];

  if (event.setterName) {
    pairs.push(["dm_setter", normalizeSetterKey(event.setterName) || event.setterName]);
  }

  if (event.instagramHandle) {
    pairs.push(["instagram_handle", event.instagramHandle.replace(/^@/, "")]);
  }

  if (event.manychatInboxUrl) {
    pairs.push(["manychat_inbox_url", event.manychatInboxUrl]);
  }

  const links = buildDmFollowupLinkBundle({
    client: event.client,
    subscriberId: event.subscriberId,
    instagramHandle: event.instagramHandle,
    instagramProfileUrl: event.instagramProfileUrl,
    manychatInboxUrl: event.manychatInboxUrl,
    metaBusinessSuiteUrl: event.metaBusinessSuiteUrl,
    metaThreadId: event.metaThreadId,
    metaAssetId: event.metaAssetId,
    metaMailboxId: event.metaMailboxId,
    metaBusinessId: event.metaBusinessId,
  });

  if (links.metaBusinessSuiteUrl) {
    pairs.push(["meta_business_suite_url", links.metaBusinessSuiteUrl]);
  }

  if (eventFieldName) {
    pairs.push([eventFieldName, toDateOnly(event.eventAt)]);
  }

  return pairs.flatMap(([name, value]) => {
    const id = fieldIds[name];
    if (!id) return [];
    return [{ id, field_value: value }];
  });
}

async function maybeAddMetaBusinessSuiteNote(params: {
  contactId: string;
  event: ManychatDmEvent;
  clientLabel: string;
}) {
  if (!isFollowupQueueTag(params.event.tagName)) {
    return { added: false, reason: "not_followup_tag" };
  }

  const links = buildDmFollowupLinkBundle({
    client: params.event.client,
    subscriberId: params.event.subscriberId,
    instagramHandle: params.event.instagramHandle,
    instagramProfileUrl: params.event.instagramProfileUrl,
    manychatInboxUrl: params.event.manychatInboxUrl,
    metaBusinessSuiteUrl: params.event.metaBusinessSuiteUrl,
    metaThreadId: params.event.metaThreadId,
    metaAssetId: params.event.metaAssetId,
    metaMailboxId: params.event.metaMailboxId,
    metaBusinessId: params.event.metaBusinessId,
  });

  if (!links.instagramDmUrl) {
    return { added: false, reason: "missing_instagram_handle" };
  }

  const notes = await getContactNotes(params.contactId);
  const hasExistingDeepLink = notes.some((note) => noteBody(note).trim() === links.instagramDmUrl);

  for (const note of notes) {
    const id = noteId(note);
    if (id && isOldCcosFollowupNote(noteBody(note))) {
      await deleteContactNote(params.contactId, id);
    }
  }

  if (hasExistingDeepLink) {
    return {
      added: false,
      reason: "already_exists",
      instagramDmUrl: links.instagramDmUrl,
    };
  }

  const leadName =
    [params.event.firstName, params.event.lastName].filter(Boolean).join(" ").trim() ||
    params.event.instagramHandle?.replace(/^@/, "") ||
    "Instagram Lead";

  const note = buildDmFollowupGhlNote({
    leadName,
    clientLabel: params.clientLabel,
    subscriberId: params.event.subscriberId,
    tagName: params.event.tagName,
    links,
  });

  await addContactNote(params.contactId, note);
  return {
    added: true,
    instagramDmUrl: links.instagramDmUrl,
  };
}

async function createContact(
  event: ManychatDmEvent,
  clientLabel: string,
  fieldIds: Record<string, string>
): Promise<string> {
  const name = buildDisplayName(event);
  const tags = uniqueStrings([
    `client_${clientLabel.replace(/\s+/g, "_")}`,
    event.setterName ? `setter_${normalizeSetterKey(event.setterName)}` : null,
    normalizeTagName(event.tagName),
  ]);

  const body = {
    locationId: getLocationId(),
    firstName: name.firstName,
    lastName: name.lastName || "",
    ...(event.email ? { email: event.email } : {}),
    source: "ManyChat DM Sync",
    tags,
    customFields: buildCustomFieldsPayload(fieldIds, event, clientLabel),
  };

  const response = await ghlFetch<{ contact?: { id?: string }; id?: string }>("/contacts/", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const contactId = response.contact?.id || response.id;
  if (!contactId) throw new Error("GHL create contact did not return a contact id");

  return contactId;
}

async function updateContact(
  contactId: string,
  event: ManychatDmEvent,
  clientLabel: string,
  fieldIds: Record<string, string>
) {
  const name = buildDisplayName(event);
  const body = {
    firstName: name.firstName,
    lastName: name.lastName || "",
    ...(event.email ? { email: event.email } : {}),
    customFields: buildCustomFieldsPayload(fieldIds, event, clientLabel),
  };

  await ghlFetch(`/contacts/${contactId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function syncManychatEventToGhl(event: ManychatDmEvent) {
  const clientKey = normalizeClientKey(event.client);
  const clientLabel = getClientLabel(clientKey);
  const normalizedEvent: ManychatDmEvent = {
    ...event,
    client: clientKey,
    tagName: normalizeTagName(event.tagName),
    setterName: normalizeSetterKey(event.setterName),
  };

  const fieldIds = await getCustomFieldIds();
  const existingLink = await getExistingContactLink(clientKey, event.subscriberId);

  if (existingLink?.ghl_contact_id) {
    await updateContact(existingLink.ghl_contact_id, normalizedEvent, clientLabel, fieldIds);
    let metaInboxNote;
    try {
      metaInboxNote = await maybeAddMetaBusinessSuiteNote({
        contactId: existingLink.ghl_contact_id,
        event: normalizedEvent,
        clientLabel,
      });
    } catch (err) {
      console.error("[ghl-dm-sync] Meta Business Suite note failed:", err);
      metaInboxNote = { added: false, reason: "note_error" };
    }
    return { clientKey, clientLabel, contactId: existingLink.ghl_contact_id, created: false, metaInboxNote };
  }

  const existingInstagramContactId = await findExistingInstagramContactIdForManychatLead({
    firstName: normalizedEvent.firstName,
    lastName: normalizedEvent.lastName,
    instagramHandle: normalizedEvent.instagramHandle,
    eventAt: normalizedEvent.eventAt,
  });

  if (existingInstagramContactId) {
    await updateContact(existingInstagramContactId, normalizedEvent, clientLabel, fieldIds);
    await saveContactLink(clientKey, normalizedEvent.subscriberId, existingInstagramContactId);
    let metaInboxNote;
    try {
      metaInboxNote = await maybeAddMetaBusinessSuiteNote({
        contactId: existingInstagramContactId,
        event: normalizedEvent,
        clientLabel,
      });
    } catch (err) {
      console.error("[ghl-dm-sync] Meta Business Suite note failed:", err);
      metaInboxNote = { added: false, reason: "note_error" };
    }
    return {
      clientKey,
      clientLabel,
      contactId: existingInstagramContactId,
      created: false,
      linkedExistingInstagramContact: true,
      metaInboxNote,
    };
  }

  const contactId = await createContact(normalizedEvent, clientLabel, fieldIds);
  await saveContactLink(clientKey, event.subscriberId, contactId);

  let metaInboxNote;
  try {
    metaInboxNote = await maybeAddMetaBusinessSuiteNote({
      contactId,
      event: normalizedEvent,
      clientLabel,
    });
  } catch (err) {
    console.error("[ghl-dm-sync] Meta Business Suite note failed:", err);
    metaInboxNote = { added: false, reason: "note_error" };
  }

  return { clientKey, clientLabel, contactId, created: true, metaInboxNote };
}
