import { NextRequest, NextResponse } from "next/server";

// GHL v1 API for calendar events
const GHL_V1_BASE = "https://rest.gohighlevel.com/v1";

function getApiKey(): string {
  const key = process.env.GHL_V1_API_KEY;
  if (!key) throw new Error("GHL_V1_API_KEY not configured");
  return key;
}

function getCalendarIds(): string[] {
  const ids: string[] = [];

  const tysonId = process.env.GHL_CALENDAR_ID_TYSON;
  if (tysonId) ids.push(tysonId);

  const keithId = process.env.GHL_CALENDAR_ID_KEITH;
  if (keithId) ids.push(keithId);

  if (ids.length === 0) {
    throw new Error("No GHL calendar IDs configured (GHL_CALENDAR_ID_TYSON / GHL_CALENDAR_ID_KEITH)");
  }

  return ids;
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
    const apiKey = getApiKey();
    const calendarIds = getCalendarIds();

    // Fetch upcoming appointments for the next 7 days
    const now = new Date();
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const startDate = now.getTime();
    const endDate = sevenDaysOut.getTime();

    // Fetch from all calendars in parallel
    const results = await Promise.all(
      calendarIds.map(async (calendarId) => {
        const url = `${GHL_V1_BASE}/appointments/?calendarId=${calendarId}&startDate=${startDate}&endDate=${endDate}`;

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!res.ok) {
          const text = await res.text();
          console.error(`GHL upcoming appointments failed for calendar ${calendarId} (${res.status}): ${text}`);
          return [];
        }

        const data = await res.json();
        const appointments = data.appointments || data.events || data || [];

        if (!Array.isArray(appointments)) return [];

        return appointments.map((apt: Record<string, unknown>) => ({
          id: apt.id || apt._id || "",
          contactId: apt.contactId || apt.contact_id || "",
          calendarId: calendarId,
          title: apt.title || apt.name || "",
          startTime: apt.startTime || apt.start_time || apt.selectedTimezone || "",
          endTime: apt.endTime || apt.end_time || "",
          status: apt.status || apt.appointmentStatus || "",
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
