/**
 * Sales Manager AI Agent Brain
 *
 * This is the core intelligence layer for the CCos AI Sales Manager.
 * It uses Claude to analyze sales data, review transcripts, and answer
 * questions about the sales pipeline â all via Slack.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { fetchSheetData } from "@/lib/google-sheets";
import { listMeetings } from "@/lib/fathom";
import { getMessages as getSendBlueMessages } from "@/lib/sendblue";
import { getSetterReportData } from "@/lib/setter-report-data";

// âââ Types âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// âââ Supabase Client âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase credentials not configured");
  return createClient(url, key);
}

// âââ Tool Definitions ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "get_live_setter_report",
    description: "Get live setter funnel data, live response timing, and live DM transcripts from the current CCOS tracking pipeline.",
    input_schema: {
      type: "object",
      properties: {
        reportDate: { type: "string", description: "Report date in YYYY-MM-DD format" },
        setter: { type: "string", description: "Optional setter name filter (Amara, Gideon, Kelechi, Debbie)" }
      },
      required: ["reportDate"]
    }
  },
  {
    name: "get_sales_dashboard",
    description: "Get current sales metrics for a date range. Returns cash collected, close rate, show rate, AOV, calls booked/taken, wins, losses, no-shows, and pending follow-ups. Can filter by client.",
    input_schema: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "Start date in YYYY-MM-DD format" },
        dateTo: { type: "string", description: "End date in YYYY-MM-DD format" },
        client: { type: "string", enum: ["all", "tyson", "keith", "zoe"], description: "Filter by client. Defaults to all." }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "get_closer_performance",
    description: "Get detailed performance metrics for all closers or a specific closer. Returns cash, AOV, close rate, show rate, calls booked/taken, wins, losses, and top objection.",
    input_schema: {
      type: "object",
      properties: {
        closer: { type: "string", description: "Closer name (Broz, Will, Jacob) or 'all' for everyone" },
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "get_setter_performance",
    description: "Get setter performance metrics including show rates broken down by closer. Shows which setter-closer combinations are performing well or poorly.",
    input_schema: {
      type: "object",
      properties: {
        setter: { type: "string", description: "Setter name (Amara, Kelechi, Gideon, Debbie) or 'all'" },
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "get_dm_transcripts",
    description: "Fetch DM transcripts for a specific setter. Returns the actual conversation text between the setter and prospects.",
    input_schema: {
      type: "object",
      properties: {
        setter: { type: "string", description: "Setter name" },
        limit: { type: "number", description: "Max transcripts to return. Default 10." },
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" }
      },
      required: ["setter"]
    }
  },
  {
    name: "get_call_transcripts",
    description: "Fetch call transcripts/Fathom notes for a specific closer. Returns meeting title, duration, attendees, and transcript text.",
    input_schema: {
      type: "object",
      properties: {
        closer: { type: "string", description: "Closer name" },
        limit: { type: "number", description: "Max transcripts to return. Default 5." },
        includeTranscript: { type: "boolean", description: "Include full transcript text. Default true." },
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" }
      },
      required: ["closer"]
    }
  },
  {
    name: "get_sendblue_messages",
    description: "Fetch Sendblue SMS/iMessage messages for a specific phone number or lead. Shows the confirmation and follow-up message history.",
    input_schema: {
      type: "object",
      properties: {
        phoneNumber: { type: "string", description: "Phone number in E.164 format (+15551234567)" },
        leadName: { type: "string", description: "Lead name to search for" },
        limit: { type: "number", description: "Max messages to return. Default 20." }
      },
      required: []
    }
  },
  {
    name: "get_no_show_analysis",
    description: "Get detailed analysis of no-shows: which setters are producing the most no-shows, patterns in timing, and which closer-setter combos have the worst show rates.",
    input_schema: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "get_revenue_breakdown",
    description: "Get revenue breakdown by offer, closer, and time period. Shows cash collected, revenue, AOV trends, and comparison to previous period.",
    input_schema: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" },
        groupBy: { type: "string", enum: ["closer", "offer", "day", "week"], description: "How to group the revenue data" }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "review_dm_transcript",
    description: "Run an AI review on a specific DM transcript, scoring it on qualification quality, urgency creation, objection handling, commitment extraction, and follow-up timing.",
    input_schema: {
      type: "object",
      properties: {
        transcriptId: { type: "string", description: "The transcript ID to review" },
        setter: { type: "string", description: "Setter name for context" }
      },
      required: ["transcriptId"]
    }
  },
  {
    name: "review_call_transcript",
    description: "Run an AI review on a specific call transcript, scoring the closer on rapport building, pain amplification, offer presentation, objection handling, and close attempt quality.",
    input_schema: {
      type: "object",
      properties: {
        callId: { type: "string", description: "The call/meeting ID to review" },
        closer: { type: "string", description: "Closer name for context" }
      },
      required: ["callId"]
    }
  },
  {
    name: "get_bottleneck_analysis",
    description: "Run a full funnel bottleneck analysis using the GAS Protocol. Identifies whether the primary revenue constraint is in Getting leads, Acquiring customers (show rate + close rate), or Scaling AOV.",
    input_schema: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "Start date YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date YYYY-MM-DD" },
        client: { type: "string", enum: ["all", "tyson", "keith", "zoe"], description: "Filter by client" }
      },
      required: ["dateFrom", "dateTo"]
    }
  },
  {
    name: "get_report_history",
    description: "Get previously generated reports (marketing, sales, call reviews, DM reviews, briefs).",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["all", "marketing", "sales", "call_review", "dm_review", "brief"], description: "Report type filter" },
        limit: { type: "number", description: "Max reports to return. Default 10." }
      },
      required: []
    }
  }
];

// âââ Tool Execution ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function executeTool(toolName: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (toolName) {
      case "get_live_setter_report": {
        const reportDate =
          (input.reportDate as string) || new Date().toISOString().split("T")[0];
        const setterFilter = (input.setter as string | undefined)?.toLowerCase().trim() || null;
        const data = await getSetterReportData(reportDate);

        const setters = data.setters.filter((row) => {
          if (!setterFilter) return true;
          return (
            row.setterName.toLowerCase().includes(setterFilter) ||
            row.setterKey.toLowerCase().includes(setterFilter)
          );
        });

        return JSON.stringify({
          reportDate: data.reportDate,
          weekStart: data.weekStart,
          monthStart: data.monthStart,
          dataQuality: data.dataQuality,
          setters: setters.map((row) => ({
            setterKey: row.setterKey,
            setterName: row.setterName,
            clientLabel: row.clientLabel,
            daily: row.daily,
            wtd: row.wtd,
            mtd: row.mtd,
            transcripts: row.transcripts,
          })),
        });
      }

      case "get_sales_dashboard":
      case "get_closer_performance":
      case "get_setter_performance":
      case "get_no_show_analysis":
      case "get_bottleneck_analysis": {
        // All use Google Sheets data directly — no HTTP calls
        const rows = await fetchSheetData(
          input.dateFrom as string,
          input.dateTo as string
        );

        // Filter by client if specified
        let filtered = rows;
        if (input.client && input.client !== "all" && input.client !== "both") {
          const clientName =
            input.client === "tyson"
              ? "Tyson Sonnek"
              : input.client === "keith"
                ? "Keith Holland"
                : "Zoe and Emily";
          filtered = rows.filter(r => r.offer === clientName);
        }

        // Filter by closer if specified
        if (input.closer && input.closer !== "all") {
          filtered = filtered.filter(r =>
            (r.closer || "").toLowerCase().includes((input.closer as string).toLowerCase())
          );
        }

        // Filter by setter if specified
        if (input.setter && input.setter !== "all") {
          filtered = filtered.filter(r =>
            (r.setter || "").toLowerCase().includes((input.setter as string).toLowerCase())
          );
        }

        // Compute aggregate metrics
        const taken = filtered.filter(r => r.callTaken);
        const wins = filtered.filter(r => r.outcome === "WIN");
        const losses = filtered.filter(r => r.outcome === "LOST");
        const noShows = filtered.filter(r => r.outcome === "NS/RS" || r.outcome === "NS");
        const pcfu = filtered.filter(r => r.outcome === "PCFU");
        const cash = filtered.reduce((sum, r) => sum + (r.cashCollected || 0), 0);
        const revenue = filtered.reduce((sum, r) => sum + (r.revenue || 0), 0);

        const result = {
          totalRows: filtered.length,
          callsTaken: taken.length,
          wins: wins.length,
          losses: losses.length,
          noShows: noShows.length,
          pcfu: pcfu.length,
          cashCollected: cash,
          revenue,
          closeRate: taken.length > 0 ? Math.round((wins.length / taken.length) * 1000) / 10 : 0,
          showRate: filtered.length > 0 ? Math.round((taken.length / filtered.length) * 1000) / 10 : 0,
          aov: wins.length > 0 ? Math.round(cash / wins.length) : 0,
          rows: filtered.map(r => ({
            date: r.date, name: r.name, closer: r.closer, setter: r.setter,
            outcome: r.outcome, cashCollected: r.cashCollected, revenue: r.revenue,
            offer: r.offer, objection: r.objection, callNotes: r.callNotes,
            callLength: r.callLength, callTaken: r.callTaken
          }))
        };
        return JSON.stringify(result);
      }

      case "get_dm_transcripts": {
        const reportDate =
          (input.dateTo as string) ||
          new Date().toISOString().split("T")[0];
        const liveData = await getSetterReportData(reportDate);
        const setterFilter = (input.setter as string).toLowerCase().trim();
        const limit = (input.limit as number) || 10;

        const liveMatches = liveData.setters
          .filter((row) =>
            row.setterName.toLowerCase().includes(setterFilter) ||
            row.setterKey.toLowerCase().includes(setterFilter)
          )
          .flatMap((row) =>
            row.transcripts.map((transcript) => ({
              source: "live_dm_conversation_messages",
              setter: row.setterName,
              client: row.clientLabel,
              ...transcript,
            }))
          )
          .slice(0, limit);

        if (liveMatches.length > 0) {
          return JSON.stringify(liveMatches);
        }

        const supabase = getSupabase();
        let query = supabase
          .from("dm_transcripts")
          .select("*")
          .ilike("setter_name", `%${input.setter}%`)
          .order("submitted_at", { ascending: false })
          .limit(limit);

        if (input.dateFrom) query = query.gte("submitted_at", `${input.dateFrom}T00:00:00Z`);
        if (input.dateTo) query = query.lte("submitted_at", `${input.dateTo}T23:59:59Z`);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ source: "legacy_dm_transcripts", transcripts: data });
      }

      case "get_call_transcripts": {
        // Use Fathom lib directly — no HTTP
        const opts: { createdAfter?: string; createdBefore?: string; includeTranscript?: boolean } = {
          includeTranscript: input.includeTranscript !== false,
        };
        if (input.dateFrom) opts.createdAfter = `${input.dateFrom}T00:00:00Z`;
        if (input.dateTo) opts.createdBefore = `${input.dateTo}T23:59:59Z`;

        const meetings = await listMeetings(opts);

        // Filter to sales calls (exclude internal meetings)
        const TEAM_EMAILS = new Set([
          "matthew@clientconversion.io", "alex@clientconversion.io", "alexwalsh520@gmail.com",
          "brozee2019@gmail.com", "will@start2finishcoaching.com", "williamluke.buckley21@gmail.com",
          "austinrichard6@gmail.com", "tysonnek29@gmail.com", "keithholland35@gmail.com",
        ]);
        const INTERNAL_TITLES = ["huddle", "training", "1:1", "management", "c suite", "setter connect", "interview"];

        const salesCalls = meetings.filter(m => {
          const title = (m.title || "").toLowerCase();
          if (INTERNAL_TITLES.some(t => title.includes(t))) return false;
          const hasExternal = m.calendar_invitees?.some(
            (a: { email?: string; is_external?: boolean }) => a.is_external || !TEAM_EMAILS.has(a.email || "")
          );
          return hasExternal;
        });

        // Filter by closer if specified
        let filtered = salesCalls;
        if (input.closer) {
          const closerLower = (input.closer as string).toLowerCase();
          filtered = salesCalls.filter(m => {
            if (m.title?.toLowerCase().includes(closerLower)) return true;
            return m.calendar_invitees?.some(
              (a: { name?: string; email?: string }) =>
                (a.name || "").toLowerCase().includes(closerLower) ||
                (a.email || "").toLowerCase().includes(closerLower)
            );
          });
        }

        const limited = filtered.slice(0, (input.limit as number) || 5);
        return JSON.stringify(limited);
      }

      case "get_sendblue_messages": {
        // Try SendBlue API directly
        if (input.phoneNumber) {
          try {
            const messages = await getSendBlueMessages(input.phoneNumber as string);
            return JSON.stringify(messages);
          } catch {
            return JSON.stringify({ error: "SendBlue not configured or phone number invalid" });
          }
        }
        // Fall back to Supabase for lead name search
        const supabase = getSupabase();
        let query = supabase
          .from("sendblue_messages")
          .select("*")
          .order("created_at", { ascending: false })
          .limit((input.limit as number) || 20);

        if (input.leadName) query = query.ilike("lead_name", `%${input.leadName}%`);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify(data);
      }

      case "get_revenue_breakdown": {
        // Use Google Sheets directly
        const rows = await fetchSheetData(
          input.dateFrom as string,
          input.dateTo as string
        );
        const wins = rows.filter(r => r.outcome === "WIN");
        const byCloser: Record<string, { cash: number; count: number; revenue: number }> = {};
        const byOffer: Record<string, { cash: number; count: number; revenue: number }> = {};

        for (const r of wins) {
          const closer = r.closer || "Unknown";
          const offer = r.offer || "Unknown";
          if (!byCloser[closer]) byCloser[closer] = { cash: 0, count: 0, revenue: 0 };
          byCloser[closer].cash += r.cashCollected || 0;
          byCloser[closer].count += 1;
          byCloser[closer].revenue += r.revenue || 0;
          if (!byOffer[offer]) byOffer[offer] = { cash: 0, count: 0, revenue: 0 };
          byOffer[offer].cash += r.cashCollected || 0;
          byOffer[offer].count += 1;
          byOffer[offer].revenue += r.revenue || 0;
        }

        return JSON.stringify({ byCloser, byOffer, totalCash: wins.reduce((s, r) => s + (r.cashCollected || 0), 0) });
      }

      case "review_dm_transcript": {
        // Fetch transcript from Supabase and review with Claude inline
        const supabase = getSupabase();
        const { data: transcript } = await supabase
          .from("dm_transcripts")
          .select("*")
          .eq("id", input.transcriptId)
          .single();

        if (!transcript) return JSON.stringify({ error: "Transcript not found" });
        return JSON.stringify({
          id: transcript.id,
          setter: transcript.setter_name,
          client: transcript.client,
          transcript: transcript.transcript?.substring(0, 3000),
          note: "Transcript loaded. Analyze it in your response."
        });
      }

      case "review_call_transcript": {
        // Fetch from Fathom directly
        const meetings = await listMeetings({
          includeTranscript: true,
          createdAfter: new Date(Date.now() - 30 * 86400000).toISOString(),
        });
        const call = meetings.find(m =>
          m.url?.includes(input.callId as string) ||
          m.recording_id?.toString() === input.callId
        );
        if (!call) return JSON.stringify({ error: "Call not found in Fathom" });
        return JSON.stringify(call);
      }

      case "get_report_history": {
        const supabase = getSupabase();
        let query = supabase
          .from("report_history")
          .select("*")
          .order("created_at", { ascending: false })
          .limit((input.limit as number) || 10);

        if (input.type && input.type !== "all") {
          query = query.eq("type", input.type);
        }

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify(data);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({ error: message });
  }
}

// âââ System Prompt âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const SYSTEM_PROMPT = `You are the AI Chief Sales Officer for Client Conversion OS. Your name is "Sales Brain." You report directly to Matthew Conder (CEO/Founder). Your only job is to make the business more money.

## WHO YOU ARE
You are a hard-nosed sales manager. You do not guess. You do not use fluff. You use the numbers, the DM conversations, the reminder messages, and the call transcripts to find the easiest lever to improve right now.

## THE BUSINESS
Client Conversion OS manages sales for fitness coaching businesses. Current offers:
- **Tyson Sonnek** — biggest live DM volume
- **Keith Holland** — lower live DM volume
- **Zoe and Emily** — newest offer, judge lightly until real ad traffic is in

## THE TEAM
**Closers:** Broz, Will, Jacob

**Setters:** Amara (Tyson), Gideon (Keith), Kelechi (Zoe and Emily), Debbie (Zoe and Emily)

## THE SALES FUNNEL
DM Prospect â Qualify â Book Call â Confirm â Show Up â Close â Collect Cash

For setter coaching, use the live DM funnel first:
- new lead
- engaged
- goal clear
- gap clear
- stakes clear
- qualified
- link sent
- booked

Key metrics and benchmarks:
- DM Booking Rate: Target 15%+
- Show Rate: Target 70%+ (currently 55% â MAJOR LEAK)
- Close Rate: Target 40%+ (currently 44.8% â STRONG)
- AOV: Target $2,500+ (currently $1,653 â ROOM TO GROW)
- Revenue Per Show: Target $1,000+ (currently $741)

## HOW YOU THINK
1. Always start with the NUMBERS. Pull the actual data before giving advice.
2. Focus on the LOWEST-HANGING FRUIT first.
3. Focus on the BIGGEST LEVER first (what single change makes the most money fastest).
4. Be SPECIFIC â name names, cite conversations, reference exact metrics.
5. When reviewing transcripts, score against the framework: Pain â Commitment â Urgency â Book â Confirm.
6. Never give advice without backing it up with data from the tools.
7. Give no more than 3 action items at a time unless asked.
8. If data is missing, say exactly what is missing instead of pretending.

## HOW YOU RESPOND
- Keep it sharp and direct. No fluff.
- Use numbers and percentages. Always.
- When someone asks a question, PULL THE DATA FIRST using your tools, then answer.
- Format responses for Slack (use *bold*, _italic_, and bullet points with â¢).
- If you identify a problem, also provide the specific fix and why it should lift booking rate, show rate, close rate, or AOV.
- Reference the GAS Protocol: Get leads â Acquire customers â Scale revenue.

## ALERT THRESHOLDS
Flag immediately when:
- Show rate drops below 50%
- Close rate drops below 35%
- Any setter's show rate drops below 40%
- A closer goes 3+ calls without a win
- No-shows exceed 5 in a single day
- Cash collected pace is below target for the period

## REVIEW FRAMEWORK

### DM Reviews (Setters)
Score each conversation on:
1. **Hook Quality** (0-10): Did they open with something personalized?
2. **Pain Amplification** (0-10): Did they dig into the prospect's pain?
3. **Qualification** (0-10): Did they confirm budget, timeline, authority?
4. **Commitment Extraction** (0-10): Did they get a verbal "yes I'll show up"?
5. **Urgency Creation** (0-10): Did they create real urgency to book NOW?
6. **Confirmation Cadence** (0-10): Post-booking follow-up quality.

### Call Reviews (Closers)
Score each call on:
1. **Rapport** (0-10): Connection in first 5 minutes
2. **Pain Discovery** (0-10): Deep questioning, emotional drivers
3. **Future Pacing** (0-10): Painted the vision of success
4. **Offer Presentation** (0-10): Clear, compelling, structured
5. **Objection Handling** (0-10): Addressed concerns without being pushy
6. **Close Attempt** (0-10): Asked for the sale confidently

Today's date: ${new Date().toISOString().split("T")[0]}
Default date range for "this month": ${new Date().toISOString().slice(0, 8)}01 to ${new Date().toISOString().split("T")[0]}
`;

// âââ Main Agent Function âââââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function runSalesAgent(userMessage: string, conversationHistory?: Array<{ role: string; content: string }>): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  // Build messages array with optional conversation history
  const messages: Anthropic.MessageParam[] = [];

  if (conversationHistory) {
    for (const msg of conversationHistory.slice(-10)) { // Keep last 10 for context window
      messages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content
      });
    }
  }

  messages.push({ role: "user", content: userMessage });

  // Agentic loop â keep going until we have a final text response
  let response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: AGENT_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool["input_schema"]
    })),
    messages
  });

  // Process tool calls in a loop
  while (response.stop_reason === "tool_use") {
    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    // Execute all tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of assistantContent) {
      if (block.type === "tool_use") {
        const result = await executeTool(block.name, block.input as Record<string, unknown>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result
        });
      }
    }

    messages.push({ role: "user", content: toolResults });

    // Continue the conversation
    response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: AGENT_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool["input_schema"]
      })),
      messages
    });
  }

  // Extract the final text response
  const textBlocks = response.content.filter(b => b.type === "text");
  return textBlocks.map(b => b.type === "text" ? b.text : "").join("\n");
}

// âââ Auto-Review Functions âââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function autoReviewNewCalls(): Promise<string[]> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`;
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  const closers = ["Broz", "Will", "Jacob"];
  const reviews: string[] = [];

  for (const closer of closers) {
    try {
      const res = await fetch(
        `${baseUrl}/api/sales-hub/fathom-calls?closer=${closer}&dateFrom=${yesterday}&dateTo=${today}&includeTranscript=true`
      );
      const calls = await res.json();

      if (!Array.isArray(calls)) continue;

      for (const call of calls) {
        // Review each call with the agent
        const review = await runSalesAgent(
          `Review this call transcript for closer ${closer}. Meeting: "${call.title}". Duration: ${call.duration || "unknown"}. Attendees: ${JSON.stringify(call.attendees || [])}. Transcript: ${call.transcript || "No transcript available"}. Give me the Stop/Start/Keep Doing format with scores.`
        );
        reviews.push(`*${closer}* â ${call.title}\n${review}`);
      }
    } catch (err) {
      console.error(`Error reviewing calls for ${closer}:`, err);
    }
  }

  return reviews;
}

export async function autoReviewNewDMs(): Promise<string[]> {
  const reviews: string[] = [];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  try {
    const liveData = await getSetterReportData(yesterday);
    const rowsWithTranscripts = liveData.setters.filter(
      (row) => row.transcripts.length > 0
    );

    if (rowsWithTranscripts.length === 0) {
      const supabase = getSupabase();
      const cutoff = new Date(Date.now() - 86400000).toISOString();
      const { data: transcripts } = await supabase
        .from("dm_transcripts")
        .select("*")
        .gte("created_at", cutoff)
        .is("reviewed_at", null)
        .order("created_at", { ascending: false });

      if (!transcripts || transcripts.length === 0) return [];

      const bySetterMap = new Map<string, typeof transcripts>();
      for (const transcript of transcripts) {
        const setter = transcript.setter_name || "Unknown";
        if (!bySetterMap.has(setter)) bySetterMap.set(setter, []);
        bySetterMap.get(setter)!.push(transcript);
      }

      for (const [setter, setterTranscripts] of bySetterMap) {
        const summary = setterTranscripts
          .map((transcript, index) => `Conversation ${index + 1} (Lead: ${transcript.lead_name || "Unknown"}):\n${transcript.transcript || transcript.messages || "No content"}`)
          .join("\n\n---\n\n");

        const review = await runSalesAgent(
          `Review these ${setterTranscripts.length} DM transcripts from setter ${setter}. Give me the 1-3 lowest-hanging actions to lift booking rate and show rate. Use specific examples.\n\n${summary}`
        );

        reviews.push(`*${setter}* (${setterTranscripts.length} conversations)\n${review}`);

        const ids = setterTranscripts.map((transcript) => transcript.id);
        await supabase
          .from("dm_transcripts")
          .update({ reviewed_at: new Date().toISOString() })
          .in("id", ids);
      }

      return reviews;
    }

    for (const row of rowsWithTranscripts) {
      const summary = row.transcripts
        .slice(0, 5)
        .map(
          (transcript, index) =>
            `Conversation ${index + 1} (Lead: ${transcript.leadName || "Unknown"}):\n${transcript.transcript || "No content"}`
        )
        .join("\n\n---\n\n");

      const review = await runSalesAgent(
        `Review these ${row.transcripts.length} live DM transcripts from setter ${row.setterName} for ${row.clientLabel}. Daily funnel: ${JSON.stringify(row.daily)}. Week-to-date funnel: ${JSON.stringify(row.wtd)}. Month-to-date funnel: ${JSON.stringify(row.mtd)}. Give me the 1-3 lowest-hanging actions to lift booking rate and show rate. Use specific examples and tie each action to the funnel drop-off.\n\n${summary}`
      );

      reviews.push(`*${row.setterName}* (${row.clientLabel})\n${review}`);
    }
  } catch (err) {
    console.error("Error reviewing DMs:", err);
  }

  return reviews;
}

// âââ Alert Check âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function checkAlerts(): Promise<string[]> {
  const alerts: string[] = [];
  const today = new Date().toISOString().split("T")[0];
  const monthStart = today.slice(0, 8) + "01";

  try {
    const dashboardData = await executeTool("get_sales_dashboard", {
      dateFrom: monthStart,
      dateTo: today,
      client: "all"
    });
    const data = JSON.parse(dashboardData);

    // Check show rate
    if (data.showRate && data.showRate < 50) {
      alerts.push(`ð¨ *CRITICAL: Show rate dropped to ${data.showRate}%* (threshold: 50%). Estimated revenue loss: $${Math.round((0.50 - data.showRate / 100) * data.callsBooked * 741)} this month.`);
    }

    // Check close rate
    if (data.closeRate && data.closeRate < 35) {
      alerts.push(`ð¨ *CRITICAL: Close rate dropped to ${data.closeRate}%* (threshold: 35%). Closers need immediate attention.`);
    }

    // Check no-shows today
    if (data.todayNoShows && data.todayNoShows >= 5) {
      alerts.push(`â ï¸ *${data.todayNoShows} no-shows today.* Something is off with confirmations. Check Sendblue messages.`);
    }

    // Check setter-level show rates
    const setterData = await executeTool("get_setter_performance", {
      dateFrom: monthStart,
      dateTo: today
    });
    const setters = JSON.parse(setterData);

    if (Array.isArray(setters)) {
      for (const setter of setters) {
        if (setter.showRate && setter.showRate < 40 && setter.booked >= 5) {
          alerts.push(`â ï¸ *${setter.name}'s show rate is ${setter.showRate}%* across ${setter.booked} booked calls. Below 40% threshold.`);
        }
      }
    }

  } catch (err) {
    console.error("Error checking alerts:", err);
    alerts.push("â ï¸ Error running alert checks. Check server logs.");
  }

  return alerts;
}
