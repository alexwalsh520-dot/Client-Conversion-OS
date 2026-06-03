import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchSheetData, fetchSubscriptionsSold, SheetRow } from "@/lib/google-sheets";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const client = searchParams.get("client"); // optional — filters by Offer column

  if (!dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "dateFrom and dateTo query params are required" },
      { status: 400 }
    );
  }

  try {
    const [allRows, subscriptionsSold] = await Promise.all([
      fetchSheetData(dateFrom, dateTo),
      fetchSubscriptionsSold(dateFrom, dateTo),
    ]);
    const callRows = allRows.filter((row) => row.programLength !== "Subscription");
    const unattributedRows = callRows.filter((row) => !row.offer.trim()).length;

    let rows: SheetRow[] = callRows;

    // Optionally filter by client (maps to the Offer column)
    if (client) {
      const clientLower = client.toLowerCase();
      rows = rows.filter((row) => {
        const offerLower = row.offer.toLowerCase();
        if (clientLower === "tyson" || clientLower === "tyson sonnek" || clientLower === "sonic") {
          return offerLower.includes("tyson") || offerLower.includes("sonic");
        }
        if (clientLower === "keith" || clientLower === "keith holland") return offerLower.includes("keith");
        if (clientLower === "lucy" || clientLower === "lucy hubbard") {
          return offerLower.includes("lucy") || offerLower.includes("hubbard");
        }
        return offerLower.includes(clientLower);
      });
    }

    return NextResponse.json({ rows, subscriptionsSold, unattributedRows });
  } catch (err) {
    console.error("Sheet data error:", err);
    return NextResponse.json(
      {
        rows: [],
        subscriptionsSold: 0,
        unattributedRows: 0,
        error: err instanceof Error ? err.message : "Failed to fetch sheet data",
      },
      { status: 500 }
    );
  }
}
