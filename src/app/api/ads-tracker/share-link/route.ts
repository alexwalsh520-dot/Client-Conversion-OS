// Operator-only: get-or-mint the public share link for a creator's Ads view.
//
// This route is auth-gated (it is NOT on the api/public allow-list in proxy.ts),
// so only a logged-in operator can mint or read a token. The PUBLIC surface that
// actually serves data is /api/public/ads/<token>; this just hands the operator
// the URL to paste in Slack.
//
//   GET ?account=antwan  -> { token, url } (creating the row if none exists)
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

function publicUrl(token: string) {
  return `${BASE_URL}/p/ads/${token}`;
}

export async function GET(req: NextRequest) {
  // Minting/reading a share link is operator-only — it writes to the DB. The
  // public surface that serves DATA is /api/public/ads/<token>; this is not it.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = (req.nextUrl.searchParams.get("account") || "").toLowerCase();

  if (!isCreatorKey(account)) {
    return NextResponse.json(
      { error: "Pick a single creator to share — “All accounts” has no share link." },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceSupabase();

    // Reuse an existing live link for this creator if one exists.
    const { data: existing } = await sb
      .from("public_share_links")
      .select("token")
      .eq("kind", "ads")
      .eq("client_key", account)
      .eq("revoked", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing?.token) {
      return NextResponse.json({ token: existing.token, url: publicUrl(existing.token) });
    }

    // Mint a fresh, unguessable token.
    const token = randomBytes(32).toString("base64url");
    const name = CREATORS.find((c) => c.key === account)?.name || account;
    const { error } = await sb.from("public_share_links").insert({
      token,
      kind: "ads",
      client_key: account,
      label: `${name} creator ads view`,
    });
    if (error) throw error;

    return NextResponse.json({ token, url: publicUrl(token) });
  } catch (error) {
    console.error("[ads-tracker/share-link] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create share link." },
      { status: 500 }
    );
  }
}
