// Operator-only: get-or-mint the public share link for a creator's Content view.
//   GET ?creator=tyson  ->  { token, url }  (a no-login /p/content/<token> page)
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { isCreatorKey, CREATORS } from "@/lib/creators";

export const dynamic = "force-dynamic";

const BASE_URL = "https://client-conversion-os.vercel.app";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const creator = (req.nextUrl.searchParams.get("creator") || "").toLowerCase();
  if (!isCreatorKey(creator) || !["tyson", "antwan"].includes(creator)) {
    return NextResponse.json({ error: "Pick a single active creator (Tyson or Antwan)." }, { status: 400 });
  }

  try {
    const sb = getServiceSupabase();
    const { data: existing } = await sb
      .from("public_share_links")
      .select("token")
      .eq("kind", "content")
      .eq("client_key", creator)
      .eq("revoked", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing?.token) {
      return NextResponse.json({ token: existing.token, url: `${BASE_URL}/p/content/${existing.token}` });
    }

    const token = randomBytes(32).toString("base64url");
    const name = CREATORS.find((c) => c.key === creator)?.name || creator;
    const { error } = await sb.from("public_share_links").insert({
      token,
      kind: "content",
      client_key: creator,
      label: `${name} content view`,
    });
    if (error) throw error;
    return NextResponse.json({ token, url: `${BASE_URL}/p/content/${token}` });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create share link." },
      { status: 500 }
    );
  }
}
