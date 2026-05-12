/**
 * Daily Coacher: rolling client/coach message context.
 *
 * GET    → returns the latest 20 messages for the client (chronological,
 *          oldest first so the UI reads naturally top-to-bottom).
 * POST   → appends a new message. Body: { role: 'coach' | 'client', message }.
 *          We store every message (no FIFO delete); the "rolling 20" is a
 *          read-side LIMIT so we can re-window later without losing history.
 * DELETE → removes a single message by id. Body: { id }.
 *          Useful when the coach pastes the wrong thing or wants to clean up.
 *
 * Same auth model as the summary endpoint: any logged-in CCOS user.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 10;

function parseClientId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// ---------------------------------------------------------------------------
// GET: latest 20, chronological
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ clientId: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { clientId: clientIdRaw } = await ctx.params;
  const clientId = parseClientId(clientIdRaw);
  if (!clientId) {
    return NextResponse.json({ error: "invalid clientId" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("daily_coacher_live_messages")
    .select("id, role, message, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error(
      `[api/coaching/daily-coacher/${clientId}/live-messages GET] failed:`,
      error.message
    );
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: (data || []).reverse() });
}

// ---------------------------------------------------------------------------
// POST: append a message
// ---------------------------------------------------------------------------

interface PostBody {
  role?: string;
  message?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ clientId: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { clientId: clientIdRaw } = await ctx.params;
  const clientId = parseClientId(clientIdRaw);
  if (!clientId) {
    return NextResponse.json({ error: "invalid clientId" }, { status: 400 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const role = body.role;
  const message = body.message?.trim();
  if (role !== "coach" && role !== "client") {
    return NextResponse.json(
      { error: "role must be 'coach' or 'client'" },
      { status: 400 }
    );
  }
  if (!message) {
    return NextResponse.json(
      { error: "message is required" },
      { status: 400 }
    );
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("daily_coacher_live_messages")
    .insert({ client_id: clientId, role, message })
    .select("id, role, message, created_at")
    .single();

  if (error) {
    console.error(
      `[api/coaching/daily-coacher/${clientId}/live-messages POST] failed:`,
      error.message
    );
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: data });
}

// ---------------------------------------------------------------------------
// DELETE: remove one message by id
// ---------------------------------------------------------------------------

interface DeleteBody {
  id?: number;
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ clientId: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { clientId: clientIdRaw } = await ctx.params;
  const clientId = parseClientId(clientIdRaw);
  if (!clientId) {
    return NextResponse.json({ error: "invalid clientId" }, { status: 400 });
  }

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.id || !Number.isFinite(body.id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const db = getServiceSupabase();
  // Constrain delete to this client_id so a bad id can't reach into another
  // client's messages.
  const { error } = await db
    .from("daily_coacher_live_messages")
    .delete()
    .eq("id", body.id)
    .eq("client_id", clientId);

  if (error) {
    console.error(
      `[api/coaching/daily-coacher/${clientId}/live-messages DELETE] failed:`,
      error.message
    );
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
