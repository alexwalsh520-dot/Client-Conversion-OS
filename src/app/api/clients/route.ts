/**
 * GET /api/clients — the active client (creator) registry for client-side
 * pickers (Sales Hub filter, Organic Keywords, Content, Ads Leaderboard…).
 * Pass ?all=1 to include retired clients (admin views of history).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getActiveClients, getRegistryClients } from "@/lib/registry";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const includeRetired = req.nextUrl.searchParams.get("all") === "1";
  const clients = includeRetired ? await getRegistryClients() : await getActiveClients();
  return NextResponse.json(
    {
      clients: clients.map((c) => ({
        key: c.key,
        name: c.name,
        manychatKey: c.manychatKey,
        igHandle: c.igHandle,
        status: c.status,
        onboardingPartnerId: c.onboardingPartnerId,
      })),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
