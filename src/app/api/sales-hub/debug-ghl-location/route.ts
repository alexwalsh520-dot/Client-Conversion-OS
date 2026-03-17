import { NextResponse } from "next/server";

/**
 * GHL Location Discovery — finds the correct location ID for the PIT key.
 * Tries multiple API endpoints and version headers to discover accessible locations.
 */

const GHL_BASE = "https://services.leadconnectorhq.com";

const API_VERSIONS = ["2021-07-28", "2021-04-15"];

export async function GET() {
  const apiKey = process.env.GHL_API_KEY;
  const currentLocationId = process.env.GHL_LOCATION_ID;

  if (!apiKey) {
    return NextResponse.json({ error: "GHL_API_KEY not set" }, { status: 500 });
  }

  const results: Record<string, unknown> = {
    currentLocationId,
    keyPrefix: apiKey.substring(0, 15) + "...",
    timestamp: new Date().toISOString(),
  };

  // Try each API version
  for (const version of API_VERSIONS) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Version: version,
    };

    const vKey = `v_${version}`;
    results[vKey] = {};
    const vResults = results[vKey] as Record<string, unknown>;

    // 1. Try GET /locations/search
    try {
      const res = await fetch(`${GHL_BASE}/locations/search`, { headers });
      vResults.locations_search_status = res.status;
      if (res.ok) {
        const data = await res.json();
        vResults.locations_search = data;
      } else {
        const text = await res.text();
        vResults.locations_search_body = text.substring(0, 500);
      }
    } catch (err) {
      vResults.locations_search_error = String(err);
    }

    // 2. Try GET /locations/ (list all)
    try {
      const res = await fetch(`${GHL_BASE}/locations/`, { headers });
      vResults.locations_list_status = res.status;
      if (res.ok) {
        const data = await res.json();
        vResults.locations_list = data;
      } else {
        const text = await res.text();
        vResults.locations_list_body = text.substring(0, 500);
      }
    } catch (err) {
      vResults.locations_list_error = String(err);
    }

    // 3. Try GET /locations/{currentLocationId}
    if (currentLocationId) {
      try {
        const res = await fetch(`${GHL_BASE}/locations/${currentLocationId}`, { headers });
        vResults.current_location_status = res.status;
        if (res.ok) {
          const data = await res.json();
          vResults.current_location = {
            id: data.location?.id || data.id,
            name: data.location?.name || data.name,
            email: data.location?.email || data.email,
          };
        } else {
          const text = await res.text();
          vResults.current_location_body = text.substring(0, 500);
        }
      } catch (err) {
        vResults.current_location_error = String(err);
      }
    }

    // 4. Try GET /companies/ (agency-level endpoint)
    try {
      const res = await fetch(`${GHL_BASE}/companies/`, { headers });
      vResults.companies_status = res.status;
      if (res.ok) {
        const data = await res.json();
        vResults.companies = data;
      }
    } catch (err) {
      vResults.companies_error = String(err);
    }

    // 5. Try fetching calendars with current locationId
    if (currentLocationId) {
      try {
        const res = await fetch(`${GHL_BASE}/calendars/?locationId=${currentLocationId}`, { headers });
        vResults.calendars_status = res.status;
        if (res.ok) {
          const data = await res.json();
          const cals = data.calendars || [];
          vResults.calendars = cals.map((c: { id: string; name: string }) => ({
            id: c.id,
            name: c.name,
          }));
          vResults.calendars_count = cals.length;
        } else {
          const text = await res.text();
          vResults.calendars_body = text.substring(0, 500);
        }
      } catch (err) {
        vResults.calendars_error = String(err);
      }
    }

    // 6. Try fetching users with current locationId
    if (currentLocationId) {
      try {
        const res = await fetch(`${GHL_BASE}/users/?locationId=${currentLocationId}`, { headers });
        vResults.users_status = res.status;
        if (res.ok) {
          const data = await res.json();
          const users = data.users || [];
          vResults.users = users.map((u: { id: string; name: string; email: string }) => ({
            id: u.id,
            name: u.name,
            email: u.email,
          }));
          vResults.users_count = users.length;
        } else {
          const text = await res.text();
          vResults.users_body = text.substring(0, 500);
        }
      } catch (err) {
        vResults.users_error = String(err);
      }
    }

    // 7. Try getting the token's own location via self-discovery
    try {
      const res = await fetch(`${GHL_BASE}/oauth/locationToken`, {
        method: "POST",
        headers,
        body: JSON.stringify({ companyId: currentLocationId }),
      });
      vResults.oauth_location_status = res.status;
      if (res.ok) {
        const data = await res.json();
        vResults.oauth_location = data;
      }
    } catch (err) {
      vResults.oauth_location_error = String(err);
    }
  }

  return NextResponse.json(results, { status: 200 });
}
