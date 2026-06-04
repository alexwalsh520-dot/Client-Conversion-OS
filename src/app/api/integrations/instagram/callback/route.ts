import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  discoverInstagramAccount,
  exchangeCodeForToken,
  getInstagramClient,
  getMetaOAuthConfig,
  readConnectState,
  saveInstagramConnection,
  subscribePageToInstagramWebhooks,
} from "@/lib/instagram-connections";

function salesHubRedirect(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/sales-hub", req.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.hash = "response-times";
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return salesHubRedirect(req, {
      instagramConnect: "error",
      message: "CCOS login is required before connecting Instagram",
    });
  }

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error_description") || req.nextUrl.searchParams.get("error");
  if (error) {
    return salesHubRedirect(req, { instagramConnect: "error", message: error });
  }
  if (!code) {
    return salesHubRedirect(req, { instagramConnect: "error", message: "Missing Meta authorization code" });
  }

  try {
    const state = readConnectState(req.nextUrl.searchParams.get("state"));
    const client = getInstagramClient(state.client);
    if (!client) throw new Error("Unknown Instagram client");

    const config = getMetaOAuthConfig(req);
    const token = await exchangeCodeForToken(config, code);
    if (!token.access_token) throw new Error("Meta did not return an access token");

    const account = await discoverInstagramAccount(config, token.access_token);
    const subscription = await subscribePageToInstagramWebhooks(config, account);

    await saveInstagramConnection({
      client,
      connectedBy: session.user.email || state.by || null,
      config,
      token,
      account,
      subscription,
    });

    return salesHubRedirect(req, {
      instagramConnect: "success",
      client: client.slug,
    });
  } catch (err) {
    return salesHubRedirect(req, {
      instagramConnect: "error",
      message: err instanceof Error ? err.message : "Instagram connect failed",
    });
  }
}
