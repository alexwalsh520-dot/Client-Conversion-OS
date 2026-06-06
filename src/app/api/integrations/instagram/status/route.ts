import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  buildInstagramSetupToken,
  getInstagramClients,
  getMetaOAuthConfig,
  listInstagramConnections,
} from "@/lib/instagram-connections";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const config = getMetaOAuthConfig(req);
  let rows: Awaited<ReturnType<typeof listInstagramConnections>> = [];
  let tableReady = true;
  let tableError: string | null = null;

  try {
    rows = await listInstagramConnections();
  } catch (err) {
    tableReady = false;
    tableError = err instanceof Error ? err.message : "Instagram connections table is not ready";
  }

  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  const rowByClient = new Map(rows.map((row) => [row.client_key, row]));
  const clients = getInstagramClients().map((client) => {
    const row = rowByClient.get(client.clientKey);
    const setupUrl = new URL(`/connect/instagram/${client.slug}`, origin);
    setupUrl.searchParams.set("token", buildInstagramSetupToken({ client: client.slug }));

    return {
      slug: client.slug,
      clientKey: client.clientKey,
      label: client.label,
      setupUrl: setupUrl.toString(),
      connected: Boolean(row?.instagram_user_id),
      instagramUserId: row?.instagram_user_id || null,
      instagramUsername: row?.instagram_username || null,
      facebookPageName: row?.facebook_page_name || null,
      subscriptionStatus: row?.subscription_status || null,
      subscriptionError: row?.subscription_error || null,
      tokenStored: Boolean(row?.token_encrypted),
      lastWebhookAt: row?.last_webhook_at || null,
      connectedBy: row?.connected_by || null,
      updatedAt: row?.updated_at || null,
    };
  });

  return NextResponse.json({
    tableReady,
    tableError,
    env: {
      appIdConfigured: Boolean(config.appId),
      appSecretConfigured: Boolean(config.appSecret),
      appIdEnvName: config.appIdEnvName,
      appSecretEnvName: config.appSecretEnvName,
      tokenEncryptionReady: config.tokenEncryptionReady,
      webhookVerifyTokenReady: config.webhookVerifyTokenReady,
      oauthMode: config.oauthMode,
      graphVersion: config.graphVersion,
      scopes: config.scopes,
      redirectUri: config.redirectUri,
      webhookUrl: `${origin}/api/webhooks/instagram`,
    },
    clients,
  });
}
