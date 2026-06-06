import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  buildConnectState,
  getInstagramClient,
  getMetaOAuthConfig,
  readInstagramSetupToken,
} from "@/lib/instagram-connections";

export async function GET(req: NextRequest) {
  const clientSlug = req.nextUrl.searchParams.get("client");
  const setupToken = req.nextUrl.searchParams.get("token");
  const client = getInstagramClient(clientSlug);

  if (!client) {
    return NextResponse.redirect(new URL("/connect/instagram/error?message=Unknown%20client", req.url));
  }

  try {
    readInstagramSetupToken(client.slug, setupToken);

    const config = getMetaOAuthConfig(req);
    if (!config.appId || !config.appSecret) {
      throw new Error("CCOS is missing the Meta app setup. Message the CCOS team.");
    }

    const state = buildConnectState({
      client: client.slug,
      connectedBy: `${client.label} setup link`,
      flow: "public_setup",
      setupToken,
    });

    return NextResponse.redirect(buildAuthorizeUrl(config, state));
  } catch (err) {
    const url = new URL(`/connect/instagram/${client.slug}`, req.url);
    url.searchParams.set("status", "error");
    url.searchParams.set("message", err instanceof Error ? err.message : "Could not start Instagram setup");
    if (setupToken) url.searchParams.set("token", setupToken);
    return NextResponse.redirect(url);
  }
}
