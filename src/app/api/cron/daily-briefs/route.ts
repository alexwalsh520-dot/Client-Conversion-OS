import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { postToSlack } from "@/lib/slack";
import { uploadFileToSlack } from "@/lib/slack";
import { generatePDF } from "@/lib/pdf";

/* ── Config ─────────────────────────────────────────────────────── */

const GHL_V1_BASE = "https://rest.gohighlevel.com/v1";

const CLOSERS = ["Broz", "Will", "Austin"];

const DAILY_BRIEF_SYSTEM_PROMPT = `You are generating a daily closer brief for a fitness coaching sales team (Core Shift LLC). This brief is for ONE specific closer and should ONLY contain information about THEIR prospects for the day.

Format the brief as follows:

# Daily Brief — [Closer Name]
**Date:** [date in Eastern Time]
**Calls Today:** [count]

---

## Today's Schedule (All Times EST)

[For each appointment, list: Time — Prospect Name — Client (Keith/Tyson)]

---

## Prospect Briefs

[For each prospect on the calendar:]

### [Prospect First Last Name]
**Call Time:** [time EST]
**Client:** [Keith Holland / Tyson Sonnek]

**Desired Situation:** [What they want to achieve — extract from DM conversation if available]
**Current Situation:** [Where they are now]
**What They Think Is Holding Them Back:** [Their perceived blockers]
**Emotional Driver:** [What emotionally motivates them — fear, desire, pain, ambition]
**Previous Attempts:** [Have they tried coaching/programs before?]
**Budget:** [Any budget indicators from conversation]
**SendBlue Notes:** [Any relevant messaging notes — if they haven't responded, need follow-up, asked a question, etc. If nothing notable, omit this field.]

**Lead Score:** [X/10]
[One sentence explaining the score — what makes them hot/warm/cold]

**AI Notes:** [Your analysis: buying signals spotted, weaknesses, what to probe on the call, recommended approach. Be specific and tactical.]

---

## Follow-Up Recommendations

[List prospects who should be followed up with to increase show rate, close likelihood, or AOV. For each:]

### [Prospect First Last Name]
**What to Send:** [Specific message recommendation for SendBlue/text]
**Why:** [1-2 sentences on why this follow-up will help]
**When:** [Suggested timing]

[If no follow-up is needed for a prospect, DO NOT include them in this section.]
[If no follow-ups are recommended at all, write "No follow-ups recommended at this time."]

---

Keep everything concise and actionable. The closer should be able to read this in 3-5 minutes before their first call.`;

/* ── GHL helpers ────────────────────────────────────────────────── */

function getGhlApiKey(): string {
  const key = process.env.GHL_V1_API_KEY;
  if (!key) throw new Error("GHL_V1_API_KEY not configured");
  return key;
}

interface CalendarConfig {
  calendarId: string;
  client: string;
}

function getCalendars(): CalendarConfig[] {
  const configs: CalendarConfig[] = [];
  const tysonId = process.env.GHL_CALENDAR_ID_TYSON;
  if (tysonId) configs.push({ calendarId: tysonId, client: "Tyson Sonnek" });
  const keithId = process.env.GHL_CALENDAR_ID_KEITH;
  if (keithId) configs.push({ calendarId: keithId, client: "Keith Holland" });
  return configs;
}

/* ── Supabase DM transcript fetcher ─────────────────────────────── */

async function findDMTranscriptByName(name: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey || !name) return null;

  try {
    // Search for transcripts mentioning this prospect name
    const encodedName = encodeURIComponent(name.toLowerCase());
    const url = `${supabaseUrl}/rest/v1/dm_transcripts?transcript=ilike.*${encodedName}*&order=submitted_at.desc&limit=3`;
    const res = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    return data
      .map((t: { setter_name: string; transcript: string; submitted_at: string }) =>
        `[Setter: ${t.setter_name}, Date: ${t.submitted_at}]\n${t.transcript}`)
      .join("\n\n---\n\n");
  } catch {
    return null;
  }
}

/* ── SendBlue message fetcher ───────────────────────────────────── */

async function fetchSendBlueMessages(phone: string): Promise<string | null> {
  const apiKeyId = process.env.SENDBLUE_API_KEY_ID;
  const apiSecret = process.env.SENDBLUE_API_SECRET_KEY;
  if (!apiKeyId || !apiSecret || !phone) return null;

  try {
    const res = await fetch(`https://api.sendblue.co/api/messages?number=${encodeURIComponent(phone)}&limit=10`, {
      headers: {
        "sb-api-key-id": apiKeyId,
        "sb-api-secret-key": apiSecret,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.messages || !Array.isArray(data.messages) || data.messages.length === 0) return null;

    return data.messages
      .map((m: { content?: string; from_number?: string; date?: string; status?: string }) =>
        `${m.from_number === phone ? "Prospect" : "Us"}: ${m.content || ""} (${m.date || ""})`)
      .join("\n");
  } catch {
    return null;
  }
}

/* ── Main handler ───────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  try {
    // Auth
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.get("authorization");
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const ghlApiKey = getGhlApiKey();
    const calendars = getCalendars();
    if (calendars.length === 0) {
      return NextResponse.json({ generated: 0, error: "No GHL calendar IDs configured" });
    }

    // Get today's date range in EST
    const now = new Date();
    const estOffset = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const todayStr = estOffset.toISOString().split("T")[0];

    // Start of day and end of day in milliseconds
    const startOfDay = new Date(`${todayStr}T00:00:00-05:00`).getTime();
    const endOfDay = new Date(`${todayStr}T23:59:59-05:00`).getTime();

    // Fetch ALL appointments for today from all calendars
    interface Appointment {
      contactId?: string;
      contact_id?: string;
      calendarId?: string;
      calendar_id?: string;
      title?: string;
      startTime?: string;
      start_time?: string;
      assignedUserId?: string;
      assigned_user_id?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    }

    const allAppointments: { appointment: Appointment; client: string }[] = [];

    for (const cal of calendars) {
      try {
        const url = `${GHL_V1_BASE}/appointments/?calendarId=${cal.calendarId}&startDate=${startOfDay}&endDate=${endOfDay}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${ghlApiKey}` },
        });
        if (res.ok) {
          const data = await res.json();
          const appointments = data.appointments || data.events || data || [];
          if (Array.isArray(appointments)) {
            for (const apt of appointments) {
              allAppointments.push({ appointment: apt, client: cal.client });
            }
          }
        }
      } catch (err) {
        console.warn(`[daily-briefs] Calendar fetch error for ${cal.client}:`, err);
      }
    }

    if (allAppointments.length === 0) {
      return NextResponse.json({ generated: 0, message: "No appointments today" });
    }

    // Fetch contact details for all appointments
    interface ProspectData {
      name: string;
      firstName: string;
      lastName: string;
      phone: string;
      email: string;
      client: string;
      startTime: string;
      closer: string;
      dmTranscript: string | null;
      sendBlueMessages: string | null;
      tags: string[];
      source: string;
    }

    const prospects: ProspectData[] = [];

    for (const { appointment, client } of allAppointments) {
      const contactId = String(appointment.contactId || appointment.contact_id || "");
      let firstName = "";
      let lastName = "";
      let phone = "";
      let email = "";
      let tags: string[] = [];
      let source = "";

      if (contactId) {
        try {
          const contactRes = await fetch(`${GHL_V1_BASE}/contacts/${contactId}`, {
            headers: { Authorization: `Bearer ${ghlApiKey}` },
          });
          if (contactRes.ok) {
            const cData = await contactRes.json();
            const contact = cData.contact || cData;
            firstName = String(contact.firstName || "");
            lastName = String(contact.lastName || "");
            phone = String(contact.phone || contact.phoneNumber || "");
            email = String(contact.email || contact.emailAddress || "");
            tags = Array.isArray(contact.tags) ? contact.tags : [];
            source = String(contact.source || "");
          }
        } catch {
          // Use appointment title as fallback
        }
      }

      const name = `${firstName} ${lastName}`.trim() || String(appointment.title || "Unknown Prospect");
      const startTime = appointment.startTime || appointment.start_time || "";

      // Try to find DM transcript (best effort: name match)
      const dmTranscript = await findDMTranscriptByName(name);

      // Try to fetch SendBlue messages (by phone)
      const sendBlueMessages = await fetchSendBlueMessages(phone);

      // Determine closer from GHL assigned user or appointment title
      const closer = String(appointment.assignedUserId || appointment.assigned_user_id || appointment.title || "");

      prospects.push({
        name,
        firstName,
        lastName,
        phone,
        email,
        client,
        startTime,
        closer,
        dmTranscript,
        sendBlueMessages,
        tags,
        source,
      });
    }

    // Group prospects by closer
    const closerProspects: Record<string, ProspectData[]> = {};

    for (const prospect of prospects) {
      // Try to match to known closers
      let assignedCloser = "Unassigned";
      for (const c of CLOSERS) {
        if (
          prospect.closer.toLowerCase().includes(c.toLowerCase()) ||
          prospect.name.toLowerCase().includes(c.toLowerCase())
        ) {
          assignedCloser = c;
          break;
        }
      }

      if (!closerProspects[assignedCloser]) closerProspects[assignedCloser] = [];
      closerProspects[assignedCloser].push(prospect);
    }

    // Generate one brief per closer
    const anthropic = new Anthropic({ apiKey });
    const slackChannel = process.env.SLACK_USER_DM || process.env.SLACK_CHANNEL_PRE_CALL_BRIEFS || process.env.SLACK_CHANNEL_MARKETING;
    let generated = 0;

    for (const [closerName, closerProspectList] of Object.entries(closerProspects)) {
      if (closerProspectList.length === 0) continue;

      // Build context for this closer's brief
      const contextParts: string[] = [
        `Closer: ${closerName}`,
        `Date: ${todayStr}`,
        `Number of calls: ${closerProspectList.length}`,
        "",
      ];

      for (let i = 0; i < closerProspectList.length; i++) {
        const p = closerProspectList[i];
        contextParts.push(`--- Prospect ${i + 1} ---`);
        contextParts.push(`Name: ${p.name}`);
        contextParts.push(`Call Time: ${p.startTime}`);
        contextParts.push(`Client: ${p.client}`);
        contextParts.push(`Phone: ${p.phone || "N/A"}`);
        contextParts.push(`Email: ${p.email || "N/A"}`);
        if (p.tags.length > 0) contextParts.push(`Tags: ${p.tags.join(", ")}`);
        if (p.source) contextParts.push(`Source: ${p.source}`);

        if (p.dmTranscript) {
          contextParts.push(`\nDM Conversation:\n${p.dmTranscript}`);
        } else {
          contextParts.push(`\nDM Conversation: Not found`);
        }

        if (p.sendBlueMessages) {
          contextParts.push(`\nSendBlue Messages:\n${p.sendBlueMessages}`);
        }

        contextParts.push("");
      }

      try {
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system: DAILY_BRIEF_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Generate the daily brief for ${closerName} with these ${closerProspectList.length} prospects:\n\n${contextParts.join("\n")}`,
            },
          ],
        });

        const brief = message.content
          .filter((block) => block.type === "text")
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n");

        // Generate PDF
        try {
          const pdfBuffer = generatePDF(`Daily Brief — ${closerName} (${todayStr})`, brief);

          // Upload PDF to Slack
          if (slackChannel) {
            await uploadFileToSlack(
              slackChannel,
              pdfBuffer,
              `daily-brief-${closerName.toLowerCase()}-${todayStr}.pdf`,
              `Daily Brief — ${closerName} (${todayStr})`,
              `Daily closer brief for ${closerName} — ${closerProspectList.length} call(s) today`
            );
          }
        } catch (pdfErr) {
          console.warn(`[daily-briefs] PDF error for ${closerName}:`, pdfErr);
          // Fallback: send as text
          if (slackChannel) {
            const truncated = brief.length > 3500
              ? brief.substring(0, 3500) + "\n\n_...truncated_"
              : brief;
            await postToSlack(slackChannel, `*Daily Brief — ${closerName}*\n\n${truncated}`);
          }
        }

        generated++;
      } catch (err) {
        console.error(`[daily-briefs] Failed to generate brief for ${closerName}:`, err);
      }
    }

    return NextResponse.json({
      generated,
      date: todayStr,
      closers: Object.keys(closerProspects),
      totalAppointments: allAppointments.length,
    });
  } catch (err) {
    console.error("[daily-briefs] Error:", err);
    return NextResponse.json(
      { generated: 0, error: err instanceof Error ? err.message : "Failed to generate daily briefs" },
      { status: 500 }
    );
  }
}
