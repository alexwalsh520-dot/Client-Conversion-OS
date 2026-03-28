import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { uploadFileAsCso } from "@/lib/slack";
import { generatePDF } from "@/lib/pdf";
import { fetchSheetData as fetchSheetRows, type SheetRow } from "@/lib/google-sheets";
import { fetchSubscriptionsSold } from "@/lib/google-sheets";

/* ── Config ─────────────────────────────────────────────────────── */

const CLOSERS = [
  { name: "Will Rincan", sheetKey: "WILL", alias: ["WILL", "RINCAN"] },
  { name: "Jacob Broz", sheetKey: "BROZ", alias: ["BROZ", "JACOB"] },
  { name: "Austin Richard", sheetKey: "AUSTIN", alias: ["AUSTIN"] },
];

const SETTERS = ["AMARA", "KELECHI", "KELCHI", "DEBBIE", "GIDEON"];

/* ── System Prompts ─────────────────────────────────────────────── */

const CLOSER_BRIEF_PROMPT = `You are the Chief Sales Officer generating a daily closer brief for Core Shift LLC's fitness coaching sales team. This brief gives the closer real AMMO going into their calls — extracted directly from the DM conversations and call transcripts. No generic AI analysis. No "warmth levels." Pull specific things the prospect SAID and turn them into tactical advantages.

Format EXACTLY as follows:

# DAILY BRIEF — [CLOSER NAME]
**[Day of week], [Full Date] | [X] Scheduled Calls**
**MTD: $[X] cash | [X]% close rate | [X]% show rate**

---

## SECTION 1: CALL UPDATES

For each prospect:

### [Prospect Name]
**Client:** [Keith Holland / Tyson Sonnek] | **Setter:** [name]
**Lead Score:** [X/10]

**What They Told Us:**
[Pull DIRECTLY from the DM transcript. What is their situation? What do they want? What have they tried? What's their timeline? What did they say about budget? Quote their actual words when possible — "I've been struggling with X for Y months" etc. This is the most important part of the brief. Give the closer everything the prospect shared so they walk in knowing the person.]

**Key Signals:**
[Buying signals or red flags extracted from the DM. Did they respond fast? Did they ask about pricing? Did they mention a partner/spouse? Did they seem hesitant about anything specific? Did they mention competing programs?]

**How to Run This Call:**
[Specific tactical advice for THIS prospect based on what they said in the DMs. What to open with (reference something specific they said). What pain to dig into. What objection is likely coming and how to preempt it. What close to use.]

[If NO DM transcript exists: State "No DM transcript uploaded by [setter name]. Text [setter] NOW: 'What's [prospect]'s situation? Goals, current state, budget signals, and what got them excited about the call?'" Then give general tactical advice based on the client type.]

---

## SECTION 2: MINI REVIEW — YESTERDAY'S CALLS

[For each call from yesterday, pull from Fathom transcript if available:]

### [Name] — [OUTCOME]
**Set by [setter] | [client] | [X] min**

[If Fathom transcript available: Identify 1 specific moment that worked well (with what was said), and 1 specific moment where money was left on the table (with what should have been said instead). Use actual quotes from the transcript.]

[If no transcript: Use the sales tracker data — outcome, objection, call length. Note what follow-up is needed.]

**Overall Pattern:** [1-2 sentences on what yesterday's calls reveal about this closer's current approach]

---

## SECTION 3: ACTION ITEMS

[Numbered list, 4-7 items. Every item must be hyper-specific:]
- WHO to contact (name)
- WHAT to say (exact message)
- WHEN to do it (specific time)
- WHY it matters (revenue impact)

---

## SECTION 4: AI ANALYSIS

[3-4 bullet points with specific dollar amounts:]
- Revenue at stake today based on number of calls and current AOV
- Risk flags for specific prospects (based on DM signals, not generic)
- Pattern from recent calls that needs attention
- One specific skill focus for today based on transcript review

---

Rules:
- NEVER blame leads. The closer owns every outcome.
- NEVER use generic phrases like "warm lead" or "cold lead" without evidence.
- ALWAYS reference what the prospect actually said when DM transcripts exist.
- Quote prospects directly from DMs — this is what makes the brief valuable.
- If the DM shows they mentioned budget concerns, tell the closer exactly how to handle it.
- If the DM shows they're excited about something specific, tell the closer to open with that.
- Zero filler. Every sentence gives the closer an edge.`;

const CEO_RECAP_PROMPT = `You are the Chief Sales Officer writing a daily sales recap to the CEO. Be direct, confident, data-driven. No suggestions — give DIRECTIVES. You are telling the CEO what IS happening and what they NEED to do.

Format EXACTLY as follows:

# CEO DAILY SALES RECAP
**[Day of week], [Full Date]**

---

## SECTION 1: MTD METRICS SNAPSHOT

[Present key metrics in a clear list format:]
- **Cash Collected:** $X
- **Revenue Booked:** $X
- **Calls Booked / Taken / Wins:** X / X / X
- **Close Rate:** X% (target: 45%)
- **Show Rate:** X% (target: 65%)
- **AOV:** $X
- **No-Shows:** X (X%)
- **Open PCFUs:** X ($X potential)
- **Subscriptions Sold:** X

**Yesterday:** [1-line summary of yesterday's results]

---

## SECTION 2: TEAM PERFORMANCE

### Closer Performance
[For each closer: name, booked, taken, wins, cash, close rate, show rate. Then 1-2 sentences of analysis and "What to follow up about:" with specific directive.]

### Setter Performance
[For each setter: name, client, booked, taken, wins, show rate. Then analysis and "What to follow up about:" with specific directive.]

---

## SECTION 3: WHERE THE MONEY IS LEAKING

[3-4 specific revenue leaks with dollar amounts. Each leak should have: the problem, the dollar impact, and the fix.]

---

## SECTION 4: CALL REVIEWS

[Review 1-2 specific calls from yesterday. Reference recording links if available. Compare approaches between closers. Give specific observations.]

---

## SECTION 5: PATTERNS AND DIRECTIVES

[Daily + monthly patterns. What you've noticed this month vs yesterday. Confident directives.]

---

## SECTION 6: CEO ACTION ITEMS

[5-7 numbered items. Each starts with a bold action verb. Specific, measurable, completable.]

---

Rules:
- Blend numbers AND call-based feedback. Never just numbers alone.
- Be 100% confident in decisions. "Do this" not "consider doing this."
- Include daily AND monthly patterns.
- Include specific dollar amounts for every revenue leak.
- NEVER blame leads in closer briefs. Lead quality issues go to CEO recap ONLY.
- Team names: Will Rincan, Jacob Broz, Austin Richard. Setters: Amara, Kelechi (Tyson), Gideon, Debbie (Keith).`;

/* ── Data Fetching (direct library call, no HTTP) ───────────────── */

async function fetchSheetData(dateFrom: string, dateTo: string): Promise<{ rows: SheetRow[]; subscriptionsSold: number }> {
  const [rows, subscriptionsSold] = await Promise.all([
    fetchSheetRows(dateFrom, dateTo),
    fetchSubscriptionsSold(dateFrom, dateTo).catch(() => 0),
  ]);
  return { rows, subscriptionsSold };
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function getCloserMTD(allRows: SheetRow[], alias: string[]) {
  const cr = allRows.filter((r) => alias.some((a) => (r.closer || "").toUpperCase() === a));
  const ct = cr.filter((r) => r.callTaken);
  const cw = cr.filter((r) => r.outcome === "WIN");
  const cc = cr.reduce((s, r) => s + (r.cashCollected || 0), 0);
  const cns = cr.filter((r) => ["NS/RS", "NS"].includes(r.outcome));
  return { booked: cr.length, taken: ct.length, wins: cw.length, cash: cc, noShows: cns.length,
    cr: ct.length > 0 ? (cw.length / ct.length * 100).toFixed(1) : "0",
    sr: cr.length > 0 ? (ct.length / cr.length * 100).toFixed(1) : "0" };
}

function getSetterMTD(allRows: SheetRow[], setter: string) {
  const sr = allRows.filter((r) => (r.setter || "").toUpperCase().includes(setter));
  const st = sr.filter((r) => r.callTaken);
  const sw = sr.filter((r) => r.outcome === "WIN");
  const sns = sr.filter((r) => ["NS/RS", "NS"].includes(r.outcome));
  const clients = [...new Set(sr.map((r) => r.offer).filter(Boolean))];
  return { booked: sr.length, taken: st.length, wins: sw.length, noShows: sns.length, clients,
    sr: sr.length > 0 ? (st.length / sr.length * 100).toFixed(1) : "0" };
}

/* ── DM Transcript Lookup ───────────────────────────────────────── */

async function findDMTranscript(prospectName: string, setterName: string, client: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  // Strategy 1: Search by prospect last name in transcript
  const nameParts = prospectName.trim().split(/\s+/);
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0];
  const firstName = nameParts[0];

  for (const searchTerm of [lastName, firstName, prospectName]) {
    if (!searchTerm || searchTerm.length < 3) continue;
    try {
      const encoded = encodeURIComponent(searchTerm.toLowerCase());
      const url = `${supabaseUrl}/rest/v1/dm_transcripts?transcript=ilike.*${encoded}*&order=submitted_at.desc&limit=2`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data.map((t: { setter_name: string; transcript: string; submitted_at: string; client: string }) =>
            `[Setter: ${t.setter_name} | Client: ${t.client} | Date: ${t.submitted_at.substring(0, 10)}]\n${t.transcript}`
          ).join("\n\n---\n\n");
        }
      }
    } catch { /* continue */ }
  }

  // Strategy 2: Get the setter's most recent transcripts for this client
  // The prospect's conversation is likely in the setter's recent uploads
  if (setterName) {
    try {
      const setterLower = setterName.toLowerCase();
      const clientLower = client.toLowerCase().includes("keith") ? "keith" : "tyson";
      const url = `${supabaseUrl}/rest/v1/dm_transcripts?setter_name=ilike.*${setterLower}*&client=eq.${clientLower}&order=submitted_at.desc&limit=5`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          // Check each transcript for the prospect's name
          for (const t of data) {
            const text = (t.transcript || "").toLowerCase();
            if (text.includes(firstName.toLowerCase()) || text.includes(lastName.toLowerCase())) {
              return `[Setter: ${t.setter_name} | Client: ${t.client} | Date: ${t.submitted_at.substring(0, 10)}]\n${t.transcript}`;
            }
          }
        }
      }
    } catch { /* continue */ }
  }

  return null;
}

/* ── Fathom Call Transcripts ───────────────────────────────────── */

async function fetchFathomTranscripts(closerName: string, closerAliases: string[]): Promise<string> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${process.env.VERCEL_URL || "client-conversion-os.vercel.app"}`;
    const res = await fetch(`${baseUrl}/api/sales-hub/fathom-calls`);
    if (!res.ok) return "";
    const data = await res.json();
    const meetings = data.meetings || [];

    // Filter for this closer's recent calls (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const closerCalls = meetings.filter((m: { title?: string; created_at?: string; calendar_invitees?: { name?: string; email?: string }[] }) => {
      const created = new Date(m.created_at || "");
      if (created < weekAgo) return false;
      const title = (m.title || "").toLowerCase();
      const invitees = m.calendar_invitees || [];
      return closerAliases.some(a => title.includes(a.toLowerCase())) ||
        invitees.some(i => closerAliases.some(a =>
          (i.name || "").toLowerCase().includes(a.toLowerCase()) ||
          (i.email || "").toLowerCase().includes(a.toLowerCase())
        ));
    });

    if (closerCalls.length === 0) return "";

    return closerCalls.slice(0, 3).map((c: { title?: string; created_at?: string; url?: string }) =>
      `Call: ${c.title} | Date: ${(c.created_at || "").substring(0, 10)} | Recording: ${c.url || "N/A"}`
    ).join("\n");
  } catch {
    return "";
  }
}

/* ── Main Handler ───────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  // Verify cron secret
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

  // Dates in ET
  const now = new Date();
  const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayStr = etNow.toISOString().split("T")[0];
  const yesterday = new Date(etNow); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const monthStart = todayStr.substring(0, 8) + "01";

  // Fetch sales tracker data
  let sheetData: { rows: SheetRow[]; subscriptionsSold: number };
  try {
    sheetData = await fetchSheetData(monthStart, todayStr);
  } catch (err) {
    return NextResponse.json({ error: `Sheet data error: ${err}` }, { status: 500 });
  }

  const allRows = sheetData.rows;
  const todayRows = allRows.filter((r) => r.date === todayStr);
  const yesterdayRows = allRows.filter((r) => r.date === yesterdayStr);

  // MTD totals
  const taken = allRows.filter((r) => r.callTaken);
  const wins = allRows.filter((r) => r.outcome === "WIN");
  const noShows = allRows.filter((r) => ["NS/RS", "NS"].includes(r.outcome));
  const pcfus = allRows.filter((r) => r.outcome === "PCFU");
  const totalCash = allRows.reduce((s, r) => s + (r.cashCollected || 0), 0);
  const totalRevenue = allRows.reduce((s, r) => s + (r.revenue || 0), 0);
  const closeRate = taken.length > 0 ? (wins.length / taken.length * 100) : 0;
  const showRate = allRows.length > 0 ? (taken.length / allRows.length * 100) : 0;
  const aov = wins.length > 0 ? totalCash / wins.length : 0;

  const mtdSummary = `Cash: $${totalCash.toLocaleString()} | Rev: $${totalRevenue.toLocaleString()} | ${allRows.length} booked / ${taken.length} taken / ${wins.length} wins | CR: ${closeRate.toFixed(1)}% | SR: ${showRate.toFixed(1)}% | AOV: $${aov.toFixed(0)} | NS: ${noShows.length} | PCFUs: ${pcfus.length} | Subs: ${sheetData.subscriptionsSold}`;

  const results: { type: string; closer?: string; success: boolean; error?: string }[] = [];

  // ─── CLOSER BRIEFS ───
  for (const closer of CLOSERS) {
    const todayCalls = todayRows.filter((r) => closer.alias.some((a) => (r.closer || "").toUpperCase() === a));
    const yesterdayCalls = yesterdayRows.filter((r) => closer.alias.some((a) => (r.closer || "").toUpperCase() === a));
    const mtd = getCloserMTD(allRows, closer.alias);

    // Fetch DM transcripts for each prospect on today's schedule
    const prospectDetails: string[] = [];
    for (let i = 0; i < todayCalls.length; i++) {
      const r = todayCalls[i];
      const dmTranscript = await findDMTranscript(r.name, r.setter || "", r.offer || "");
      prospectDetails.push(`--- PROSPECT ${i + 1}: ${r.name} ---
Client: ${r.offer || "Unknown"}
Setter: ${r.setter || "Unknown"}

${dmTranscript
  ? `DM TRANSCRIPT (this is the actual conversation between the setter and prospect):\n${dmTranscript.substring(0, 3000)}`
  : `NO DM TRANSCRIPT FOUND — setter ${r.setter || "unknown"} has not uploaded the conversation for this prospect.`}
`);
    }

    // Fetch Fathom call data for this closer
    const fathomCalls = await fetchFathomTranscripts(closer.name, [...closer.alias, closer.name.split(" ")[0]]);

    const context = `Closer: ${closer.name}
Date: ${todayStr}
MTD: $${mtd.cash.toLocaleString()} cash | ${mtd.cr}% CR | ${mtd.sr}% SR | ${mtd.wins} wins / ${mtd.taken} taken / ${mtd.booked} booked

=== TODAY'S PROSPECTS (${todayCalls.length}) ===

${prospectDetails.join("\n")}

=== YESTERDAY'S CALLS (${yesterdayCalls.length}) ===
${yesterdayCalls.length === 0 ? "No calls yesterday." : yesterdayCalls.map((r) => `${r.name}: ${r.outcome || "No outcome"} | Setter: ${r.setter || "?"} | Client: ${r.offer || "?"} | Taken: ${r.callTaken} | Length: ${r.callLength || "?"} min | Objection: ${r.objection || "none"} | Cash: $${r.cashCollected || 0} | Recording: ${r.recordingLink || "N/A"}`).join("\n")}

=== RECENT FATHOM CALLS FOR ${closer.name.toUpperCase()} ===
${fathomCalls || "No recent Fathom recordings found."}

=== TEAM MTD ===
${mtdSummary}`;

    try {
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514", max_tokens: 5000,
        system: CLOSER_BRIEF_PROMPT,
        messages: [{ role: "user", content: `Generate the daily brief for ${closer.name}:\n\n${context}` }],
      });
      const brief = msg.content.filter((b) => b.type === "text").map((b) => b.type === "text" ? b.text : "").join("\n");
      const pdf = generatePDF(`Daily Brief — ${closer.name} (${todayStr})`, brief);
      await uploadFileAsCso(pdf, `brief-${closer.sheetKey.toLowerCase()}-${todayStr}.pdf`,
        `Daily Brief — ${closer.name} (${todayStr})`,
        `📋 *DAILY BRIEF — ${closer.name.toUpperCase()}*\n${todayCalls.length} calls | MTD: $${mtd.cash.toLocaleString()} | ${mtd.cr}% CR | ${mtd.sr}% SR`);
      results.push({ type: "closer_brief", closer: closer.name, success: true });
    } catch (err) {
      console.error(`[cron/daily-briefs] ${closer.name} error:`, err);
      results.push({ type: "closer_brief", closer: closer.name, success: false, error: String(err) });
    }
  }

  // ─── CEO RECAP ───
  try {
    const ceoContext = `MTD (${monthStart} to ${todayStr}):
${mtdSummary}

YESTERDAY (${yesterdayStr}):
${yesterdayRows.map((r) => `${r.name} | ${r.closer} | ${r.outcome || "pending"} | Setter: ${r.setter || "?"} | Cash: $${r.cashCollected || 0} | Obj: ${r.objection || "none"} | ${r.callLength || "?"} min | Recording: ${r.recordingLink || "N/A"} | Client: ${r.offer || "?"}`).join("\n") || "No calls yesterday."}

TODAY'S SCHEDULE:
${todayRows.map((r) => `${r.name} | ${r.closer} | Setter: ${r.setter || "?"} | Client: ${r.offer || "?"}`).join("\n") || "No calls today."}

CLOSER BREAKDOWN:
${CLOSERS.map((c) => { const m = getCloserMTD(allRows, c.alias); return `${c.name}: ${m.booked} booked | ${m.taken} taken | ${m.wins} wins | $${m.cash.toLocaleString()} | CR=${m.cr}% | SR=${m.sr}% | NS=${m.noShows}`; }).join("\n")}

SETTER BREAKDOWN:
${SETTERS.map((s) => { const d = getSetterMTD(allRows, s); return `${s} (${d.clients.join("/")}): ${d.booked} booked | ${d.taken} taken | ${d.wins} wins | ${d.noShows} NS | SR=${d.sr}%`; }).join("\n")}

CLIENT BREAKDOWN:
${["Tyson", "Keith"].map((cl) => { const cr = allRows.filter((r) => (r.offer || "").toLowerCase().includes(cl.toLowerCase())); const ct = cr.filter((r) => r.callTaken); const cw = cr.filter((r) => r.outcome === "WIN"); const cc = cr.reduce((s, r) => s + (r.cashCollected || 0), 0); return `${cl}: ${cr.length} booked | ${ct.length} taken | ${cw.length} wins | $${cc.toLocaleString()} | CR=${ct.length > 0 ? (cw.length / ct.length * 100).toFixed(1) : 0}%`; }).join("\n")}`;

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 6000,
      system: CEO_RECAP_PROMPT,
      messages: [{ role: "user", content: `Generate the CEO Daily Sales Recap:\n\n${ceoContext}` }],
    });
    const recap = msg.content.filter((b) => b.type === "text").map((b) => b.type === "text" ? b.text : "").join("\n");
    const pdf = generatePDF(`CEO Daily Sales Recap (${todayStr})`, recap);
    await uploadFileAsCso(pdf, `ceo-recap-${todayStr}.pdf`,
      `CEO Daily Sales Recap — ${todayStr}`,
      `📊 *CEO DAILY SALES RECAP — ${todayStr}*\nMTD: $${totalCash.toLocaleString()} | ${wins.length} wins | ${closeRate.toFixed(1)}% CR | ${showRate.toFixed(1)}% SR | $${aov.toFixed(0)} AOV`);
    results.push({ type: "ceo_recap", success: true });
  } catch (err) {
    console.error("[cron/daily-briefs] CEO recap error:", err);
    results.push({ type: "ceo_recap", success: false, error: String(err) });
  }

  return NextResponse.json({ success: true, date: todayStr, results, total: results.filter((r) => r.success).length });
}
