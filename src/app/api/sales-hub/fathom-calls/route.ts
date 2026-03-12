import { NextRequest, NextResponse } from "next/server";
import { listMeetings, FathomMeeting } from "@/lib/fathom";

// Known team member emails — anyone NOT in this set is a prospect
const TEAM_EMAILS = new Set([
  "matthew@clientconversion.io",
  "alex@clientconversion.io",
  "alexwalsh520@gmail.com",
  "brozee2019@gmail.com",
  "will@start2finishcoaching.com",
  "williamluke.buckley21@gmail.com",
  "austinrichard6@gmail.com",
  "austinr@gfpenterprises.com",
  "tysonnek29@gmail.com",
  "saeed16765@gmail.com",
  "keithholland35@gmail.com",
  "averyjfisk@gmail.com",
  "isaac@sendblue.com",
  // Setters
  "gideonadebowale11@gmail.com",
  "amaraedwin9@gmail.com",
  "umunnakelechi89@gmail.com",
  "nwosudebbie@gmail.com",
]);

// Internal meeting title patterns — never sales calls
const INTERNAL_TITLE_PATTERNS = [
  "sales team huddle",
  "c suite",
  "management",
  "setter connect",
  "training",
  "interview",
  "1:1",
  "huddle",
];

/**
 * A sales call must have at least one attendee who is NOT a known team member.
 * Also excludes meetings whose titles match known internal patterns.
 */
function isSalesCall(meeting: FathomMeeting): boolean {
  const titleLower = (meeting.title || "").toLowerCase();

  // Exclude internal meeting patterns
  for (const pattern of INTERNAL_TITLE_PATTERNS) {
    if (titleLower.includes(pattern)) return false;
  }

  // Must have at least one non-team attendee (i.e. a prospect)
  const invitees = meeting.calendar_invitees || [];
  const hasProspect = invitees.some(
    (a) => a.email && !TEAM_EMAILS.has(a.email.toLowerCase())
  );

  return hasProspect;
}

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

    // Filter to sales calls only — exclude team huddles, training, interviews, etc.
    meetings = meetings.filter(isSalesCall);

    // Optionally filter by closer name (checks title and calendar_invitees name/email)
    if (closer) {
      const closerLower = closer.toLowerCase();
      meetings = meetings.filter((meeting) => {
        // Check if closer name appears in meeting title
        if (meeting.title?.toLowerCase().includes(closerLower)) return true;

        // Check calendar invitees — match name or email prefix
        if (
          meeting.calendar_invitees?.some((a) => {
            const nameLower = (a.name || "").toLowerCase();
            const emailLower = (a.email || "").toLowerCase();
            return nameLower.includes(closerLower) || emailLower.includes(closerLower);
          })
        ) {
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
