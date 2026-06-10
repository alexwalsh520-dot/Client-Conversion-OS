import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLeadHours } from "@/lib/sales-hub/lead-hours";
import type { SalesHubClient } from "@/lib/sales-hub/response-times";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const cronSecret = process.env.CRON_SECRET?.trim();
  const secretOk = Boolean(cronSecret) && searchParams.get("secret") === cronSecret;
  if (!secretOk) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const client = (searchParams.get("client") || "all") as SalesHubClient;
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (!["all", "tyson", "antwan"].includes(client)) {
    return NextResponse.json({ error: "Invalid client" }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "dateFrom and dateTo query params are required" },
      { status: 400 },
    );
  }

  try {
    const data = await getLeadHours({ client, dateFrom, dateTo });
    return NextResponse.json(data);
  } catch (err) {
    console.error("Leads-by-hour error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load leads by hour" },
      { status: 500 },
    );
  }
}
