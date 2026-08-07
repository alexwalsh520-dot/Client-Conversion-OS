import { NextRequest, NextResponse } from "next/server";
import { CREATORS_BY_KEY, firstEnv, type CreatorKey } from "@/lib/creators";

// Exchanges a short-lived Meta user token for a long-lived (~60 day) one.
// Lives server-side because the per-client app secrets are sensitive Vercel
// env vars that cannot be pulled locally. Caller supplies the short-lived
// token; the app id + secret come from this deployment's env.
export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v21.0";

// App credential env vars per creator (only clients with their own Meta app).
const APP_ENV: Partial<Record<CreatorKey, { id: string[]; secret: string[] }>> = {
  jake: {
    id: ["META_APP_ID_JAKE_DIVLJAK", "META_APP_ID_JAKE"],
    secret: ["META_APP_SECRET_JAKE_DIVLJAK", "META_APP_SECRET_JAKE"],
  },
};

export async function POST(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    creator?: string;
    shortToken?: string;
  } | null;
  const creatorKey = (body?.creator ?? "jake") as CreatorKey;
  const shortToken = body?.shortToken?.trim();
  if (!shortToken) {
    return NextResponse.json({ error: "shortToken required" }, { status: 400 });
  }

  const appEnv = APP_ENV[creatorKey];
  const creator = CREATORS_BY_KEY[creatorKey];
  if (!appEnv || !creator) {
    return NextResponse.json({ error: `no app configured for ${creatorKey}` }, { status: 400 });
  }
  const appId = firstEnv(appEnv.id);
  const appSecret = firstEnv(appEnv.secret);
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: `app id/secret env missing for ${creatorKey}` },
      { status: 500 },
    );
  }

  const exchangeUrl =
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(shortToken)}`;
  const exchangeRes = await fetch(exchangeUrl);
  const exchange = (await exchangeRes.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!exchangeRes.ok || !exchange.access_token) {
    return NextResponse.json(
      { error: exchange.error?.message ?? "exchange failed", status: exchangeRes.status },
      { status: 502 },
    );
  }

  // Prove the new token can actually read this client's ad account before
  // anyone puts it in the env.
  const adAccountId =
    firstEnv(creator.adAccountEnv ?? []) ?? creator.defaultAdAccountId ?? null;
  let adAccountCheck: unknown = null;
  if (adAccountId) {
    const checkRes = await fetch(
      `${GRAPH}/${adAccountId}?fields=name,account_status,currency&access_token=${encodeURIComponent(exchange.access_token)}`,
    );
    adAccountCheck = await checkRes.json();
  }

  return NextResponse.json({
    creator: creatorKey,
    longLivedToken: exchange.access_token,
    expiresInDays: exchange.expires_in ? Math.round(exchange.expires_in / 86400) : null,
    adAccountId,
    adAccountCheck,
  });
}
