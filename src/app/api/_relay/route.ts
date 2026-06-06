// TEMPORARY one-off launch relay — injects Lucy's (sensitive) Meta token server-side so a local
// operator can drive a Graph API ad launch WITHOUT ever reading the token. Guarded by CRON_SECRET.
// Created to launch Lucy's 6/5 ads; DELETE this route + its commit right after the launch.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GRAPH = "https://graph.facebook.com/v21.0";
const TOK = () => process.env.META_ACCESS_TOKEN_LUCY_HUBBARD || "";
const ACCT = () => process.env.META_AD_ACCOUNT_LUCY_HUBBARD || "";

function authed(req: NextRequest): boolean {
  const s = req.headers.get("x-relay-secret") || "";
  const exp = process.env.LAUNCH_RELAY_SECRET || process.env.CRON_SECRET || "";
  return exp.length > 8 && s === exp;
}
const withAcct = (p: string) => p.replace("__ACCT__", "act_" + ACCT());

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  if (sp.get("op") === "whoami") {
    const me = await (await fetch(`${GRAPH}/me?fields=name&access_token=${TOK()}`)).json();
    return NextResponse.json({ account: "act_" + ACCT(), tokenLen: TOK().length, me });
  }
  const u = new URL(`${GRAPH}/${withAcct(sp.get("path") || "")}`);
  for (const k of ["fields", "limit", "date_preset", "effective_status"]) { const v = sp.get(k); if (v) u.searchParams.set(k, v); }
  u.searchParams.set("access_token", TOK());
  const r = await fetch(u);
  return NextResponse.json({ status: r.status, data: await r.json() });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const op = new URL(req.url).searchParams.get("op");

  if (op === "adimage") {
    const { url } = await req.json();
    const img = await fetch(url);
    if (!img.ok) return NextResponse.json({ error: "image fetch failed", status: img.status }, { status: 400 });
    const buf = Buffer.from(await img.arrayBuffer());
    const fd = new FormData();
    fd.append("filename", new Blob([new Uint8Array(buf)], { type: "image/png" }), "img.png");
    fd.append("access_token", TOK());
    const r = await fetch(`${GRAPH}/act_${ACCT()}/adimages`, { method: "POST", body: fd });
    return NextResponse.json({ status: r.status, data: await r.json() });
  }

  // op=graph (default): { path, method, form }
  const body = await req.json();
  const path = withAcct(String(body.path || ""));
  const method = (body.method || "POST").toUpperCase();
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body.form || {})) form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  form.set("access_token", TOK());
  const r = await fetch(`${GRAPH}/${path}`, {
    method,
    body: method === "GET" ? undefined : form,
    headers: method === "GET" ? undefined : { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return NextResponse.json({ status: r.status, data: await r.json() });
}
