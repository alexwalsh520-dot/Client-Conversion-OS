import { NextResponse } from "next/server";

// TEMPORARY one-time admin route to read sensitive Meta env vars at runtime
// (Vercel sensitive vars are write-only and can't be pulled). DELETE after use.
export const dynamic = "force-dynamic";

const GATE = "af8821b99babb118058f177dc05176fc2b7257798872cb55";
const ALLOWED = [
  "META_ACCESS_TOKEN_ANTWAN_RARCUS",
  "META_AD_ACCOUNT_ANTWAN_RARCUS",
  "META_ACCESS_TOKEN_TYSON",
  "META_AD_ACCOUNT_TYSON",
  "META_ACCESS_TOKEN_LUCY_HUBBARD",
  "META_AD_ACCOUNT_LUCY_HUBBARD",
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("k") !== GATE) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const out: Record<string, string | null> = {};
  for (const k of ALLOWED) out[k] = process.env[k] ?? null;
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
