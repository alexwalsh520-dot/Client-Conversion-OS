import { NextRequest, NextResponse } from "next/server";

// GHL v1 API for calendar events
const GHL_V1_BASE = "https://rest.gohighlevel.com/v1";

function getApiKey(): string {
  const key = process.env.GHL_V1_API_KEY;
  if (!key) throw new Error("GHL_V1_API_KEY not configured");
  return key;
}

function getCalendarId(client: "tyson" | "keith"): string {
  const id =
    client === "tyson"
      ? process.env.GHL_CALENDAR_ID_TYSON
      : process.env.GHL_CALENDAR_ID_KEITH;
  if (!id) throw new Error(`GHL_CALENDAR_ID_${client.toUpperCase()} not configured`);
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
    const calendarId = getCalendarId(client);
    const apiKey = getApiKey();

    // GHL v1 expects epoch milliseconds for dates
    const startDate = new Date(dateFrom).getTime();
    const endDate = new Date(dateTo + "T23:59:59Z").getTime();

    const url = `${GHL_V1_BASE}/appointments/?calendarId=${calendarId}&startDate=${startDate}&endDate=${endDate}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GHL calendar API failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    const appointments = data.appointments || data.events || data || [];

    // Count confirmed/booked appointments
    const bookedCount = Array.isArray(appointments)
      ? appointments.filter(
          (apt: { status?: string; appointmentStatus?: string }) =>
            apt.status === "confirmed" ||
            apt.status === "booked" ||
            apt.appointmentStatus === "confirmed" ||
            apt.appointmentStatus === "booked"
        ).length
      : 0;

    return NextResponse.json({ callsBooked: bookedCount });
  } catch (err) {
    console.error("GHL bookings error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch GHL bookings" },
      { status: 500 }
    );
  }
}
