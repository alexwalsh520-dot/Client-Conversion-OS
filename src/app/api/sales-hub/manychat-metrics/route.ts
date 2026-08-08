import { NextRequest, NextResponse } from "next/server";
import { getMetrics } from "@/lib/manychat";
import { getActiveClients } from "@/lib/registry";

// Long-form ManyChat keys for clients that predate the registry, so historical
// timelines (e.g. July showing Antwan) still resolve their DM metrics.
const LEGACY_MANYCHAT_KEYS: Record<string, string> = {
  tyson: "tyson_sonnek",
  keith: "keith_holland",
  lucy: "lucy_hubbard",
  antwan: "antwan_rarcus",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const client = (searchParams.get("client") || "").trim().toLowerCase();
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (!client) {
    return NextResponse.json({ error: "client is required" }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "dateFrom and dateTo required" }, { status: 400 });
  }

  try {
    // Resolve the short client key to its ManyChat key via the live registry,
    // falling back to the legacy static map. Clients with no ManyChat pipeline
    // 404 (the Sales Hub treats that as "no DM metrics" and moves on).
    const actives = await getActiveClients().catch(() => []);
    const clientKey =
      actives.find((c) => c.key === client)?.manychatKey ||
      LEGACY_MANYCHAT_KEYS[client] ||
      null;
    if (!clientKey) {
      return NextResponse.json(
        { error: `No ManyChat pipeline configured for client "${client}"` },
        { status: 404 },
      );
    }
    const metrics = await getMetrics(clientKey, dateFrom, dateTo);
    return NextResponse.json(metrics);
  } catch (err) {
    console.error("Manychat metrics error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch Manychat metrics" },
      { status: 500 }
    );
  }
}
