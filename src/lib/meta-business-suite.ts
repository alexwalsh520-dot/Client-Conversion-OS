export interface MetaBusinessSuiteLinkInput {
  client: string;
  selectedItemId?: string | null;
  assetId?: string | null;
  mailboxId?: string | null;
  businessId?: string | null;
  rawUrl?: string | null;
}

export interface DmFollowupLinkBundle {
  marker: string;
  metaBusinessSuiteUrl: string | null;
  metaBusinessSuiteExact: boolean;
  instagramDmUrl: string | null;
  instagramProfileUrl: string | null;
  manychatInboxUrl: string | null;
}

const CLIENT_ENV_KEYS: Record<string, string[]> = {
  tyson_sonnek: ["TYSON", "TYSON_SONNEK"],
  keith_holland: ["KEITH", "KEITH_HOLLAND"],
  lucy_hubbard: ["LUCY", "LUCY_HUBBARD"],
  antwan: ["ANTWAN"],
};

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function envValue(keys: string[]) {
  for (const key of keys) {
    const value = clean(process.env[key]);
    if (value) return value;
  }
  return null;
}

function clientEnvValue(client: string, names: string[]) {
  const clientKeys = CLIENT_ENV_KEYS[client] ?? [client.toUpperCase().replace(/[^A-Z0-9]+/g, "_")];
  const keys: string[] = [];

  for (const name of names) {
    for (const clientKey of clientKeys) {
      keys.push(`${name}_${clientKey}`);
    }
  }

  keys.push(...names);
  return envValue(keys);
}

function isBusinessSuiteInboxUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "business.facebook.com" && url.pathname.includes("/latest/inbox");
  } catch {
    return false;
  }
}

export function extractMetaSelectedItemId(value?: string | null) {
  const raw = clean(value);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    return clean(url.searchParams.get("selected_item_id")) || raw;
  } catch {
    return raw;
  }
}

export function buildMetaBusinessSuiteInboxUrl(input: MetaBusinessSuiteLinkInput) {
  const rawUrl = clean(input.rawUrl);
  if (rawUrl && isBusinessSuiteInboxUrl(rawUrl)) {
    return {
      url: rawUrl,
      exact: Boolean(extractMetaSelectedItemId(rawUrl)),
    };
  }

  const assetId =
    clean(input.assetId) ||
    clientEnvValue(input.client, [
      "META_BUSINESS_ASSET_ID",
      "META_BUSINESS_PAGE_ID",
      "META_PAGE_ID",
    ]);

  if (!assetId) return { url: null, exact: false };

  const mailboxId =
    clean(input.mailboxId) ||
    clientEnvValue(input.client, [
      "META_BUSINESS_MAILBOX_ID",
      "META_MAILBOX_ID",
    ]) ||
    assetId;

  const businessId =
    clean(input.businessId) ||
    clientEnvValue(input.client, [
      "META_BUSINESS_ID",
    ]);

  const selectedItemId = extractMetaSelectedItemId(input.selectedItemId);
  const url = new URL("https://business.facebook.com/latest/inbox/instagram_direct");
  url.searchParams.set("asset_id", assetId);
  url.searchParams.set("mailbox_id", mailboxId);
  if (businessId) url.searchParams.set("business_id", businessId);
  if (selectedItemId) {
    url.searchParams.set("selected_item_id", selectedItemId);
    url.searchParams.set("thread_type", "IG_MESSAGE");
  }

  return { url: url.toString(), exact: Boolean(selectedItemId) };
}

export function buildInstagramProfileUrl(handle?: string | null, rawUrl?: string | null) {
  const provided = clean(rawUrl);
  if (provided) return provided;

  const username = clean(handle)?.replace(/^@/, "");
  if (!username) return null;
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

function extractInstagramUsername(handle?: string | null, rawUrl?: string | null) {
  const direct = clean(handle)?.replace(/^@/, "");
  if (direct) return direct;

  const provided = clean(rawUrl);
  if (!provided) return null;

  try {
    const url = new URL(provided);
    const username = url.pathname.split("/").filter(Boolean)[0];
    return clean(username);
  } catch {
    return null;
  }
}

export function buildInstagramDmUrl(handle?: string | null, rawUrl?: string | null) {
  const username = extractInstagramUsername(handle, rawUrl);
  if (!username) return null;
  return `https://ig.me/m/${encodeURIComponent(username)}`;
}

export function buildManychatInboxUrl(client: string, subscriberId: string, rawUrl?: string | null) {
  const provided = clean(rawUrl);
  if (provided) return provided;

  const base =
    clientEnvValue(client, ["MANYCHAT_APP_CHAT_BASE_URL"]) ||
    process.env.MANYCHAT_APP_CHAT_BASE_URL ||
    "https://app.manychat.com/fb1024471/chat";

  return `${base.replace(/\/$/, "")}/${encodeURIComponent(subscriberId)}`;
}

export function isFollowupQueueTag(tagName: string) {
  const normalized = tagName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return new Set([
    "followupcue",
    "followupqueue",
    "followup",
    "aifollowup",
    "aifollowupqueue",
  ]).has(normalized);
}

export function buildDmFollowupLinkBundle(params: {
  client: string;
  subscriberId: string;
  instagramHandle?: string | null;
  instagramProfileUrl?: string | null;
  manychatInboxUrl?: string | null;
  metaBusinessSuiteUrl?: string | null;
  metaThreadId?: string | null;
  metaAssetId?: string | null;
  metaMailboxId?: string | null;
  metaBusinessId?: string | null;
}): DmFollowupLinkBundle {
  const meta = buildMetaBusinessSuiteInboxUrl({
    client: params.client,
    rawUrl: params.metaBusinessSuiteUrl,
    selectedItemId: params.metaThreadId,
    assetId: params.metaAssetId,
    mailboxId: params.metaMailboxId,
    businessId: params.metaBusinessId,
  });

  return {
    marker: `CCOS_META_INBOX_LINK:${params.client}:${params.subscriberId}`,
    metaBusinessSuiteUrl: meta.url,
    metaBusinessSuiteExact: meta.exact,
    instagramDmUrl: buildInstagramDmUrl(params.instagramHandle, params.instagramProfileUrl),
    instagramProfileUrl: buildInstagramProfileUrl(params.instagramHandle, params.instagramProfileUrl),
    manychatInboxUrl: buildManychatInboxUrl(params.client, params.subscriberId, params.manychatInboxUrl),
  };
}

export function buildDmFollowupGhlNote(params: {
  leadName: string;
  clientLabel: string;
  subscriberId: string;
  tagName: string;
  links: DmFollowupLinkBundle;
}) {
  return params.links.instagramDmUrl || "";
}
