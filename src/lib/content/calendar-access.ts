// One gate for every Calendar surface (read + write, operator + creator).
//
// The rule that matters: when a share token is used, the creator is derived FROM THE TOKEN and any
// client-supplied `creator` is ignored entirely. A creator holding Tyson's token therefore cannot
// read or write Antwan's calendar no matter what they put in the query string or body — the value
// is never even consulted on the token path. This mirrors /api/content/studio exactly.

import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";

export type CalendarAccess =
  | { ok: true; creator: string; viewer: "operator" | "creator" }
  | { ok: false; error: string; status: number };

async function creatorFromToken(token: string): Promise<string | null> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("public_share_links")
    .select("client_key, revoked, kind")
    .eq("token", token)
    .maybeSingle();
  const link = data as { client_key: string; revoked: boolean; kind: string } | null;
  if (!link || link.revoked || link.kind !== "content") return null;
  return String(link.client_key).toLowerCase();
}

/**
 * @param requestedCreator only honoured for operator/cron callers; ignored when a token is present.
 * @param allowCron        reads may authenticate with CRON_SECRET; writes should pass false.
 */
export async function resolveCalendarAccess(
  req: NextRequest,
  token: string | null,
  requestedCreator: string | null,
  allowCron = true,
): Promise<CalendarAccess> {
  // 1. Token path — the token alone decides the creator.
  if (token) {
    const creator = await creatorFromToken(token);
    if (!creator) return { ok: false, error: "Invalid or revoked link", status: 403 };
    if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
      return { ok: false, error: "Unknown creator", status: 400 };
    }
    return { ok: true, creator, viewer: "creator" };
  }

  // 2. Operator session (or cron secret for reads).
  const bearer = req.headers.get("authorization") || "";
  const cronOk = allowCron && !!process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronOk) {
    const s = await auth().catch(() => null);
    if (!s?.user) return { ok: false, error: "Unauthorized", status: 401 };
  }
  const creator = (requestedCreator || "tyson").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return { ok: false, error: "Unknown creator", status: 400 };
  }
  return { ok: true, creator, viewer: "operator" };
}

// Who to attribute a mark to, without leaking anything about the operator to creators.
export async function markedByLabel(viewer: "operator" | "creator"): Promise<string> {
  if (viewer === "creator") return "creator";
  const s = await auth().catch(() => null);
  return s?.user?.email || "operator";
}
