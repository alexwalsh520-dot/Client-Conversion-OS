import crypto from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase";

export type InstagramClientSlug = "tyson" | "keith" | "lucy";

export interface InstagramClientDef {
  slug: InstagramClientSlug;
  clientKey: string;
  label: string;
}

export interface InstagramConnectionRow {
  client_slug: string;
  client_key: string;
  client_label: string;
  instagram_user_id: string | null;
  instagram_username: string | null;
  facebook_page_id: string | null;
  facebook_page_name: string | null;
  oauth_mode: string | null;
  granted_scopes: string[] | null;
  token_encrypted: string | null;
  token_expires_at: string | null;
  subscription_status: string | null;
  subscription_error: string | null;
  status: string;
  last_webhook_at: string | null;
  connected_by: string | null;
  updated_at: string | null;
}

interface OAuthStatePayload {
  client: InstagramClientSlug;
  by: string | null;
  exp: number;
  nonce: string;
  flow?: "sales_hub" | "public_setup";
  setupToken?: string | null;
}

interface InstagramSetupTokenPayload {
  client: InstagramClientSlug;
  purpose: "instagram_setup";
  exp: number;
  nonce: string;
}

export interface MetaOAuthConfig {
  appId: string | null;
  appSecret: string | null;
  appIdEnvName: string | null;
  appSecretEnvName: string | null;
  graphVersion: string;
  oauthMode: "facebook" | "instagram";
  scopes: string[];
  redirectUri: string;
  authorizeUrl: string;
  tokenEncryptionReady: boolean;
  webhookVerifyTokenReady: boolean;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

interface FacebookPageAccount {
  id?: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: {
    id?: string;
    username?: string;
    name?: string;
  };
}

interface InstagramAccountCandidate {
  instagramUserId: string;
  instagramUsername: string | null;
  facebookPageId: string | null;
  facebookPageName: string | null;
  pageAccessToken: string | null;
  raw: unknown;
}

const CLIENTS: InstagramClientDef[] = [
  { slug: "tyson", clientKey: "tyson_sonnek", label: "Tyson" },
  { slug: "keith", clientKey: "keith_holland", label: "Keith" },
  { slug: "lucy", clientKey: "lucy_hubbard", label: "Lucy Hubbard" },
];

function base64url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

function stateSecret() {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    process.env.META_APP_SECRET?.trim() ||
    ""
  );
}

function signState(payload: string) {
  const secret = stateSecret();
  if (!secret) throw new Error("AUTH_SECRET or META_APP_SECRET is required for Instagram connect state");
  return base64url(crypto.createHmac("sha256", secret).update(payload).digest());
}

function encryptionKey() {
  const raw =
    process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY?.trim() ||
    "";
  if (!raw) return null;

  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  if (raw.length >= 32) return crypto.createHash("sha256").update(raw).digest();
  return null;
}

function firstConfiguredEnv(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return { name: null, value: null };
}

function encryptToken(token: string) {
  const key = encryptionKey();
  if (!key) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [base64url(iv), base64url(tag), base64url(encrypted)].join(".");
}

function parseScopes(value: string | undefined, fallback: string[]) {
  return (value || fallback.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getOriginFromRequest(req: Request) {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

function metaBase(graphVersion: string) {
  return `https://graph.facebook.com/${graphVersion}`;
}

function instagramApiBase(graphVersion: string) {
  return `https://graph.instagram.com/${graphVersion}`;
}

export function getInstagramClients() {
  return CLIENTS;
}

export function getInstagramClient(slug: string | null | undefined) {
  return CLIENTS.find((client) => client.slug === slug);
}

export function normalizeInstagramHandle(value: string | null | undefined) {
  const cleaned = value?.trim().replace(/^@/, "").toLowerCase() || "";
  return cleaned || null;
}

export function getMetaOAuthConfig(req: Request): MetaOAuthConfig {
  const graphVersion = process.env.META_GRAPH_VERSION?.trim() || "v24.0";
  const oauthMode =
    process.env.META_INSTAGRAM_OAUTH_MODE?.trim().toLowerCase() === "instagram"
      ? "instagram"
      : "facebook";
  const redirectUri =
    process.env.META_INSTAGRAM_REDIRECT_URI?.trim() ||
    `${getOriginFromRequest(req)}/api/integrations/instagram/callback`;

  const facebookScopes = ["instagram_basic", "instagram_manage_messages", "pages_show_list", "pages_manage_metadata"];
  const instagramScopes = ["instagram_business_basic", "instagram_business_manage_messages"];
  const scopes = parseScopes(
    process.env.META_INSTAGRAM_OAUTH_SCOPES,
    oauthMode === "instagram" ? instagramScopes : facebookScopes,
  );
  const appId = firstConfiguredEnv([
    "META_APP_ID",
    "META_APP_ID_TYSON",
    "TYSON_META_APP_ID",
    "CLAUDE_META_APP_ID",
    "META_CLAUDE_APP_ID",
    "NEXT_PUBLIC_META_APP_ID",
    "NEXT_PUBLIC_META_APP_ID_TYSON",
  ]);
  const appSecret = firstConfiguredEnv([
    "META_APP_SECRET",
    "META_APP_SECRET_TYSON",
    "TYSON_META_APP_SECRET",
    "CLAUDE_META_APP_SECRET",
    "META_CLAUDE_APP_SECRET",
  ]);

  return {
    appId: appId.value,
    appSecret: appSecret.value,
    appIdEnvName: appId.name,
    appSecretEnvName: appSecret.name,
    graphVersion,
    oauthMode,
    scopes,
    redirectUri,
    authorizeUrl:
      process.env.META_INSTAGRAM_AUTHORIZE_URL?.trim() ||
      (oauthMode === "instagram"
        ? "https://www.instagram.com/oauth/authorize"
        : `https://www.facebook.com/${graphVersion}/dialog/oauth`),
    tokenEncryptionReady: Boolean(encryptionKey()),
    webhookVerifyTokenReady: Boolean(process.env.INSTAGRAM_DM_WEBHOOK_VERIFY_TOKEN?.trim()),
  };
}

export function buildConnectState(input: {
  client: InstagramClientSlug;
  connectedBy: string | null;
  flow?: "sales_hub" | "public_setup";
  setupToken?: string | null;
}) {
  const payload: OAuthStatePayload = {
    client: input.client,
    by: input.connectedBy,
    exp: Date.now() + 15 * 60 * 1000,
    nonce: crypto.randomBytes(12).toString("hex"),
    flow: input.flow || "sales_hub",
    setupToken: input.setupToken || null,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${signState(encoded)}`;
}

export function readConnectState(state: string | null) {
  if (!state) throw new Error("Missing Instagram connect state");
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature || signature !== signState(encoded)) {
    throw new Error("Invalid Instagram connect state");
  }

  const payload = JSON.parse(fromBase64url(encoded)) as OAuthStatePayload;
  if (!getInstagramClient(payload.client)) throw new Error("Invalid Instagram client in state");
  if (!payload.exp || payload.exp < Date.now()) throw new Error("Instagram connect state expired");
  return payload;
}

export function buildInstagramSetupToken(input: {
  client: InstagramClientSlug;
  daysValid?: number;
}) {
  const payload: InstagramSetupTokenPayload = {
    client: input.client,
    purpose: "instagram_setup",
    exp: Date.now() + (input.daysValid || 30) * 24 * 60 * 60 * 1000,
    nonce: crypto.randomBytes(12).toString("hex"),
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${signState(encoded)}`;
}

export function readInstagramSetupToken(clientSlug: string, token: string | null) {
  if (!token) throw new Error("Missing setup token");
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || signature !== signState(encoded)) {
    throw new Error("Invalid setup token");
  }

  const payload = JSON.parse(fromBase64url(encoded)) as InstagramSetupTokenPayload;
  if (payload.purpose !== "instagram_setup") throw new Error("Invalid setup link");
  if (payload.client !== clientSlug) throw new Error("Setup link does not match this client");
  if (!getInstagramClient(payload.client)) throw new Error("Unknown client");
  if (!payload.exp || payload.exp < Date.now()) throw new Error("Setup link expired");
  return payload;
}

export function buildAuthorizeUrl(config: MetaOAuthConfig, state: string) {
  if (!config.appId) throw new Error("Meta app ID env var is not configured");

  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(","));
  url.searchParams.set("state", state);

  if (config.oauthMode === "instagram") {
    url.searchParams.set("enable_fb_login", "0");
    url.searchParams.set("force_authentication", "1");
  }

  return url.toString();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message =
      json?.error?.message ||
      json?.error_description ||
      text ||
      `Request failed with ${res.status}`;
    throw new Error(message);
  }
  return json as T;
}

export async function exchangeCodeForToken(config: MetaOAuthConfig, code: string) {
  if (!config.appId || !config.appSecret) {
    throw new Error("Meta app ID and Meta app secret are required before Instagram can connect");
  }

  if (config.oauthMode === "instagram") {
    const body = new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code,
    });

    return fetchJson<TokenResponse>("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  const url = new URL(`${metaBase(config.graphVersion)}/oauth/access_token`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("code", code);
  return fetchJson<TokenResponse>(url.toString());
}

export async function discoverInstagramAccount(config: MetaOAuthConfig, accessToken: string) {
  if (config.oauthMode === "instagram") {
    const url = new URL(`${instagramApiBase(config.graphVersion)}/me`);
    url.searchParams.set("fields", "user_id,username,account_type");
    url.searchParams.set("access_token", accessToken);
    const data = await fetchJson<Record<string, unknown>>(url.toString());
    const instagramUserId = String(data.user_id || data.id || "");
    if (!instagramUserId) throw new Error("No Instagram account was returned by Meta");
    return {
      instagramUserId,
      instagramUsername: typeof data.username === "string" ? data.username : null,
      facebookPageId: null,
      facebookPageName: null,
      pageAccessToken: null,
      raw: data,
    } satisfies InstagramAccountCandidate;
  }

  const url = new URL(`${metaBase(config.graphVersion)}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username,name}");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", accessToken);

  const data = await fetchJson<{ data?: FacebookPageAccount[] }>(url.toString());
  const page = (data.data || []).find((item) => item.instagram_business_account?.id);
  const ig = page?.instagram_business_account;
  if (!page || !ig?.id) {
    throw new Error("No Instagram professional account was found on this Meta login");
  }

  return {
    instagramUserId: ig.id,
    instagramUsername: ig.username || null,
    facebookPageId: page.id || null,
    facebookPageName: page.name || null,
    pageAccessToken: page.access_token || null,
    raw: page,
  } satisfies InstagramAccountCandidate;
}

export async function subscribePageToInstagramWebhooks(config: MetaOAuthConfig, page: InstagramAccountCandidate) {
  if (!page.facebookPageId || !page.pageAccessToken) {
    return { status: "not_needed", error: null as string | null };
  }

  const url = new URL(`${metaBase(config.graphVersion)}/${page.facebookPageId}/subscribed_apps`);
  url.searchParams.set("subscribed_fields", "messages,messaging_postbacks,message_echoes");
  url.searchParams.set("access_token", page.pageAccessToken);

  try {
    await fetchJson<Record<string, unknown>>(url.toString(), { method: "POST" });
    return { status: "subscribed", error: null };
  } catch (err) {
    return {
      status: "subscription_failed",
      error: err instanceof Error ? err.message : "Subscription failed",
    };
  }
}

export function tokenExpiresAt(token: TokenResponse) {
  if (!token.expires_in) return null;
  return new Date(Date.now() + token.expires_in * 1000).toISOString();
}

export async function saveInstagramConnection(input: {
  client: InstagramClientDef;
  connectedBy: string | null;
  config: MetaOAuthConfig;
  token: TokenResponse;
  account: InstagramAccountCandidate;
  subscription: { status: string; error: string | null };
}) {
  const sb = getServiceSupabase();
  const encryptedToken = input.token.access_token ? encryptToken(input.token.access_token) : null;
  const scopes = input.token.scope ? parseScopes(input.token.scope, input.config.scopes) : input.config.scopes;

  const { error } = await sb.from("instagram_connections").upsert(
    {
      client_slug: input.client.slug,
      client_key: input.client.clientKey,
      client_label: input.client.label,
      instagram_user_id: input.account.instagramUserId,
      instagram_username: input.account.instagramUsername,
      facebook_page_id: input.account.facebookPageId,
      facebook_page_name: input.account.facebookPageName,
      oauth_mode: input.config.oauthMode,
      granted_scopes: scopes,
      token_encrypted: encryptedToken,
      token_expires_at: tokenExpiresAt(input.token),
      subscription_status: input.subscription.status,
      subscription_error: input.subscription.error,
      status: "connected",
      connected_by: input.connectedBy,
      raw_payload: {
        account: input.account.raw,
        token_type: input.token.token_type || null,
        token_stored: Boolean(encryptedToken),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_key" },
  );

  if (error) throw new Error(`Failed to save Instagram connection: ${error.message}`);
}

export async function getInstagramConnectionByAccountId(accountId: string | null | undefined) {
  if (!accountId) return null;

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("instagram_connections")
      .select(
        "client_slug, client_key, client_label, instagram_user_id, instagram_username, facebook_page_id, facebook_page_name, oauth_mode, granted_scopes, token_encrypted, token_expires_at, subscription_status, subscription_error, status, last_webhook_at, connected_by, updated_at",
      )
      .eq("instagram_user_id", accountId)
      .eq("status", "connected")
      .maybeSingle();

    if (error) return null;
    return (data || null) as InstagramConnectionRow | null;
  } catch {
    return null;
  }
}

export async function markInstagramConnectionWebhookSeen(accountId: string) {
  try {
    const sb = getServiceSupabase();
    await sb
      .from("instagram_connections")
      .update({ last_webhook_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("instagram_user_id", accountId);
  } catch {
    // Do not let status tracking break message storage.
  }
}

export async function listInstagramConnections() {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("instagram_connections")
    .select(
      "client_slug, client_key, client_label, instagram_user_id, instagram_username, facebook_page_id, facebook_page_name, oauth_mode, granted_scopes, token_encrypted, token_expires_at, subscription_status, subscription_error, status, last_webhook_at, connected_by, updated_at",
    )
    .order("client_slug", { ascending: true });

  if (error) throw error;
  return (data || []) as InstagramConnectionRow[];
}

async function findLeadLink(client: string, filters: { manychatId?: string | null; instagramUserId?: string | null; handle?: string | null }) {
  const sb = getServiceSupabase();
  const normalizedHandle = normalizeInstagramHandle(filters.handle);

  if (filters.manychatId) {
    const { data } = await sb
      .from("instagram_lead_links")
      .select("*")
      .eq("client", client)
      .eq("manychat_subscriber_id", filters.manychatId)
      .limit(1)
      .maybeSingle();
    if (data) return data as Record<string, unknown>;
  }

  if (filters.instagramUserId) {
    const { data } = await sb
      .from("instagram_lead_links")
      .select("*")
      .eq("client", client)
      .eq("instagram_user_id", filters.instagramUserId)
      .limit(1)
      .maybeSingle();
    if (data) return data as Record<string, unknown>;
  }

  if (normalizedHandle) {
    const { data } = await sb
      .from("instagram_lead_links")
      .select("*")
      .eq("client", client)
      .eq("instagram_handle", normalizedHandle)
      .limit(1)
      .maybeSingle();
    if (data) return data as Record<string, unknown>;
  }

  return null;
}

export async function upsertManychatLeadIdentity(input: {
  client: string;
  manychatSubscriberId: string;
  instagramHandle?: string | null;
  leadName?: string | null;
  eventAt?: string | null;
}) {
  if (!input.client || !input.manychatSubscriberId) return;
  const sb = getServiceSupabase();
  const existing = await findLeadLink(input.client, {
    manychatId: input.manychatSubscriberId,
    handle: input.instagramHandle,
  });
  const normalizedHandle = normalizeInstagramHandle(input.instagramHandle);

  const payload = {
    client: input.client,
    manychat_subscriber_id: input.manychatSubscriberId,
    instagram_user_id: (existing?.instagram_user_id as string | null | undefined) || null,
    instagram_handle: normalizedHandle || (existing?.instagram_handle as string | null | undefined) || null,
    lead_name: input.leadName || (existing?.lead_name as string | null | undefined) || null,
    confidence: existing?.instagram_user_id ? "matched" : normalizedHandle ? "handle_pending" : "pending",
    source: "manychat",
    last_manychat_event_at: input.eventAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await sb.from("instagram_lead_links").update(payload).eq("id", existing.id);
  } else {
    await sb.from("instagram_lead_links").insert(payload);
  }
}

export async function upsertInstagramLeadIdentity(input: {
  client: string;
  instagramUserId: string;
  instagramHandle?: string | null;
  sentAt?: string | null;
}) {
  if (!input.client || !input.instagramUserId) return;
  const sb = getServiceSupabase();
  const existing = await findLeadLink(input.client, {
    instagramUserId: input.instagramUserId,
    handle: input.instagramHandle,
  });
  const normalizedHandle = normalizeInstagramHandle(input.instagramHandle);

  const payload = {
    client: input.client,
    manychat_subscriber_id: (existing?.manychat_subscriber_id as string | null | undefined) || null,
    instagram_user_id: input.instagramUserId,
    instagram_handle: normalizedHandle || (existing?.instagram_handle as string | null | undefined) || null,
    lead_name: (existing?.lead_name as string | null | undefined) || null,
    confidence: existing?.manychat_subscriber_id ? "matched" : normalizedHandle ? "handle_pending" : "instagram_pending",
    source: "instagram",
    last_instagram_message_at: input.sentAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await sb.from("instagram_lead_links").update(payload).eq("id", existing.id);
  } else {
    await sb.from("instagram_lead_links").insert(payload);
  }
}
