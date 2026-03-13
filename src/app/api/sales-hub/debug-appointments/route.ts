import { NextResponse } from "next/server";

// Debug endpoint to test GHL appointment fetching
// DELETE after debugging

const GHL_V1_BASE = "https://rest.gohighlevel.com/v1";
const GHL_V2_BASE = "https://services.leadconnectorhq.com";

export async function GET() {
  const results: Record<string, unknown> = {};

  // Get today's date range in EST
  const now = new Date();
  const estStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const estDate = new Date(estStr);
  const todayStr = `${estDate.getFullYear()}-${String(estDate.getMonth() + 1).padStart(2, "0")}-${String(estDate.getDate()).padStart(2, "0")}`;

  results.debug = {
    serverTime: now.toISOString(),
    estTime: estStr,
    todayStr,
  };

  // ── V1 API: Try fetching with calendar IDs ──
  const v1ApiKey = process.env.GHL_V1_API_KEY;
  const calendarIdTyson = process.env.GHL_CALENDAR_ID_TYSON;
  const calendarIdKeith = process.env.GHL_CALENDAR_ID_KEITH;

  if (v1ApiKey) {
    // Try with epoch ms (current approach)
    const startOfDay = new Date(`${todayStr}T00:00:00-05:00`).getTime();
    const endOfDay = new Date(`${todayStr}T23:59:59-05:00`).getTime();

    results.v1_params = { startOfDay, endOfDay, calendarIdTyson, calendarIdKeith };

    for (const [label, calId] of [["tyson", calendarIdTyson], ["keith", calendarIdKeith]]) {
      if (!calId) { results[`v1_${label}`] = "no calendar ID"; continue; }
      try {
        const url = `${GHL_V1_BASE}/appointments/?calendarId=${calId}&startDate=${startOfDay}&endDate=${endOfDay}`;
        results[`v1_${label}_url`] = url;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${v1ApiKey}` } });
        const text = await res.text();
        results[`v1_${label}_status`] = res.status;
        try { results[`v1_${label}_data`] = JSON.parse(text); } catch { results[`v1_${label}_data`] = text.substring(0, 500); }
      } catch (err) {
        results[`v1_${label}_error`] = String(err);
      }
    }

    // Also try V1 /calendars/ to list available calendars
    try {
      const res = await fetch(`${GHL_V1_BASE}/calendars/`, {
        headers: { Authorization: `Bearer ${v1ApiKey}` },
      });
      const text = await res.text();
      results.v1_calendars_status = res.status;
      try { results.v1_calendars = JSON.parse(text); } catch { results.v1_calendars = text.substring(0, 1000); }
    } catch (err) {
      results.v1_calendars_error = String(err);
    }
  } else {
    results.v1 = "GHL_V1_API_KEY not set";
  }

  // ── V2 API: Try fetching calendar events ──
  const v2ApiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (v2ApiKey && locationId) {
    const v2Headers = {
      Authorization: `Bearer ${v2ApiKey}`,
      "Content-Type": "application/json",
      Version: "2021-04-15",
    };

    // Try /calendars/events endpoint
    try {
      const startTime = `${todayStr}T00:00:00-05:00`;
      const endTime = `${todayStr}T23:59:59-05:00`;
      const url = `${GHL_V2_BASE}/calendars/events?locationId=${locationId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
      results.v2_events_url = url;
      const res = await fetch(url, { headers: v2Headers });
      const text = await res.text();
      results.v2_events_status = res.status;
      try { results.v2_events = JSON.parse(text); } catch { results.v2_events = text.substring(0, 2000); }
    } catch (err) {
      results.v2_events_error = String(err);
    }

    // List calendars via V2
    try {
      const url = `${GHL_V2_BASE}/calendars/?locationId=${locationId}`;
      const res = await fetch(url, { headers: v2Headers });
      const text = await res.text();
      results.v2_calendars_status = res.status;
      try {
        const parsed = JSON.parse(text);
        // Only show calendar names and IDs to keep response manageable
        if (parsed.calendars) {
          results.v2_calendars = parsed.calendars.map((c: Record<string, unknown>) => ({
            id: c.id, name: c.name, description: c.description,
          }));
        } else {
          results.v2_calendars = parsed;
        }
      } catch { results.v2_calendars = text.substring(0, 1000); }
    } catch (err) {
      results.v2_calendars_error = String(err);
    }

    // List users via V2
    try {
      const url = `${GHL_V2_BASE}/users/?locationId=${locationId}`;
      const res = await fetch(url, { headers: v2Headers });
      const text = await res.text();
      results.v2_users_status = res.status;
      try {
        const parsed = JSON.parse(text);
        if (parsed.users) {
          results.v2_users = parsed.users.map((u: Record<string, unknown>) => ({
            id: u.id, name: u.name, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role,
          }));
        } else {
          results.v2_users = parsed;
        }
      } catch { results.v2_users = text.substring(0, 1000); }
    } catch (err) {
      results.v2_users_error = String(err);
    }
  } else {
    results.v2 = "GHL_API_KEY or GHL_LOCATION_ID not set";
  }

  return NextResponse.json(results, { status: 200 });
}
