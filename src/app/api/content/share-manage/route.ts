import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrl(req: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

// Operator-only management of creator share links (list / mint / rotate / revoke).
export async function GET(req: NextRequest) {
  const s = await auth().catch(() => null);
  if (!s?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceSupabase();
  const base = baseUrl(req);
  const out: Record<string, { token: string; url: string } | null> = {};
  for (const c of CONTENT_CREATORS) {
    const { data } = await sb.from("public_share_links").select("token").eq("kind", "content").eq("client_key", c).eq("revoked", false).order("created_at", { ascending: false }).limit(1);
    out[c] = data && data[0] ? { token: (data[0] as { token: string }).token, url: `${base}/p/content/${(data[0] as { token: string }).token}` } : null;
  }
  return NextResponse.json({ links: out });
}

export async function POST(req: NextRequest) {
  const s = await auth().catch(() => null);
  if (!s?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const creator = String(body?.creator || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  const sb = getServiceSupabase();
  const base = baseUrl(req);

  if (action === "revoke" || action === "rotate") {
    await sb.from("public_share_links").update({ revoked: true }).eq("kind", "content").eq("client_key", creator).eq("revoked", false);
    if (action === "revoke") return NextResponse.json({ ok: true, link: null });
  }
  if (action === "mint" || action === "rotate") {
    const token = randomUUID().replace(/-/g, "");
    const { error } = await sb.from("public_share_links").insert({ token, kind: "content", client_key: creator, revoked: false });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, link: { token, url: `${base}/p/content/${token}` } });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
