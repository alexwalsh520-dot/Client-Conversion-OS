import { NextRequest, NextResponse } from "next/server";
import { fetchSheetData, SheetRow } from "@/lib/google-sheets";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const client = searchParams.get("client"); // optional — filters by Offer column (Q)

  if (!dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "dateFrom and dateTo query params are required" },
      { status: 400 }
    );
  }

  try {
    let rows: SheetRow[] = await fetchSheetData(dateFrom, dateTo);

    // Optionally filter by client (maps to the Offer column)
    if (client) {
      const clientLower = client.toLowerCase();
      rows = rows.filter((row) => {
        const offerLower = row.offer.toLowerCase();
        if (clientLower === "tyson") return offerLower.includes("tyson");
        if (clientLower === "keith") return offerLower.includes("keith");
        return offerLower.includes(clientLower);
      });
    }

    return NextResponse.json({ rows });
  } catch (err) {
    console.error("Sheet data error:", err);
    return NextResponse.json(
      { rows: [], error: err instanceof Error ? err.message : "Failed to fetch sheet data" },
      { status: 500 }
    );
  }
}
