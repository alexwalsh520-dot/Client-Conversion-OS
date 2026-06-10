import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getResponseTimeMetrics,
  type SalesHubClient,
} from "@/lib/sales-hub/response-times";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
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
    const metrics = await getResponseTimeMetrics({ client, dateFrom, dateTo });
    return NextResponse.json(metrics);
  } catch (err) {
    console.error("Response time metrics error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load response time metrics",
      },
      { status: 500 },
    );
  }
}

