/**
 * GET /api/coaching-v2/client/:id — the peek drawer's data. Same read model
 * as the pages, trimmed to what the drawer shows. Gated the same way the
 * pages are (signed in, and a coach only sees their own clients).
 */
import { NextRequest, NextResponse } from "next/server";
import { loadHub, serializeClient } from "@/lib/coaching-v2/hub";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const hub = await loadHub();
  if (!hub) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const c = hub.clients.find((x) => x.id === Number(id));
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ client: serializeClient(c) });
}
