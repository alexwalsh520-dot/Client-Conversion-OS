import { NextRequest, NextResponse } from "next/server";
import { listMeetings, FathomMeeting } from "@/lib/fathom";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const closer = searchParams.get("closer");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const includeTranscript = searchParams.get("includeTranscript") === "true";

  if (!process.env.FATHOM_API_KEY) {
    return NextResponse.json(
      { meetings: [], error: "FATHOM_API_KEY not configured — Fathom integration is disabled" },
      { status: 200 }
    );
  }

  try {
    let meetings: FathomMeeting[] = await listMeetings({
      createdAfter: dateFrom || undefined,
      createdBefore: dateTo ? `${dateTo}T23:59:59Z` : undefined,
      includeTranscript,
    });

    // Optionally filter by closer name (checks title and attendees)
    if (closer) {
      const closerLower = closer.toLowerCase();
      meetings = meetings.filter((meeting) => {
        // Check if closer name appears in meeting title
        if (meeting.title?.toLowerCase().includes(closerLower)) return true;

        // Check if closer is among attendees
        if (meeting.attendees?.some((a) => a.name?.toLowerCase().includes(closerLower))) {
          return true;
        }

        return false;
      });
    }

    return NextResponse.json({ meetings });
  } catch (err) {
    console.error("Fathom calls error:", err);
    return NextResponse.json(
      { meetings: [], error: err instanceof Error ? err.message : "Failed to fetch Fathom calls" },
      { status: 500 }
    );
  }
}
