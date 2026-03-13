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

interface GHLAppointment {
  id: string;
  contactId: string;
  calendarId: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
}

export async function GET(_req: NextRequest) {
  try {
    const headers = getHeaders();
    const locationId = getLocationId();

    // Fetch upcoming appointments for the next 7 days
    const now = new Date();
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const startTime = now.toISOString();
    const endTime = sevenDaysOut.toISOString();

    // First get all calendars
    const calRes = await fetch(`${GHL_V2_BASE}/calendars/?locationId=${locationId}`, { headers });
    if (!calRes.ok) {
      const text = await calRes.text();
      throw new Error(`GHL calendars list failed (${calRes.status}): ${text}`);
    }
    const calData = await calRes.json();
    const calendars = calData.calendars || [];

    // Fetch events from all calendars in parallel
    const results = await Promise.all(
      calendars.map(async (cal: { id: string; name: string }) => {
        const url = `${GHL_V2_BASE}/calendars/events?locationId=${locationId}&calendarId=${cal.id}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;

        const res = await fetch(url, { headers });

        if (!res.ok) {
          console.error(`GHL upcoming events failed for calendar ${cal.name} (${res.status})`);
          return [];
        }

        const data = await res.json();
        const events = data.events || data.data || data || [];

        if (!Array.isArray(events)) return [];

        return events.map((evt: Record<string, unknown>) => ({
          id: evt.id || evt._id || "",
          contactId: evt.contactId || evt.contact_id || "",
          calendarId: cal.id,
          title: evt.title || evt.name || "",
          startTime: evt.startTime || evt.start_time || "",
          endTime: evt.endTime || evt.end_time || "",
          status: evt.status || evt.appointmentStatus || "",
        })) as GHLAppointment[];
      })
    );

    const appointments = results.flat();

    // Sort by start time ascending
    appointments.sort((a, b) => {
      const timeA = new Date(a.startTime).getTime() || 0;
      const timeB = new Date(b.startTime).getTime() || 0;
      return timeA - timeB;
    });

    return NextResponse.json({ appointments });
  } catch (err) {
    console.error("GHL upcoming appointments error:", err);
    return NextResponse.json(
      { appointments: [], error: err instanceof Error ? err.message : "Failed to fetch upcoming appointments" },
      { status: 500 }
    );
  }
}
