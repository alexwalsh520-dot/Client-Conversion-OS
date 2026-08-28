// Operator-only: get-or-mint the public business-dashboard link for a client.
//
// This route is auth-gated (it is NOT on the api/public allow-list in proxy.ts),
// so only a logged-in operator can mint, rotate, or revoke a token. The PUBLIC
// surface that actually serves data is /api/public/client-dashboard/<token>;
// this just hands the operator the URL to send the client.
//
//   GET ?client=jake              -> { token, url } (reuses a live link, else mints)
//   GET ?client=jake&rotate=1     -> revokes any live links and mints a fresh one
//   GET ?client=jake&revoke=1     -> revokes any live links, returns { revoked: n }
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { isCreatorKey, CREATORS } from "@/lib/creators";

export const dynamic = "force-dynamic";

const BASE_URL = "https://client-conversion-os.vercel.app";
const KIND = "client-dashboard";

function publicUrl(token: string) {
  return `${BASE_URL}/p/client-dashboard/${token}`;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = (req.nextUrl.searchParams.get("client") || "").toLowerCase();
  const rotate = req.nextUrl.searchParams.get("rotate") === "1";
  const revoke = req.nextUrl.searchParams.get("revoke") === "1";

  if (!isCreatorKey(client)) {
    return NextResponse.json(
      { error: "Pass ?client=<key> — a dashboard link is always for exactly one client." },
      { status: 400 },
    );
  }

  try {
    const sb = getServiceSupabase();

    if (rotate || revoke) {
      const { data: killed, error: revokeError } = await sb
        .from("public_share_links")
        .update({ revoked: true })
        .eq("kind", KIND)
        .eq("client_key", client)
        .eq("revoked", false)
        .select("token");
      if (revokeError) throw revokeError;
      if (revoke) return NextResponse.json({ revoked: killed?.length ?? 0 });
    } else {
      // Reuse an existing live link for this client if one exists.
      const { data: existing } = await sb
        .from("public_share_links")
        .select("token")
        .eq("kind", KIND)
        .eq("client_key", client)
        .eq("revoked", false)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existing?.token) {
        return NextResponse.json({ token: existing.token, url: publicUrl(existing.token) });
      }
    }

    // Mint a fresh, unguessable token.
    const token = randomBytes(32).toString("base64url");
    const name = CREATORS.find((c) => c.key === client)?.name || client;
    const { error } = await sb.from("public_share_links").insert({
      token,
      kind: KIND,
      client_key: client,
      label: `${name} business dashboard`,
    });
    if (error) throw error;

    return NextResponse.json({ token, url: publicUrl(token) });
  } catch (error) {
    console.error("[client-dashboard/share-link] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create share link." },
      { status: 500 },
    );
  }
}
