import { NextRequest, NextResponse } from "next/server";
import { countSubscriptionSales } from "@/lib/stripe-client";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const client = searchParams.get("client") as "tyson" | "keith";
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (!client || !["tyson", "keith"].includes(client)) {
    return NextResponse.json({ error: "Invalid client" }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "dateFrom and dateTo required" }, { status: 400 });
  }

  try {
    const count = await countSubscriptionSales(client, dateFrom, dateTo);
    return NextResponse.json({ subscriptionsSold: count });
  } catch (err) {
    console.error("Stripe sales error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch Stripe sales" },
      { status: 500 }
    );
  }
}
