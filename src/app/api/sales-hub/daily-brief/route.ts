import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { postToSlack, uploadFileToSlack } from "@/lib/slack";
import { generatePDF } from "@/lib/pdf";
import { listMeetings, FathomMeeting } from "@/lib/fathom";

/* ── Config ─────────────────────────────────────────────────────── */

const GHL_V1_BASE = "https://rest.gohighlevel.com/v1";
const CLOSERS = ["Broz", "Will", "Austin"];

const TEAM_EMAILS = new Set([
  "matthew@clientconversion.io", "alex@clientconversion.io", "alexwalsh520@gmail.com",
  "brozee2019@gmail.com", "will@start2finishcoaching.com", "williamluke.buckley21@gmail.com",
  "austinrichard6@gmail.com", "austinr@gfpenterprises.com", "tysonnek29@gmail.com",
  "saeed16765@gmail.com", "keithholland35@gmail.com", "averyjfisk@gmail.com", "isaac@sendblue.com",
  "gideonadebowale11@gmail.com", "amaraedwin9@gmail.com", "umunnakelechi89@gmail.com", "nwosudebbie@gmail.com",
]);
const INTERNAL_TITLES = ["sales team huddle", "c suite", "management", "setter connect", "training", "interview", "1:1", "huddle"];

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

---

## Coaching — Your Calls from Yesterday

If yesterday's call transcripts are provided, include this section. If no transcripts are available, omit this entire section.

Based on yesterday's sales calls, provide ultra-short coaching:

### STOP / START / KEEP
- **STOP:** [1 behavior to eliminate — one sentence]
- **START:** [1 behavior to adopt with example phrase — one sentence]
- **KEEP:** [1 strength to reinforce — one sentence]

### Tactical Advice
[1-3 bullet points max. Each a one-liner. Focus on lowest-hanging fruit from yesterday's calls.]

### Red Flags
[1-3 one-liner bullet points. Only if applicable — omit if none.]

### Drill
[ONE single drill to practice today. One sentence.]

### If I Ran Your Calls
[1-3 bullet points max. Each shows one specific moment you'd handle differently with the exact phrasing you'd use.]

---

Keep everything concise and actionable. The closer should be able to read this in 3-5 minutes before their first call.`;

/* ── Helpers ───────────────────────────────────────────────────── */

function getGhlApiKey(): string {
  const key = process.env.GHL_V1_API_KEY;
  if (!key) throw new Error("GHL_V1_API_KEY not configured");
  return key;
}

interface CalendarConfig { calendarId: string; client: string; }

function getCalendars(): CalendarConfig[] {
  const configs: CalendarConfig[] = [];
  const tysonId = process.env.GHL_CALENDAR_ID_TYSON;
  if (tysonId) configs.push({ calendarId: tysonId, client: "Tyson Sonnek" });
  const keithId = process.env.GHL_CALENDAR_ID_KEITH;
  if (keithId) configs.push({ calendarId: keithId, client: "Keith Holland" });
  return configs;
}

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
    const res = await fetch(`https://api.sendblue.co/api/messages?number=${encodeURIComponent(phone)}&limit=10`, {
      headers: { "sb-api-key-id": apiKeyId, "sb-api-secret-key": apiSecret },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.messages || !Array.isArray(data.messages) || data.messages.length === 0) return null;
    return data.messages
      .map((m: { content?: string; from_number?: string; date?: string }) =>
        `${m.from_number === phone ? "Prospect" : "Us"}: ${m.content || ""} (${m.date || ""})`).join("\n");
  } catch { return null; }
}

function isSalesCall(m: FathomMeeting): boolean {
  const titleLower = (m.title || "").toLowerCase();
  if (INTERNAL_TITLES.some((p) => titleLower.includes(p))) return false;
  const invitees = m.calendar_invitees || [];
  return invitees.some((a) => a.email && !TEAM_EMAILS.has(a.email.toLowerCase()));
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

    const ghlApiKey = getGhlApiKey();
    const calendars = getCalendars();
    if (calendars.length === 0) return NextResponse.json({ error: "No GHL calendar IDs configured" }, { status: 500 });

    // Get today's date in EST
    const now = new Date();
    const estOffset = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const todayStr = estOffset.toISOString().split("T")[0];
    const startOfDay = new Date(`${todayStr}T00:00:00-05:00`).getTime();
    const endOfDay = new Date(`${todayStr}T23:59:59-05:00`).getTime();

    // Fetch appointments
    interface Appointment {
      contactId?: string; contact_id?: string;
      title?: string; startTime?: string; start_time?: string;
      assignedUserId?: string; assigned_user_id?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    }

    const allAppointments: { appointment: Appointment; client: string }[] = [];
    for (const cal of calendars) {
      try {
        const url = `${GHL_V1_BASE}/appointments/?calendarId=${cal.calendarId}&startDate=${startOfDay}&endDate=${endOfDay}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${ghlApiKey}` } });
        if (res.ok) {
          const data = await res.json();
          const appointments = data.appointments || data.events || data || [];
          if (Array.isArray(appointments)) {
            for (const apt of appointments) allAppointments.push({ appointment: apt, client: cal.client });
          }
        }
      } catch (err) {
        console.warn(`[daily-brief] Calendar fetch error for ${cal.client}:`, err);
      }
    }

    if (allAppointments.length === 0) {
      return NextResponse.json({ briefs: [], message: "No appointments today" });
    }

    // Build prospect data
    interface ProspectData {
      name: string; firstName: string; lastName: string; phone: string; email: string;
      client: string; startTime: string; closer: string;
      dmTranscript: string | null; sendBlueMessages: string | null; tags: string[]; source: string;
    }

    const prospects: ProspectData[] = [];
    for (const { appointment, client } of allAppointments) {
      const contactId = String(appointment.contactId || appointment.contact_id || "");
      let firstName = "", lastName = "", phone = "", email = "";
      let tags: string[] = [], source = "";

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
        } catch { /* fallback to title */ }
      }

      const name = `${firstName} ${lastName}`.trim() || String(appointment.title || "Unknown Prospect");
      const startTime = appointment.startTime || appointment.start_time || "";
      const dmTranscript = await findDMTranscriptByName(name);
      const sendBlueMessages = await fetchSendBlueMessages(phone);
      const closer = String(appointment.assignedUserId || appointment.assigned_user_id || appointment.title || "");

      prospects.push({ name, firstName, lastName, phone, email, client, startTime, closer, dmTranscript, sendBlueMessages, tags, source });
    }

    // Group by closer
    const closerProspects: Record<string, ProspectData[]> = {};
    for (const prospect of prospects) {
      let assignedCloser = "Unassigned";
      for (const c of CLOSERS) {
        if (prospect.closer.toLowerCase().includes(c.toLowerCase()) || prospect.name.toLowerCase().includes(c.toLowerCase())) {
          assignedCloser = c;
          break;
        }
      }
      if (!closerProspects[assignedCloser]) closerProspects[assignedCloser] = [];
      closerProspects[assignedCloser].push(prospect);
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
    const slackChannel = process.env.SLACK_USER_DM || process.env.SLACK_CHANNEL_PRE_CALL_BRIEFS || process.env.SLACK_CHANNEL_MARKETING;
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
            await uploadFileToSlack(
              slackChannel, pdfBuffer,
              `daily-brief-${closerName.toLowerCase()}-${todayStr}.pdf`,
              `Daily Brief — ${closerName} (${todayStr})`,
              `Daily closer brief for ${closerName} — ${closerProspectList.length} call(s) today`
            );
          }
        } catch (pdfErr) {
          console.warn(`[daily-brief] PDF error for ${closerName}:`, pdfErr);
          if (shouldSlack && slackChannel) {
            const truncated = brief.length > 3500 ? brief.substring(0, 3500) + "\n\n_...truncated_" : brief;
            await postToSlack(slackChannel, `*Daily Brief — ${closerName}*\n\n${truncated}`);
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
      totalAppointments: allAppointments.length,
    });
  } catch (err) {
    console.error("[daily-brief] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate daily briefs" },
      { status: 500 }
    );
  }
}
