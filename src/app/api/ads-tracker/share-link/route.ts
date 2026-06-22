// Operator-only: get-or-mint the public share link for a creator's view.
//
// This route is auth-gated (it is NOT on the api/public allow-list in proxy.ts),
// so only a logged-in operator can mint or read a token. The PUBLIC surfaces that
// actually serve data are /api/public/ads/<token> and /api/public/live-ads/<token>;
// this just hands the operator the URL to paste in Slack.
//
//   GET ?account=antwan                 -> { token, url } for the Ads metrics view
//   GET ?account=antwan&kind=live-ads   -> { token, url } for the Live Ads view
//
// "all" has no single creator, so it is rejected — a share link is always for
// exactly one creator.
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { isCreatorKey, CREATORS } from "@/lib/creators";

export const dynamic = "force-dynamic";

const BASE_URL = "https://client-conversion-os.vercel.app";

// The kinds of share link we mint, mapped to their public page prefix + label.
const SHARE_KINDS = {
  ads: { prefix: "/p/ads", label: "creator ads view" },
  "live-ads": { prefix: "/p/live-ads", label: "live ads view" },
} as const;

type ShareKind = keyof typeof SHARE_KINDS;

function isShareKind(value: string): value is ShareKind {
  return value in SHARE_KINDS;
}

function publicUrl(kind: ShareKind, token: string) {
  return `${BASE_URL}${SHARE_KINDS[kind].prefix}/${token}`;
}

export async function GET(req: NextRequest) {
  // Minting/reading a share link is operator-only — it writes to the DB. The
  // public surfaces that serve DATA are /api/public/ads|live-ads/<token>; not this.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = (req.nextUrl.searchParams.get("account") || "").toLowerCase();
  const kindParam = (req.nextUrl.searchParams.get("kind") || "ads").toLowerCase();
  const kind: ShareKind = isShareKind(kindParam) ? kindParam : "ads";

  if (!isCreatorKey(account)) {
    return NextResponse.json(
      { error: "Pick a single creator to share — “All accounts” has no share link." },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceSupabase();

    // Reuse an existing live link for this creator + kind if one exists.
    const { data: existing } = await sb
      .from("public_share_links")
      .select("token")
      .eq("kind", kind)
      .eq("client_key", account)
      .eq("revoked", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing?.token) {
      return NextResponse.json({ token: existing.token, url: publicUrl(kind, existing.token) });
    }

    // Mint a fresh, unguessable token.
    const token = randomBytes(32).toString("base64url");
    const name = CREATORS.find((c) => c.key === account)?.name || account;
    const { error } = await sb.from("public_share_links").insert({
      token,
      kind,
      client_key: account,
      label: `${name} ${SHARE_KINDS[kind].label}`,
    });
    if (error) throw error;

    return NextResponse.json({ token, url: publicUrl(kind, token) });
  } catch (error) {
    console.error("[ads-tracker/share-link] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create share link." },
      { status: 500 }
    );
  }
}
