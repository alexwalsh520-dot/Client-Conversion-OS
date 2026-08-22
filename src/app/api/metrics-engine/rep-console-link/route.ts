// ─────────────────────────────────────────────────────────────────────────
// OPERATOR share-link management for the rep console (auth-gated; NOT on
// the public allow-list). Links live in public_share_links, kind
// 'rep-console', one active link per client:
//   GET                       list the current link (if any) per client
//   POST mint                 create (get-or-mint) a link for a client;
//                             optional {settings} applied on a fresh mint
//   POST rotate               revoke the current link and mint a fresh one
//   POST revoke               revoke the current link
//   POST update-settings      change settings on the active link
//
// Token settings (see migration 113):
//   can_edit: boolean-ish  → the console accepts manual entries (default OFF;
//                            the console launches view-only)
//   rep_key: string | null → scope the appointment list to one rep
//                            (null = all reps; the owner's testing token)
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { ACTIVE_CREATORS, CREATORS_BY_KEY, type CreatorKey } from "@/lib/creators";
import { isRepKey } from "@/lib/metrics-engine/team";
import { isMissingRelation } from "@/lib/metrics-engine/db";

export const dynamic = "force-dynamic";

const KIND = "rep-console";

const SERVED_CLIENTS: readonly CreatorKey[] = ACTIVE_CREATORS.map((c) => c.key);

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function urlFor(req: NextRequest, token: string): string {
  return `${req.nextUrl.origin}/p/rep-console/${token}`;
}

function isServed(client: string): client is CreatorKey {
  return (SERVED_CLIENTS as readonly string[]).includes(client);
}

interface LinkSettings {
  can_edit?: string;
  rep_key?: string;
}

/** Normalize a settings payload from the request body; rejects junk. */
function cleanSettings(raw: unknown): LinkSettings | { error: string } {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "settings must be an object" };
  const obj = raw as Record<string, unknown>;
  const out: LinkSettings = {};
  if (obj.can_edit !== undefined) {
    out.can_edit = obj.can_edit === true || obj.can_edit === "true" ? "true" : "false";
  }
  if (obj.rep_key !== undefined && obj.rep_key !== null && obj.rep_key !== "") {
    if (!isRepKey(obj.rep_key)) return { error: `Unknown rep_key: ${String(obj.rep_key)}` };
    out.rep_key = obj.rep_key;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("public_share_links")
    .select("client_key, token, revoked, created_at, settings")
    .eq("kind", KIND)
    .eq("revoked", false)
    .order("created_at", { ascending: false });

  if (error && !isMissingRelation(error)) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const activeByClient = new Map<string, { token: string; settings: LinkSettings }>();
  for (const row of data || []) {
    if (!activeByClient.has(row.client_key)) {
      activeByClient.set(row.client_key, {
        token: row.token,
        settings: (row.settings as LinkSettings) || {},
      });
    }
  }

  const links = SERVED_CLIENTS.map((key) => {
    const active = activeByClient.get(key) || null;
    return {
      clientKey: key,
      clientName: CREATORS_BY_KEY[key]?.name || key,
      token: active?.token ?? null,
      url: active ? urlFor(req, active.token) : null,
      can_edit: active?.settings?.can_edit === "true",
      rep_key: active?.settings?.rep_key ?? null,
    };
  });
  return NextResponse.json({ links });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    client?: string;
    settings?: unknown;
  };
  const action = body.action;
  const client = body.client;
  if (!client || !isServed(client)) {
    return NextResponse.json({ error: "Unknown client" }, { status: 400 });
  }
  const settings = cleanSettings(body.settings);
  if ("error" in settings && settings.error) {
    return NextResponse.json({ error: settings.error }, { status: 400 });
  }

  const sb = getServiceSupabase();

  async function revokeActive() {
    await sb
      .from("public_share_links")
      .update({ revoked: true })
      .eq("kind", KIND)
      .eq("client_key", client)
      .eq("revoked", false);
  }

  async function mint(): Promise<string> {
    const token = newToken();
    const { error } = await sb.from("public_share_links").insert({
      token,
      kind: KIND,
      client_key: client,
      label: `Rep console - ${CREATORS_BY_KEY[client as CreatorKey]?.name || client}`,
      revoked: false,
      settings: settings as Record<string, unknown>,
    });
    if (error) throw new Error(error.message);
    return token;
  }

  async function activeToken(): Promise<string | null> {
    const { data } = await sb
      .from("public_share_links")
      .select("token")
      .eq("kind", KIND)
      .eq("client_key", client)
      .eq("revoked", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.token ?? null;
  }

  try {
    if (action === "revoke") {
      await revokeActive();
      return NextResponse.json({ ok: true });
    }

    if (action === "rotate") {
      await revokeActive();
      const token = await mint();
      return NextResponse.json({ ok: true, url: urlFor(req, token) });
    }

    if (action === "mint") {
      // Get-or-mint: reuse the active link if one exists (its settings are
      // left alone — use update-settings to change them).
      const existing = await activeToken();
      const token = existing || (await mint());
      return NextResponse.json({ ok: true, url: urlFor(req, token) });
    }

    if (action === "update-settings") {
      const token = await activeToken();
      if (!token) {
        return NextResponse.json({ error: "No active link for this client" }, { status: 404 });
      }
      const { error } = await sb
        .from("public_share_links")
        .update({ settings: settings as Record<string, unknown> })
        .eq("kind", KIND)
        .eq("token", token);
      if (error) throw new Error(error.message);
      return NextResponse.json({
        ok: true,
        url: urlFor(req, token),
        can_edit: (settings as LinkSettings).can_edit === "true",
        rep_key: (settings as LinkSettings).rep_key ?? null,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "share-link operation failed";
    // A missing settings column means 113 hasn't been pasted yet.
    if (isMissingRelation({ message })) {
      return NextResponse.json(
        { error: "Migration 113 not applied yet (public_share_links.settings missing).", migration_pending: true },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
