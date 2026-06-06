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

function publicSetupRedirect(
  req: NextRequest,
  clientSlug: string,
  params: Record<string, string>,
) {
  const url = new URL(`/connect/instagram/${clientSlug}`, req.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  let state: ReturnType<typeof readConnectState>;
  try {
    state = readConnectState(req.nextUrl.searchParams.get("state"));
  } catch (err) {
    return salesHubRedirect(req, {
      instagramConnect: "error",
      message: err instanceof Error ? err.message : "Invalid Instagram connect state",
    });
  }

  const client = getInstagramClient(state.client);
  if (!client) {
    return salesHubRedirect(req, { instagramConnect: "error", message: "Unknown Instagram client" });
  }

  const isPublicSetup = state.flow === "public_setup";
  const redirectWith = (params: Record<string, string>) => {
    if (!isPublicSetup) return salesHubRedirect(req, params);
    if (state.setupToken) params.token = state.setupToken;
    return publicSetupRedirect(req, client.slug, params);
  };

  const session = await auth();
  if (!isPublicSetup && !session?.user?.email) {
    return salesHubRedirect(req, {
      instagramConnect: "error",
      message: "CCOS login is required before connecting Instagram",
    });
  }

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error_description") || req.nextUrl.searchParams.get("error");
  if (error) {
    return redirectWith({ instagramConnect: "error", status: "error", message: error });
  }
  if (!code) {
    return redirectWith({
      instagramConnect: "error",
      status: "error",
      message: "Missing Meta authorization code",
    });
  }

  try {
    const config = getMetaOAuthConfig(req);
    const token = await exchangeCodeForToken(config, code);
    if (!token.access_token) throw new Error("Meta did not return an access token");

    const account = await discoverInstagramAccount(config, token.access_token);
    const subscription = await subscribePageToInstagramWebhooks(config, account);

    await saveInstagramConnection({
      client,
      connectedBy: session?.user?.email || state.by || null,
      config,
      token,
      account,
      subscription,
    });

    return redirectWith({
      instagramConnect: "success",
      status: "success",
      client: client.slug,
    });
  } catch (err) {
    return redirectWith({
      instagramConnect: "error",
      status: "error",
      message: err instanceof Error ? err.message : "Instagram connect failed",
    });
  }
}
