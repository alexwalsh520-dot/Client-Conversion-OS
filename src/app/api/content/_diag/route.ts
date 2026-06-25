// TEMPORARY diagnostic — proves whether each creator's CCOS Instagram-connection token
// is valid by calling the exact endpoint the app already uses (/{ig_id}?fields=username).
// Returns the RAW Meta response. Remove after diagnosing.
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getDecryptedTokenForClient } from "@/lib/instagram-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || bearer !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const version = process.env.META_GRAPH_VERSION?.trim() || "v24.0";
  const sb = getServiceSupabase();
  const out: Record<string, unknown> = { version };

  for (const slug of ["tyson", "antwan"]) {
    const { data: conn } = await sb
      .from("instagram_connections")
      .select("client_key, instagram_user_id, updated_at, token_expires_at")
      .eq("client_slug", slug)
      .maybeSingle();
    const token = conn ? await getDecryptedTokenForClient(conn.client_key as string) : null;
    const probe: Record<string, unknown> = {
      ig_user_id: conn?.instagram_user_id,
      updated_at: conn?.updated_at,
      token_expires_at: conn?.token_expires_at,
      token_present: !!token,
      token_len: token ? token.length : 0,
      token_prefix: token ? token.slice(0, 4) : null,
    };
    if (token && conn?.instagram_user_id) {
      try {
        const r = await fetch(
          `https://graph.instagram.com/${version}/${conn.instagram_user_id}?fields=username,account_type&access_token=${token}`,
          { cache: "no-store" }
        );
        probe.username_call = await r.json();
      } catch (e) {
        probe.username_call = { fetchError: e instanceof Error ? e.message : String(e) };
      }
    }
    out[slug] = probe;
  }
  return NextResponse.json(out);
}
