import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CREATORS_BY_KEY, firstEnv, isCreatorKey } from "@/lib/creators";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";

// ─────────────────────────────────────────────────────────────────────────
// ADS V2 ON/OFF TOGGLE — turns a campaign, ad set, or ad on or off in Meta.
//
// Reliability rules (in order of importance):
//   1. Never trust the write. After the POST, the entity is read back from the
//      Graph API and the read-back is what we return and what the UI shows.
//   2. Every attempt is logged to adsv2_toggle_log, success or failure, with
//      who did it and what Meta said afterwards.
//   3. Inputs are whitelisted hard: served creators only, three entity levels,
//      two statuses, numeric entity ids. Anything else is a 400 before any
//      Meta call happens.
//   4. Both Meta calls carry a hard timeout so a hung request can never leave
//      the UI spinning forever.
// ─────────────────────────────────────────────────────────────────────────

const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 15000;

async function graphFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = session.user.email || "unknown";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { clientKey, level, entityId, desired } = (body || {}) as {
    clientKey?: string;
    level?: string;
    entityId?: string;
    desired?: string;
  };

  // Hard whitelists. No Meta call happens unless every one passes.
  if (!isCreatorKey(clientKey) || !ADSV2_SERVED_CLIENTS.includes(clientKey)) {
    return NextResponse.json({ error: "Unknown client" }, { status: 400 });
  }
  if (level !== "campaign" && level !== "adset" && level !== "ad") {
    return NextResponse.json({ error: "Bad level" }, { status: 400 });
  }
  if (desired !== "ACTIVE" && desired !== "PAUSED") {
    return NextResponse.json({ error: "Bad status" }, { status: 400 });
  }
  if (!entityId || !/^\d{6,25}$/.test(entityId)) {
    return NextResponse.json({ error: "Bad entity id" }, { status: 400 });
  }

  const creator = CREATORS_BY_KEY[clientKey];
  const token = firstEnv(creator.tokenEnv);
  if (!token) {
    return NextResponse.json({ error: `No Meta token for ${clientKey}` }, { status: 500 });
  }

  const db = getServiceSupabase();
  const log: Record<string, unknown> = {
    actor_email: actor,
    client_key: clientKey,
    entity_level: level,
    entity_id: entityId,
    requested_status: desired,
    ok: false,
  };

  try {
    // Read the current state first, so the log carries before + after.
    const beforeRes = await graphFetch(
      `${GRAPH}/${entityId}?fields=status,effective_status,name&access_token=${encodeURIComponent(token)}`,
    );
    const before = (await beforeRes.json()) as {
      status?: string;
      effective_status?: string;
      name?: string;
      error?: { message?: string };
    };
    if (!beforeRes.ok || before.error) {
      throw new Error(`Meta read failed: ${before.error?.message || beforeRes.status}`);
    }
    log.prev_status = before.status || null;
    log.entity_name = before.name || null;

    // The write.
    const postRes = await graphFetch(`${GRAPH}/${entityId}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status: desired, access_token: token }),
    });
    const postJson = (await postRes.json()) as { success?: boolean; error?: { message?: string } };
    if (!postRes.ok || postJson.error) {
      throw new Error(`Meta write failed: ${postJson.error?.message || postRes.status}`);
    }

    // The read-back. This, not the write, is the truth we report.
    const afterRes = await graphFetch(
      `${GRAPH}/${entityId}?fields=status,effective_status,name&access_token=${encodeURIComponent(token)}`,
    );
    const after = (await afterRes.json()) as {
      status?: string;
      effective_status?: string;
      error?: { message?: string };
    };
    if (!afterRes.ok || after.error) {
      throw new Error(`Meta read-back failed: ${after.error?.message || afterRes.status}`);
    }
    log.readback_status = after.status || null;
    log.readback_effective_status = after.effective_status || null;

    // Success only when the read-back agrees with what was requested.
    const applied = (after.status || "").toUpperCase() === desired;
    log.ok = applied;
    if (!applied) log.error = `read-back says ${after.status}, requested ${desired}`;
    await db.from("adsv2_toggle_log").insert(log);

    return NextResponse.json({
      ok: applied,
      status: after.status || null,
      effectiveStatus: after.effective_status || null,
      name: before.name || null,
    });
  } catch (err) {
    log.error = err instanceof Error ? err.message : String(err);
    await db.from("adsv2_toggle_log").insert(log);
    return NextResponse.json({ ok: false, error: log.error }, { status: 502 });
  }
}
