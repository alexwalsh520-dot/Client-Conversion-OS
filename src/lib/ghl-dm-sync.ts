import { getServiceSupabase } from "@/lib/supabase";
import { findExistingInstagramContactIdForManychatLead } from "@/lib/dm-contact-linking";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export interface ManychatDmEvent {
  subscriberId: string;
  firstName?: string | null;
  lastName?: string | null;
  instagramHandle?: string | null;
  tagName: string;
  client: string;
  setterName?: string | null;
  eventAt: string;
}

export type ClientKey = "tyson_sonnek" | "keith_holland" | "zoe_and_emily";

const CLIENT_LABELS: Record<ClientKey, string> = {
  tyson_sonnek: "Tyson Sonnek",
  keith_holland: "Keith Holland",
  zoe_and_emily: "Zoe and Emily",
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

let cachedFieldIds: Record<string, string> | null = null;

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
      "zoe",
      "emily",
      "zoe_and_emily",
      "client_zoe_and_emily",
      "client_zoe_emily",
      "zoe and emily",
      "zoe & emily",
      "zoe + emily",
      "zoe_emily",
      "zoe emily",
      "zoe and em",
      "zoe & em",
    ].includes(value)
  ) {
    return "zoe_and_emily";
  }

  throw new Error(`Unsupported client value: ${raw}`);
}

export function getClientLabel(clientKey: ClientKey): string {
  return CLIENT_LABELS[clientKey];
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

  if (eventFieldName) {
    pairs.push([eventFieldName, toDateOnly(event.eventAt)]);
  }

  return pairs.flatMap(([name, value]) => {
    const id = fieldIds[name];
    if (!id) return [];
    return [{ id, field_value: value }];
  });
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
    return { clientKey, clientLabel, contactId: existingLink.ghl_contact_id, created: false };
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
    return {
      clientKey,
      clientLabel,
      contactId: existingInstagramContactId,
      created: false,
      linkedExistingInstagramContact: true,
    };
  }

  const contactId = await createContact(normalizedEvent, clientLabel, fieldIds);
  await saveContactLink(clientKey, event.subscriberId, contactId);

  return { clientKey, clientLabel, contactId, created: true };
}
