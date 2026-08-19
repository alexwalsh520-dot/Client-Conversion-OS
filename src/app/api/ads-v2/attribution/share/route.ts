// ─────────────────────────────────────────────────────────────────────────
// OPERATOR share-link management for the Attribution workspace. ONE
// business-wide link (kind 'attribution', no client): the page it opens is
// the attribution panel alone — no login, no sidebar, no other tabs.
//   GET          the current link (if any)
//   POST mint    create (or return) the active link
//   POST rotate  revoke and mint fresh
//   POST revoke  revoke
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const KIND = "attribution";

function urlFor(req: NextRequest, token: string): string {
  return `${req.nextUrl.origin}/p/attribution/${token}`;
}

async function activeToken(): Promise<string | null> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("public_share_links")
    .select("token")
    .eq("kind", KIND)
    .eq("revoked", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.token || null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const token = await activeToken();
  return NextResponse.json({ url: token ? urlFor(req, token) : null });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const sb = getServiceSupabase();

  async function revokeActive() {
    await sb.from("public_share_links").update({ revoked: true }).eq("kind", KIND).eq("revoked", false);
  }

  async function mint(): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await sb.from("public_share_links").insert({
      token,
      kind: KIND,
      client_key: null,
      label: "Attribution workspace",
      revoked: false,
    });
    return token;
  }

  if (body.action === "revoke") {
    await revokeActive();
    return NextResponse.json({ ok: true, url: null });
  }
  if (body.action === "rotate") {
    await revokeActive();
    return NextResponse.json({ ok: true, url: urlFor(req, await mint()) });
  }
  if (body.action === "mint") {
    const token = (await activeToken()) || (await mint());
    return NextResponse.json({ ok: true, url: urlFor(req, token) });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
