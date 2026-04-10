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

  try {
    const clientKey =
      client === "tyson"
        ? "tyson_sonnek"
        : client === "keith"
          ? "keith_holland"
          : "zoe_and_emily";
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
