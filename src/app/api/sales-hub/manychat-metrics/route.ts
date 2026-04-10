import { NextRequest, NextResponse } from "next/server";
import { getMetrics } from "@/lib/manychat";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const client = searchParams.get("client") as "tyson" | "keith" | "zoeEmily";
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (!client || !["tyson", "keith", "zoeEmily"].includes(client)) {
    return NextResponse.json({ error: "Invalid client" }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "dateFrom and dateTo required" }, { status: 400 });
  }

  if (client === "zoeEmily") {
    return NextResponse.json({
      dashboard: {
        newLeads: 0,
        leadsEngaged: 0,
        callLinksSent: 0,
        subLinksSent: 0,
      },
      setters: {},
      tagsDetected: false,
    });
  }

  try {
    const metrics = await getMetrics(client, dateFrom, dateTo);
    return NextResponse.json(metrics);
  } catch (err) {
    console.error("Manychat metrics error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch Manychat metrics" },
      { status: 500 }
    );
  }
}
