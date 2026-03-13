import { NextRequest, NextResponse } from "next/server";

// GHL v2 API for calendar events
const GHL_V2_BASE = "https://services.leadconnectorhq.com";

function getHeaders(): Record<string, string> {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) throw new Error("GHL_API_KEY not configured");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Version: "2021-04-15",
  };
}

function getLocationId(): string {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error("GHL_LOCATION_ID not configured");
  return id;
}

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
    const headers = getHeaders();
    const locationId = getLocationId();

    const startTime = `${dateFrom}T00:00:00Z`;
    const endTime = `${dateTo}T23:59:59Z`;

    // Get all calendars, then filter to the client's calendar
    const calRes = await fetch(`${GHL_V2_BASE}/calendars/?locationId=${locationId}`, { headers });
    if (!calRes.ok) {
      const text = await calRes.text();
      throw new Error(`GHL calendars list failed (${calRes.status}): ${text}`);
    }
    const calData = await calRes.json();
    const calendars = calData.calendars || [];

    // Try to match calendar by client name, or fall back to old calendar IDs
    const clientLower = client.toLowerCase();
    const matchingCalendars = calendars.filter((c: { name: string; id: string }) => {
      const nameLower = (c.name || "").toLowerCase();
      if (clientLower === "tyson") return nameLower.includes("tyson") || nameLower.includes("ts") || c.id === process.env.GHL_CALENDAR_ID_TYSON;
      if (clientLower === "keith") return nameLower.includes("keith") || nameLower.includes("kh") || c.id === process.env.GHL_CALENDAR_ID_KEITH;
      return false;
    });

    // If no matching calendars found, use all calendars
    const calToQuery = matchingCalendars.length > 0 ? matchingCalendars : calendars;

    let bookedCount = 0;

    for (const cal of calToQuery) {
      try {
        const url = `${GHL_V2_BASE}/calendars/events?locationId=${locationId}&calendarId=${cal.id}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
        const res = await fetch(url, { headers });
        if (!res.ok) continue;

        const data = await res.json();
        const events = data.events || data.data || data || [];
        if (!Array.isArray(events)) continue;

        // Count confirmed/booked appointments
        bookedCount += events.filter(
          (evt: { status?: string; appointmentStatus?: string }) => {
            const status = (evt.status || evt.appointmentStatus || "").toLowerCase();
            return status === "confirmed" || status === "booked" || status === "showed" || status === "new";
          }
        ).length;
      } catch {
        // skip failed calendars
      }
    }

    return NextResponse.json({ callsBooked: bookedCount });
  } catch (err) {
    console.error("GHL bookings error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch GHL bookings" },
      { status: 500 }
    );
  }
}
