import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { postToSlack } from "@/lib/slack";

// GHL v1 API
const GHL_V1_BASE = "https://rest.gohighlevel.com/v1";

const PRE_CALL_BRIEF_SYSTEM_PROMPT = `You are a pre-call brief generator for a fitness coaching sales team. Given the data about a prospect, create a concise one-page brief that helps the closer go into the call prepared.

Format the brief as:

## [Prospect Name] — Pre-Call Brief
**Call Date:** [date/time]
**Closer:** [closer name]
**Client Offer:** [Tyson Sonnek / Keith Holland]
**Setter:** [who set this lead]

### Lead Temperature: [HOT / WARM / COLD]
[One sentence explaining why]

### Key Pain Points & Buying Signals
[Extract from DM conversation data and engagement signals. Be specific.]

### What Brought Them In
[The lead magnet/campaign that attracted them]

### Engagement Level
[How engaged were they in DMs? Quick replies? Detailed responses? Ghosted and came back?]

### Pricing Signals
[Any indication of budget from DMs]

### Potential Objections
[Based on patterns, what objections might come up? Money/Fear/Spouse/Timing?]

### Recommended Approach
[Specific advice for the closer based on this lead's profile. What to emphasize, what to avoid.]

Keep it concise and actionable. The closer should be able to read this in 60 seconds before the call.`;

function getGhlApiKey(): string {
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
  return ids;
}

export async function GET(req: NextRequest) {
  try {
    // Validate cron secret (Vercel sends this as Authorization header)
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.get("authorization");
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const ghlApiKey = getGhlApiKey();
    const calendarIds = getCalendarIds();

    if (calendarIds.length === 0) {
      return NextResponse.json({ generated: 0, error: "No GHL calendar IDs configured" });
    }

    // Fetch upcoming appointments in the next 2 hours
    const now = new Date();
    const twoHoursOut = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const startDate = now.getTime();
    const endDate = twoHoursOut.getTime();

    // Fetch appointments from all calendars
    const appointmentResults = await Promise.all(
      calendarIds.map(async (calendarId) => {
        const url = `${GHL_V1_BASE}/appointments/?calendarId=${calendarId}&startDate=${startDate}&endDate=${endDate}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${ghlApiKey}` },
        });

        if (!res.ok) {
          console.error(`[cron/pre-call-briefs] Failed to fetch calendar ${calendarId} (${res.status})`);
          return [];
        }

        const data = await res.json();
        const appointments = data.appointments || data.events || data || [];
        return Array.isArray(appointments) ? appointments : [];
      })
    );

    const allAppointments = appointmentResults.flat();

    if (allAppointments.length === 0) {
      return NextResponse.json({ generated: 0 });
    }

    const anthropic = new Anthropic({ apiKey });
    const slackChannel = process.env.SLACK_CHANNEL_PRE_CALL_BRIEFS || process.env.SLACK_CHANNEL_MARKETING;
    let generated = 0;

    for (const appointment of allAppointments) {
      const contactId = String(appointment.contactId || appointment.contact_id || "");
      let contact: Record<string, unknown> | null = null;

      // Fetch contact data
      if (contactId) {
        try {
          const contactRes = await fetch(`${GHL_V1_BASE}/contacts/${contactId}`, {
            headers: { Authorization: `Bearer ${ghlApiKey}` },
          });
          if (contactRes.ok) {
            const contactData = await contactRes.json();
            contact = contactData.contact || contactData;
          }
        } catch (err) {
          console.warn(`[cron/pre-call-briefs] Failed to fetch contact ${contactId}:`, err);
        }
      }

      const contactName = contact
        ? `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || String(contact.name || "Unknown")
        : String(appointment.title || "Unknown Prospect");

      const startTime = appointment.startTime || appointment.start_time || "";

      // Build context for brief generation
      const contextParts: string[] = [
        `Prospect Name: ${contactName}`,
        `Call Date: ${startTime}`,
        `Calendar ID: ${appointment.calendarId || appointment.calendar_id || ""}`,
      ];

      if (contact) {
        contextParts.push(`\n--- GHL Contact Data ---`);
        contextParts.push(`Email: ${contact.email || contact.emailAddress || "N/A"}`);
        contextParts.push(`Phone: ${contact.phone || contact.phoneNumber || "N/A"}`);
        if (contact.tags && Array.isArray(contact.tags)) {
          contextParts.push(`Tags: ${(contact.tags as string[]).join(", ")}`);
        }
        if (contact.source) contextParts.push(`Source: ${contact.source}`);
        if (contact.dateAdded) contextParts.push(`Date Added: ${contact.dateAdded}`);
      }

      try {
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system: PRE_CALL_BRIEF_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Generate a pre-call brief for this prospect:\n\n${contextParts.join("\n")}`,
            },
          ],
        });

        const brief = message.content
          .filter((block) => block.type === "text")
          .map((block) => {
            if (block.type === "text") return block.text;
            return "";
          })
          .join("\n");

        // Send to Slack if configured
        if (slackChannel) {
          await postToSlack(slackChannel, brief);
        }

        generated++;
      } catch (err) {
        console.error(`[cron/pre-call-briefs] Failed to generate brief for ${contactName}:`, err);
      }
    }

    return NextResponse.json({ generated });
  } catch (err) {
    console.error("[cron/pre-call-briefs] Error:", err);
    return NextResponse.json(
      { generated: 0, error: err instanceof Error ? err.message : "Failed to generate pre-call briefs" },
      { status: 500 }
    );
  }
}
