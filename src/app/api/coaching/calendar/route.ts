// GET /api/coaching/calendar?date=YYYY-MM-DD
// Returns Nicole's onboarding calendar events for a given date.
// Used by the EOD form to pre-populate onboarding checkins.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchNicoleCalendarEvents,
  fetchNicoleCalendarRange,
} from "@/lib/google-calendar";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date"); // Single date
  const startDate = searchParams.get("start"); // Range start
  const endDate = searchParams.get("end"); // Range end

  try {
    if (startDate && endDate) {
      // Range mode: for the Onboarding tab upcoming view
      const events = await fetchNicoleCalendarRange(startDate, endDate);
      return NextResponse.json({ events });
    }

    if (date) {
      // Single date mode: for Nicole's EOD form
      const events = await fetchNicoleCalendarEvents(date);
      return NextResponse.json({ events });
    }

    // Default: today
    const today = new Date().toISOString().split("T")[0];
    const events = await fetchNicoleCalendarEvents(today);
    return NextResponse.json({ events });
  } catch (err) {
    console.error("[api/coaching/calendar] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch calendar" },
      { status: 500 }
    );
  }
}
