import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Quick debug endpoint for GHL V2 API — DELETE after debugging
const GHL_V2_BASE = "https://services.leadconnectorhq.com";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  results.config = {
    keyPrefix: apiKey ? apiKey.substring(0, 15) + "..." : "NOT SET",
    locationId: locationId || "NOT SET",
  };

  if (!apiKey) {
    return NextResponse.json({ error: "GHL_API_KEY not set", results });
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Version: "2021-04-15",
  };

  // 1. Try to get location info
  if (locationId) {
    try {
      const res = await fetch(`${GHL_V2_BASE}/locations/${locationId}`, { headers });
      results.location_status = res.status;
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        results.location = res.ok
          ? { id: parsed.location?.id, name: parsed.location?.name }
          : parsed;
      } catch {
        results.location_raw = text.substring(0, 300);
      }
    } catch (err) {
      results.location_error = String(err);
    }
  }

  // 2. Try locations/search to find accessible locations
  try {
    const res = await fetch(`${GHL_V2_BASE}/locations/search`, { headers });
    results.locations_search_status = res.status;
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      if (parsed.locations) {
        results.accessible_locations = parsed.locations.map(
          (l: Record<string, unknown>) => ({ id: l.id, name: l.name })
        );
      } else {
        results.locations_search = parsed;
      }
    } catch {
      results.locations_search_raw = text.substring(0, 500);
    }
  } catch (err) {
    results.locations_search_error = String(err);
  }

  // 3. Try listing calendars (only if location works)
  if (locationId) {
    try {
      const res = await fetch(`${GHL_V2_BASE}/calendars/?locationId=${locationId}`, { headers });
      results.calendars_status = res.status;
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        if (parsed.calendars) {
          results.calendars = parsed.calendars.map(
            (c: Record<string, unknown>) => ({ id: c.id, name: c.name })
          );
        } else {
          results.calendars = parsed;
        }
      } catch {
        results.calendars_raw = text.substring(0, 500);
      }
    } catch (err) {
      results.calendars_error = String(err);
    }
  }

  // 4. Try listing users
  if (locationId) {
    try {
      const res = await fetch(`${GHL_V2_BASE}/users/?locationId=${locationId}`, { headers });
      results.users_status = res.status;
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        if (parsed.users) {
          results.users = parsed.users.map(
            (u: Record<string, unknown>) => ({
              id: u.id, name: u.name, firstName: u.firstName, lastName: u.lastName,
            })
          );
        } else {
          results.users = parsed;
        }
      } catch {
        results.users_raw = text.substring(0, 500);
      }
    } catch (err) {
      results.users_error = String(err);
    }
  }

  return NextResponse.json(results, { status: 200 });
}
