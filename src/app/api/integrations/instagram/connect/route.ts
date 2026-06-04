import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  buildAuthorizeUrl,
  buildConnectState,
  getInstagramClient,
  getMetaOAuthConfig,
} from "@/lib/instagram-connections";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { client?: string };
  const client = getInstagramClient(body.client);
  if (!client) {
    return NextResponse.json({ error: "Invalid client" }, { status: 400 });
  }

  const config = getMetaOAuthConfig(req);
  if (!config.appId || !config.appSecret) {
    return NextResponse.json(
      { error: "META_APP_ID and META_APP_SECRET must be set before Instagram can connect" },
      { status: 400 },
    );
  }

  const state = buildConnectState({
    client: client.slug,
    connectedBy: session.user.email || null,
  });

  return NextResponse.json({
    url: buildAuthorizeUrl(config, state),
    redirectUri: config.redirectUri,
  });
}
