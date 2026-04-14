import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSalesManagerChannel, postAsCso, uploadFileAsCso } from "@/lib/slack";
import { generatePDF } from "@/lib/pdf";
import { listMeetings, FathomMeeting } from "@/lib/fathom";

/* ── Config ─────────────────────────────────────────────────────── */

const GHL_V2_BASE = "https://services.leadconnectorhq.com";
const CLOSERS = ["Broz", "Will", "Jacob"];

const TEAM_EMAILS = new Set([
  "matthew@clientconversion.io", "alex@clientconversion.io", "alexwalsh520@gmail.com",
  "brozee2019@gmail.com", "will@start2finishcoaching.com", "williamluke.buckley21@gmail.com",
  "austinrichard6@gmail.com", "austinr@gfpenterprises.com", "tysonnek29@gmail.com",
  "saeed16765@gmail.com", "keithholland35@gmail.com", "averyjfisk@gmail.com", "isaac@sendblue.com",
  "gideonadebowale11@gmail.com", "amaraedwin9@gmail.com", "umunnakelechi89@gmail.com", "nwosudebbie@gmail.com",
]);
const INTERNAL_TITLES = ["sales team huddle", "c suite", "management", "setter connect", "training", "interview", "1:1", "huddle"];

const DAILY_BRIEF_SYSTEM_PROMPT = `You are the Chief Sales Officer generating a daily closer brief for Core Shift LLC's fitness coaching sales team. This brief is for ONE specific closer. Be direct, tactical, and data-driven. No motivational fluff. No AI catchphrases. Pure actionable intelligence.

Format the brief in exactly 4 sections:

# Daily Brief — [Closer Name]
**Date:** [date in Eastern Time]
**Calls Today:** [count]

---

## Section 1: Call Updates

[For each prospect on today's calendar:]

### [Time EST] — [Prospect Name]
**Client:** [Keith Holland / Tyson Sonnek]
**Setter:** [setter name — NEVER say "unknown". Check sales tracker if DM transcript unavailable.]
**Status:** [Confirmed / Pending]

**Lead Score:** [X/10] | **Warmth:** [Hot / Warm / Cold]
[One line explaining the score based on engagement signals, response speed, and qualification depth]

**Intel from DMs:**
- Desired outcome: [what they want]
- Current situation: [where they are now]
- Key blocker: [what they think is holding them back]
- Budget signals: [any indicators]
- Emotional driver: [what's really motivating them]

**Tactical Notes:** [Specific advice for THIS call. What to open with, what to probe, what to avoid. Reference their exact words from the DM if available.]

[If no DM transcript exists, state "DM transcript not uploaded by setter. Run full discovery: goals, current state, timeline, budget." and still provide tactical approach based on the calendar type (TS vs KH).]

---

## Section 2: Mini Review — Yesterday's Calls

[Based on yesterday's Fathom call transcripts. If no transcripts available, write "No call recordings from yesterday available for review."]

For each call reviewed:
### [Prospect Name] — [Outcome: WIN/LOSS/NS/PCFU]
- **What worked:** [specific moment or technique from the transcript]
- **What to fix:** [specific moment where revenue was left on the table, with exact phrasing of what to say instead]

### Overall Pattern
[1-2 sentences on the pattern across yesterday's calls. Example: "You're rushing past pain discovery — average time in discovery was 4 minutes. Target is 12-15 minutes."]

---

## Section 3: Action Items

[Numbered list of specific tasks. Each must be concrete and completable today.]

1. [Follow-up: specific person, specific message, specific time to send]
2. [Pre-call prep: specific thing to review or do before a specific call]
3. [Drill: specific skill to practice, with example scenario]
4. [Process: any operational item like updating CRM, sending recap, etc.]

[Only include items that are genuinely actionable. 3-6 items max.]

---

## Section 4: AI Analysis

[Data-driven strategic observations. 2-4 bullet points max.]

- [Pattern recognition: what the data shows about this closer's performance trend]
- [Revenue opportunity: specific dollar amount at stake based on today's calls]
- [Risk flag: any prospect likely to no-show or need special handling, with specific reason]
- [Competitive insight: if a prospect mentioned other programs or alternatives]

---

Keep the entire brief under 5 minutes reading time. Every sentence must be actionable or informative. Zero filler.`;

/* ── GHL V2 Helpers ──────────────────────────────────────────────── */

function getGhlV2Headers(): Record<string, string> {
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

// Build a map of GHL userId → display name for closer matching
interface GhlUser {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
}

async function fetchGhlUsers(): Promise<GhlUser[]> {
  try {
    const res = await fetch(`${GHL_V2_BASE}/users/?locationId=${getLocationId()}`, {
      headers: getGhlV2Headers(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.users || !Array.isArray(data.users)) return [];
    return data.users.map((u: Record<string, unknown>) => ({
      id: String(u.id || ""),
      name: String(u.name || ""),
      firstName: String(u.firstName || ""),
      lastName: String(u.lastName || ""),
      email: String(u.email || ""),
    }));
  } catch {
    return [];
  }
}

// Fetch calendar events for today via V2 API
interface GhlEvent {
  id: string;
  calendarId: string;
  title: string;
  contactId: string;
  assignedUserId: string;
  startTime: string;
  endTime: string;
  status: string;
  appointmentStatus: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

async function fetchTodayEvents(todayStr: string): Promise<GhlEvent[]> {
  const locationId = getLocationId();
  const headers = getGhlV2Headers();
  const startTime = `${todayStr}T00:00:00-05:00`;
  const endTime = `${todayStr}T23:59:59-05:00`;

  const allEvents: GhlEvent[] = [];

  // First get all calendars
  try {
    const calRes = await fetch(`${GHL_V2_BASE}/calendars/?locationId=${locationId}`, { headers });
    if (!calRes.ok) {
      console.warn(`[daily-brief] Failed to list calendars: ${calRes.status}`);
      // Fallback: try fetching events without calendarId
      const url = `${GHL_V2_BASE}/calendars/events?locationId=${locationId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        const events = data.events || data.data || data || [];
        if (Array.isArray(events)) return events;
      }
      return [];
    }

    const calData = await calRes.json();
    const calendars = calData.calendars || [];

    // Fetch events from each calendar
    for (const cal of calendars) {
      try {
        const url = `${GHL_V2_BASE}/calendars/events?locationId=${locationId}&calendarId=${cal.id}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
        const res = await fetch(url, { headers });
        if (res.ok) {
          const data = await res.json();
          const events = data.events || data.data || data || [];
          if (Array.isArray(events)) {
            for (const evt of events) {
              // Tag with calendar name for client identification
              evt._calendarName = cal.name || "";
              evt._calendarId = cal.id || "";
              allEvents.push(evt);
            }
          }
        }
      } catch (err) {
        console.warn(`[daily-brief] Calendar ${cal.name} fetch error:`, err);
      }
    }
  } catch (err) {
    console.warn("[daily-brief] Calendar list error:", err);
  }

  return allEvents;
}

// Fetch contact details via V2 API
async function fetchContact(contactId: string): Promise<{
  firstName: string; lastName: string; phone: string; email: string;
  tags: string[]; source: string;
} | null> {
  if (!contactId) return null;
  try {
    const res = await fetch(`${GHL_V2_BASE}/contacts/${contactId}`, {
      headers: getGhlV2Headers(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const contact = data.contact || data;
    return {
      firstName: String(contact.firstName || ""),
      lastName: String(contact.lastName || ""),
      phone: String(contact.phone || contact.phoneNumber || ""),
      email: String(contact.email || contact.emailAddress || ""),
      tags: Array.isArray(contact.tags) ? contact.tags.map(String) : [],
      source: String(contact.source || ""),
    };
  } catch {
    return null;
  }
}

/* ── Other Helpers ───────────────────────────────────────────────── */

async function findDMTranscriptByName(name: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey || !name) return null;
  try {
    const encodedName = encodeURIComponent(name.toLowerCase());
    const url = `${supabaseUrl}/rest/v1/dm_transcripts?transcript=ilike.*${encodedName}*&order=submitted_at.desc&limit=3`;
    const res = await fetch(url, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.map((t: { setter_name: string; transcript: string; submitted_at: string }) =>
      `[Setter: ${t.setter_name}, Date: ${t.submitted_at}]\n${t.transcript}`).join("\n\n---\n\n");
  } catch { return null; }
}

async function fetchSendBlueMessages(phone: string): Promise<string | null> {
  const apiKeyId = process.env.SENDBLUE_API_KEY_ID;
  const apiSecret = process.env.SENDBLUE_API_SECRET_KEY;
  if (!apiKeyId || !apiSecret || !phone) return null;
  try {
    const res = await fetch(`https://api.sendblue.co/api/v2/messages?number=${encodeURIComponent(phone)}&limit=10&order_by=date_sent&order_direction=desc`, {
      headers: { "sb-api-key-id": apiKeyId, "sb-api-secret-key": apiSecret },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.data) || data.data.length === 0) return null;
    return data.data
      .map((m: { content?: string; is_outbound?: boolean; date_sent?: string }) =>
        `${m.is_outbound ? "Us" : "Prospect"}: ${m.content || ""} (${m.date_sent || ""})`).join("\n");
  } catch { return null; }
}

function isSalesCall(m: FathomMeeting): boolean {
  const titleLower = (m.title || "").toLowerCase();
  if (INTERNAL_TITLES.some((p) => titleLower.includes(p))) return false;
  const invitees = m.calendar_invitees || [];
  return invitees.some((a) => a.email && !TEAM_EMAILS.has(a.email.toLowerCase()));
}

// Match a GHL userId to a closer name using the user list
function matchCloser(
  assignedUserId: string,
  calendarName: string,
  title: string,
  userMap: Map<string, GhlUser>
): string {
  // First try: match by assigned user ID
  if (assignedUserId && userMap.has(assignedUserId)) {
    const user = userMap.get(assignedUserId)!;
    const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
    const userName = user.name.toLowerCase();
    for (const c of CLOSERS) {
      const cl = c.toLowerCase();
      if (fullName.includes(cl) || userName.includes(cl) || user.email.toLowerCase().includes(cl)) {
        return c;
      }
    }
    // Return user's first name if not in CLOSERS list
    return user.firstName || user.name || "Unassigned";
  }

  // Second try: match by calendar name or event title
  const combined = `${calendarName} ${title}`.toLowerCase();
  for (const c of CLOSERS) {
    if (combined.includes(c.toLowerCase())) return c;
  }

  return "Unassigned";
}

// Determine client (Tyson/Keith) from calendar name
function identifyClient(calendarName: string): string {
  const lower = calendarName.toLowerCase();
  if (lower.includes("tyson") || lower.includes("ts")) return "Tyson Sonnek";
  if (lower.includes("keith") || lower.includes("kh")) return "Keith Holland";
  return calendarName || "Unknown Client";
}

/* ── POST handler — generate daily brief(s) on demand ──────────── */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { closer: requestedCloser, sendToSlack: shouldSlack = true } = body as {
      closer?: string;
      sendToSlack?: boolean;
    };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

    // Get today's date in EST
    const now = new Date();
    const estOffset = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const todayStr = estOffset.toISOString().split("T")[0];

    // Fetch GHL users for closer mapping and today's events in parallel
    const [ghlUsers, todayEvents] = await Promise.all([
      fetchGhlUsers(),
      fetchTodayEvents(todayStr),
    ]);

    const userMap = new Map<string, GhlUser>();
    for (const u of ghlUsers) userMap.set(u.id, u);

    console.log(`[daily-brief] Found ${todayEvents.length} events, ${ghlUsers.length} GHL users`);

    // Filter out cancelled/no-show appointments, keep confirmed/booked
    const activeEvents = todayEvents.filter((evt) => {
      const status = (evt.status || evt.appointmentStatus || "").toLowerCase();
      return !status.includes("cancelled") && !status.includes("canceled") && !status.includes("deleted");
    });

    if (activeEvents.length === 0) {
      return NextResponse.json({
        briefs: [],
        message: "No appointments today",
        debug: {
          totalEventsBeforeFilter: todayEvents.length,
          ghlUsersCount: ghlUsers.length,
          date: todayStr,
        },
      });
    }

    // Build prospect data
    interface ProspectData {
      name: string; firstName: string; lastName: string; phone: string; email: string;
      client: string; startTime: string; closer: string;
      dmTranscript: string | null; sendBlueMessages: string | null; tags: string[]; source: string;
    }

    const prospects: ProspectData[] = [];
    for (const evt of activeEvents) {
      const contactId = String(evt.contactId || evt.contact_id || "");
      const contactData = await fetchContact(contactId);

      const firstName = contactData?.firstName || "";
      const lastName = contactData?.lastName || "";
      const phone = contactData?.phone || "";
      const email = contactData?.email || "";
      const tags = contactData?.tags || [];
      const source = contactData?.source || "";

      const name = `${firstName} ${lastName}`.trim() || String(evt.title || "Unknown Prospect");
      const startTime = evt.startTime || evt.start_time || "";
      const assignedUserId = String(evt.assignedUserId || evt.assigned_user_id || "");
      const calendarName = String(evt._calendarName || "");
      const client = identifyClient(calendarName);
      const closer = matchCloser(assignedUserId, calendarName, evt.title || "", userMap);

      const dmTranscript = await findDMTranscriptByName(name);
      const sendBlueMessages = await fetchSendBlueMessages(phone);

      prospects.push({
        name, firstName, lastName, phone, email,
        client, startTime, closer,
        dmTranscript, sendBlueMessages, tags, source,
      });
    }

    // Group by closer
    const closerProspects: Record<string, ProspectData[]> = {};
    for (const prospect of prospects) {
      const key = prospect.closer || "Unassigned";
      if (!closerProspects[key]) closerProspects[key] = [];
      closerProspects[key].push(prospect);
    }

    // Filter to requested closer if specified
    const closersToGenerate = requestedCloser
      ? Object.entries(closerProspects).filter(([name]) => name.toLowerCase() === requestedCloser.toLowerCase())
      : Object.entries(closerProspects);

    // Fetch yesterday's Fathom calls for coaching
    const yesterday = new Date(estOffset);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    let yesterdayMeetings: FathomMeeting[] = [];
    try {
      yesterdayMeetings = await listMeetings({
        createdAfter: yesterdayStr,
        createdBefore: `${yesterdayStr}T23:59:59Z`,
        includeTranscript: true,
      });
      yesterdayMeetings = yesterdayMeetings.filter(isSalesCall);
    } catch (err) {
      console.warn("[daily-brief] Fathom fetch error:", err);
    }

    // Generate briefs
    const anthropic = new Anthropic({ apiKey });
    const slackChannel = getSalesManagerChannel();
    const briefs: { closer: string; brief: string; pdfBase64: string | null }[] = [];

    for (const [closerName, closerProspectList] of closersToGenerate) {
      if (closerProspectList.length === 0) continue;

      // Filter yesterday's calls for this closer
      const closerLower = closerName.toLowerCase();
      const closerCalls = yesterdayMeetings.filter((m) => {
        if (m.title?.toLowerCase().includes(closerLower)) return true;
        return m.calendar_invitees?.some((a) => {
          const n = (a.name || "").toLowerCase();
          const e = (a.email || "").toLowerCase();
          return n.includes(closerLower) || e.includes(closerLower);
        });
      });

      // Build context
      const contextParts: string[] = [
        `Closer: ${closerName}`, `Date: ${todayStr}`,
        `Number of calls: ${closerProspectList.length}`, "",
      ];

      for (let i = 0; i < closerProspectList.length; i++) {
        const p = closerProspectList[i];
        contextParts.push(`--- Prospect ${i + 1} ---`);
        contextParts.push(`Name: ${p.name}`, `Call Time: ${p.startTime}`, `Client: ${p.client}`);
        contextParts.push(`Phone: ${p.phone || "N/A"}`, `Email: ${p.email || "N/A"}`);
        if (p.tags.length > 0) contextParts.push(`Tags: ${p.tags.join(", ")}`);
        if (p.source) contextParts.push(`Source: ${p.source}`);
        contextParts.push(p.dmTranscript ? `\nDM Conversation:\n${p.dmTranscript}` : `\nDM Conversation: Not found`);
        if (p.sendBlueMessages) contextParts.push(`\nSendBlue Messages:\n${p.sendBlueMessages}`);
        contextParts.push("");
      }

      if (closerCalls.length > 0) {
        contextParts.push("", `=== YESTERDAY'S CALL TRANSCRIPTS (${yesterdayStr}) ===`);
        let charBudget = 15000;
        for (const call of closerCalls) {
          if (charBudget <= 0) break;
          contextParts.push(`\n--- Call: ${call.title} ---`);
          if (call.transcript && Array.isArray(call.transcript) && call.transcript.length > 0) {
            const text = call.transcript.map((seg) => `${seg.speaker || "Speaker"}: ${seg.text || ""}`).join("\n");
            const truncated = text.length > charBudget ? text.substring(0, charBudget) + "...[truncated]" : text;
            contextParts.push(truncated);
            charBudget -= text.length;
          } else {
            contextParts.push("(No transcript available)");
          }
        }
      }

      try {
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system: DAILY_BRIEF_SYSTEM_PROMPT,
          messages: [{ role: "user", content: `Generate the daily brief for ${closerName} with these ${closerProspectList.length} prospects:\n\n${contextParts.join("\n")}` }],
        });

        const brief = message.content
          .filter((block) => block.type === "text")
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n");

        let pdfBase64: string | null = null;
        try {
          const pdfBuffer = generatePDF(`Daily Brief — ${closerName} (${todayStr})`, brief);
          pdfBase64 = pdfBuffer.toString("base64");

          if (shouldSlack && slackChannel) {
            await uploadFileAsCso(
              pdfBuffer,
              `daily-brief-${closerName.toLowerCase()}-${todayStr}.pdf`,
              `Daily Brief — ${closerName} (${todayStr})`,
              `Daily closer brief for ${closerName} — ${closerProspectList.length} call(s) today`
            );
          }
        } catch (pdfErr) {
          console.warn(`[daily-brief] PDF error for ${closerName}:`, pdfErr);
          if (shouldSlack && slackChannel) {
            const truncated = brief.length > 3500 ? brief.substring(0, 3500) + "\n\n_...truncated_" : brief;
            await postAsCso(`*Daily Brief — ${closerName}*\n\n${truncated}`);
          }
        }

        briefs.push({ closer: closerName, brief, pdfBase64 });

        // Save to report history (fire and forget)
        fetch(new URL("/api/sales-hub/report-history", req.url).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "daily_brief",
            subject: closerName,
            date_from: todayStr,
            date_to: todayStr,
            content: brief,
            pdf_base64: pdfBase64,
          }),
        }).catch(() => {});
      } catch (err) {
        console.error(`[daily-brief] Failed for ${closerName}:`, err);
      }
    }

    return NextResponse.json({
      briefs,
      date: todayStr,
      totalAppointments: activeEvents.length,
      closerBreakdown: Object.fromEntries(
        Object.entries(closerProspects).map(([k, v]) => [k, v.length])
      ),
    });
  } catch (err) {
    console.error("[daily-brief] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate daily briefs" },
      { status: 500 }
    );
  }
}
