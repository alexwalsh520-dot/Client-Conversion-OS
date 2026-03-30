import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { uploadFileAsCso } from "@/lib/slack";
import { generatePDF } from "@/lib/pdf";
import { fetchSheetData as fetchSheetRows, type SheetRow } from "@/lib/google-sheets";

/* ── Config ─────────────────────────────────────────────────────── */

const SETTERS = [
  { name: "Amara", client: "Tyson Sonnek", sheetKeys: ["AMARA"] },
  { name: "Kelechi", client: "Tyson Sonnek", sheetKeys: ["KELCHI", "KELECHI"] },
  { name: "Gideon", client: "Keith Holland", sheetKeys: ["GIDEON"] },
  { name: "Debbie", client: "Keith Holland", sheetKeys: ["DEBBIE"] },
];

/* ── System Prompt ──────────────────────────────────────────────── */

const SETTER_REPORT_PROMPT = `You are the Setter Manager writing a daily setter performance report to the CEO. You are explicitly direct about where money is being lost. No sugarcoating. No motivation. Pure accountability.

Your job is to review each setter's DM transcripts, response times, booking rates, and show rates — then tell the CEO exactly what each setter needs to fix and what to follow up with them about.

Format EXACTLY as follows:

# DAILY SETTER REPORT
**[Day of week], [Full Date]**
**Team Targets: 15% Booking Rate | 65% Show Rate**

---

## TEAM SNAPSHOT

[Quick metrics table for all setters: name, client, leads handled, booked, show rate, booking rate, response time grade]

---

## SETTER REVIEWS

For each setter:

### [Setter Name] — [Client Name]

**Numbers (MTD):**
- Leads → Booked: X/X ([X]% booking rate) — Target: 15%
- Show Rate: [X]% — Target: 65%
- No-Shows: X
- Wins from their leads: X ($X revenue)

**Response Time Analysis (Noon–Midnight EST):**
[Analyze the DM transcripts for response gaps. Look for timestamps in the conversation. If a prospect messaged at 2 PM and the setter didn't respond until the next day, that's a problem. Grade: A (< 5 min), B (5-30 min), C (30-60 min), D (1-4 hrs), F (4+ hrs or next day). Be specific — cite the actual gaps from the transcripts.]

**DM Quality Review:**
[Review the actual conversations. Are they qualifying properly? Are they building urgency? Are they asking about goals, timeline, budget, current situation? Are they sending the booking link at the right time? Are they following up on dead conversations? Cite specific examples from the transcripts — quote what they said and what they should have said instead.]

**Where Money Is Being Lost:**
[Specific dollar amount being leaked. Example: "3 no-shows this week at $1,538 AOV = $4,614 in lost potential revenue. 2 of those prospects were never sent a confirmation text."]

**Directives:**
[3-5 specific, numbered action items. Not suggestions — directives. "Do this today." Each one addresses a specific problem found in the transcripts or numbers.]

---

## CEO FOLLOW-UP ITEMS

[5-7 numbered items for the CEO to address with the setter team. Each is specific and actionable. Include which setter, what to say to them, and why.]

---

Rules:
- Be brutally honest. You are protecting revenue, not feelings.
- Every claim must be backed by a number or a transcript quote.
- Response time between noon and midnight EST is what matters — that's when prospects are active.
- If a setter has no DM transcripts uploaded, that IS the problem. Call it out.
- Booking rate target is 15%. Show rate target is 65%. Anything below is costing money.
- Calculate the dollar impact of every gap: missed leads × AOV = money lost.
- If a setter is doing well, say so briefly and move on. Spend time on problems, not praise.`;

/* ── Data Fetching ──────────────────────────────────────────────── */

async function fetchDMTranscripts(setterName: string, client: string, daysBack: number = 3): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return "";

  try {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const sinceStr = since.toISOString();
    const clientKey = client.toLowerCase().includes("keith") ? "keith" : "tyson";

    const url = `${supabaseUrl}/rest/v1/dm_transcripts?setter_name=ilike.*${setterName.toLowerCase()}*&client=eq.${clientKey}&submitted_at=gte.${sinceStr}&order=submitted_at.desc&limit=10`;
    const res = await fetch(url, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (!res.ok) return "";
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return "NO DM TRANSCRIPTS UPLOADED IN THE LAST 3 DAYS.";

    return data.map((t: { transcript: string; submitted_at: string }) =>
      `[Uploaded: ${t.submitted_at.substring(0, 16)}]\n${t.transcript.substring(0, 2500)}`
    ).join("\n\n--- NEXT CONVERSATION ---\n\n");
  } catch {
    return "";
  }
}

/* ── Main Handler ───────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

  const anthropic = new Anthropic({ apiKey });

  // Dates
  const now = new Date();
  const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayStr = etNow.toISOString().split("T")[0];
  const monthStart = todayStr.substring(0, 8) + "01";

  // Fetch sales tracker for setter stats
  let rows: SheetRow[];
  try {
    rows = await fetchSheetRows(monthStart, todayStr);
  } catch (err) {
    return NextResponse.json({ error: `Sheet data error: ${err}` }, { status: 500 });
  }

  // Calculate setter metrics
  const setterContextParts: string[] = [];

  for (const setter of SETTERS) {
    const setterRows = rows.filter((r) =>
      setter.sheetKeys.some((k) => (r.setter || "").toUpperCase().includes(k))
    );
    const taken = setterRows.filter((r) => r.callTaken);
    const wins = setterRows.filter((r) => r.outcome === "WIN");
    const noShows = setterRows.filter((r) => ["NS/RS", "NS"].includes(r.outcome));
    const pcfus = setterRows.filter((r) => r.outcome === "PCFU");
    const losses = setterRows.filter((r) => r.outcome === "LOSS" || r.outcome === "NOT A FIT/NO OFFER");
    const cash = setterRows.reduce((s, r) => s + (r.cashCollected || 0), 0);
    const showRate = setterRows.length > 0 ? (taken.length / setterRows.length * 100) : 0;
    const closeRate = taken.length > 0 ? (wins.length / taken.length * 100) : 0;

    // Yesterday's results for this setter
    const yesterday = new Date(etNow);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    const yesterdayRows = setterRows.filter((r) => r.date === yesterdayStr);

    // Fetch DM transcripts
    const dmTranscripts = await fetchDMTranscripts(setter.name, setter.client);

    setterContextParts.push(`
=== ${setter.name.toUpperCase()} (${setter.client}) ===

MTD NUMBERS:
- Booked: ${setterRows.length}
- Calls Taken (showed): ${taken.length}
- Show Rate: ${showRate.toFixed(1)}% (target: 65%)
- Wins: ${wins.length} ($${cash.toLocaleString()} cash)
- Close Rate on their leads: ${closeRate.toFixed(1)}%
- No-Shows: ${noShows.length}
- PCFUs: ${pcfus.length}
- Losses/No Offer: ${losses.length}

YESTERDAY'S RESULTS:
${yesterdayRows.length === 0 ? "No calls from this setter yesterday." :
  yesterdayRows.map((r) => `${r.name}: ${r.outcome || "pending"} | Closer: ${r.closer} | Taken: ${r.callTaken} | Cash: $${r.cashCollected || 0}`).join("\n")}

DM TRANSCRIPTS (last 3 days):
${dmTranscripts || "NO TRANSCRIPTS AVAILABLE"}
`);
  }

  // Team-wide metrics
  const totalBooked = rows.length;
  const totalTaken = rows.filter((r) => r.callTaken).length;
  const totalWins = rows.filter((r) => r.outcome === "WIN").length;
  const totalCash = rows.reduce((s, r) => s + (r.cashCollected || 0), 0);
  const teamShowRate = totalBooked > 0 ? (totalTaken / totalBooked * 100) : 0;
  const aov = totalWins > 0 ? totalCash / totalWins : 0;

  const fullContext = `Date: ${todayStr}
MTD Period: ${monthStart} to ${todayStr}

TEAM-WIDE METRICS:
- Total Booked: ${totalBooked}
- Total Taken: ${totalTaken}
- Total Wins: ${totalWins}
- Cash Collected: $${totalCash.toLocaleString()}
- Team Show Rate: ${teamShowRate.toFixed(1)}%
- AOV: $${aov.toFixed(0)}

${setterContextParts.join("\n")}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 6000,
      system: SETTER_REPORT_PROMPT,
      messages: [{ role: "user", content: `Generate the Daily Setter Report:\n\n${fullContext}` }],
    });

    const report = msg.content.filter((b) => b.type === "text").map((b) => b.type === "text" ? b.text : "").join("\n");
    const pdf = generatePDF(`Daily Setter Report (${todayStr})`, report);

    await uploadFileAsCso(
      pdf,
      `setter-report-${todayStr}.pdf`,
      `Daily Setter Report — ${todayStr}`,
      `📋 *DAILY SETTER REPORT — ${todayStr}*\nTeam SR: ${teamShowRate.toFixed(1)}% (target: 65%) | ${totalBooked} booked | ${totalWins} wins | $${totalCash.toLocaleString()}`
    );

    return NextResponse.json({ success: true, date: todayStr });
  } catch (err) {
    console.error("[cron/setter-report] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
