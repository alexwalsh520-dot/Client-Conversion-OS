import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";
import { getResponseTimeMetrics, type SalesHubClient } from "@/lib/sales-hub/response-times";
import { getLeadHours } from "@/lib/sales-hub/lead-hours";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

// Who can use Ask AI, and their daily question limit (null = unlimited).
const ALLOWLIST: Record<string, number | null> = {
  "matthew@clientconversion.io": null,
  "alexwalsh520@gmail.com": null,
  "will@start2finishcoaching.com": 10,
};

const CLIENT_KEYS: Record<string, string> = {
  tyson: "tyson_sonnek",
  antwan: "antwan_rarcus",
};

const ET_TIMEZONE = "America/New_York";

function etDateStr(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// UTC instant of today's ET midnight (DST-safe: try the EDT offset, verify, fall back to EST).
function etMidnightUtcIso() {
  const dateStr = etDateStr();
  for (const offset of ["04", "05"]) {
    const candidate = new Date(`${dateStr}T${offset}:00:00Z`);
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: ET_TIMEZONE, hour: "2-digit", hourCycle: "h23" })
        .formatToParts(candidate)
        .find((p) => p.type === "hour")?.value,
    );
    if (hour === 0) return candidate.toISOString();
  }
  return new Date(`${dateStr}T05:00:00Z`).toISOString();
}

async function questionsUsedToday(email: string): Promise<number | null> {
  try {
    const sb = getServiceSupabase();
    const { count, error } = await sb
      .from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("feature", `ask-ai:${email}`)
      .gte("created_at", etMidnightUtcIso());
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

/* ── Tools ────────────────────────────────────────────────────────── */

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_response_time_metrics",
    description:
      "Setter response-time stats for a date range: team/offer/setter averages (to the second), misses (>5 min), per-business-hour buckets (11am-11pm ET), and the missed conversations. Samples only exist for ManyChat-tagged leads (personal DMs excluded).",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string", enum: ["all", "tyson", "antwan"] },
        dateFrom: { type: "string", description: "YYYY-MM-DD (ET)" },
        dateTo: { type: "string", description: "YYYY-MM-DD (ET)" },
      },
      required: ["dateFrom", "dateTo"],
    },
  },
  {
    name: "get_leads_by_hour",
    description:
      "New-lead volume by ET hour of day (0-23) for a date range, team-wide plus per offer and per setter. Source: ManyChat new_lead tag events.",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string", enum: ["all", "tyson", "antwan"] },
        dateFrom: { type: "string" },
        dateTo: { type: "string" },
      },
      required: ["dateFrom", "dateTo"],
    },
  },
  {
    name: "search_dms",
    description:
      "Search stored Instagram DM messages. Returns rows (subscriber_id, direction inbound=prospect/outbound=us, sent_at, text). Use `contains` for keyword filtering. Max 200 rows per call; bodies truncated.",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string", enum: ["tyson", "antwan"], description: "default tyson" },
        direction: { type: "string", enum: ["inbound", "outbound"] },
        contains: { type: "string", description: "case-insensitive substring filter on message text" },
        dateFrom: { type: "string", description: "ISO date, optional" },
        dateTo: { type: "string", description: "ISO date, optional" },
        limit: { type: "number", description: "max rows, default 100, cap 200" },
      },
    },
  },
  {
    name: "get_conversation",
    description:
      "Full DM thread for one subscriber_id (from search_dms or metrics), oldest to newest, up to 200 messages.",
    input_schema: {
      type: "object",
      properties: {
        subscriber_id: { type: "string" },
        client: { type: "string", enum: ["tyson", "antwan"] },
      },
      required: ["subscriber_id"],
    },
  },
];

async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  const sb = getServiceSupabase();

  if (name === "get_response_time_metrics") {
    const metrics = await getResponseTimeMetrics({
      client: ((input.client as string) || "all") as SalesHubClient,
      dateFrom: String(input.dateFrom),
      dateTo: String(input.dateTo),
    });
    const slim = {
      ...metrics,
      conversations: {
        total: metrics.conversations.length,
        missed: metrics.conversations.filter((c) => c.missed).slice(0, 30),
      },
    };
    return truncate(JSON.stringify(slim), 16000);
  }

  if (name === "get_leads_by_hour") {
    const data = await getLeadHours({
      client: ((input.client as string) || "all") as SalesHubClient,
      dateFrom: String(input.dateFrom),
      dateTo: String(input.dateTo),
    });
    return truncate(JSON.stringify(data), 12000);
  }

  if (name === "search_dms") {
    const clientKey = CLIENT_KEYS[(input.client as string) || "tyson"] || "tyson_sonnek";
    const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 200);
    let query = sb
      .from("dm_conversation_messages")
      .select("subscriber_id, direction, sent_at, body")
      .eq("client", clientKey)
      .order("sent_at", { ascending: false })
      .limit(limit);
    if (input.direction) query = query.eq("direction", String(input.direction));
    if (input.contains) query = query.ilike("body", `%${String(input.contains)}%`);
    if (input.dateFrom) query = query.gte("sent_at", `${String(input.dateFrom)}T00:00:00Z`);
    if (input.dateTo) query = query.lte("sent_at", `${String(input.dateTo)}T23:59:59Z`);
    const { data, error } = await query;
    if (error) return `Error: ${error.message}`;
    const rows = (data || []).map(
      (r) => `${r.sent_at} [${r.direction}] (${r.subscriber_id}) ${truncate(r.body || "", 300)}`,
    );
    return truncate(rows.join("\n") || "No messages found.", 16000);
  }

  if (name === "get_conversation") {
    const clientKey = CLIENT_KEYS[(input.client as string) || "tyson"] || "tyson_sonnek";
    const { data, error } = await sb
      .from("dm_conversation_messages")
      .select("direction, sent_at, body")
      .eq("client", clientKey)
      .eq("subscriber_id", String(input.subscriber_id))
      .order("sent_at", { ascending: true })
      .limit(200);
    if (error) return `Error: ${error.message}`;
    const rows = (data || []).map(
      (r) => `${r.sent_at} [${r.direction === "inbound" ? "PROSPECT" : "US"}] ${truncate(r.body || "", 500)}`,
    );
    return truncate(rows.join("\n") || "No messages found for that subscriber.", 16000);
  }

  return `Unknown tool: ${name}`;
}

/* ── System prompt ────────────────────────────────────────────────── */

function systemPrompt() {
  return `You are the Ask AI analyst inside CCOS (Client Conversion OS), a sales dashboard for Instagram-DM-based fitness coaching sales teams.

Today's date (ET): ${etDateStr()}.

Context:
- Clients/offers: "tyson" (Tyson Sonnek — the active offer) and "antwan" (Antwan Rarcus — onboarding, little data).
- Setters (Tyson): Amara, Kelechi, Debbie, Gideon, Erin. Closers: Will, Jacob, Austin.
- Business hours for response-time measurement: 11am-11pm ET. A "miss" = a reply slower than 5 business-hour minutes.
- Data sources you can query with tools: response-time metrics, new-lead volume by hour, and the raw Instagram DM messages (inbound = prospect, outbound = our team).
- DM data only exists from June 9, 2026 onward (when the Instagram connection went live). ManyChat lead tagging goes back further.

Rules:
- Use the tools to pull real data before answering. Never invent numbers.
- Default date range when unspecified: the current month to date.
- Be direct and concise. Lead with the answer, then the key numbers. Use short bullet lists, not essays.
- When reading DMs for qualitative questions (drop-off, best follow-ups), cite 2-3 concrete examples.
- If data is missing or too thin to answer reliably, say so plainly.`;
}

/* ── Handlers ─────────────────────────────────────────────────────── */

async function getSessionEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email?.toLowerCase() || null;
}

export async function GET() {
  const email = await getSessionEmail();
  if (!email || !(email in ALLOWLIST)) {
    return NextResponse.json({ allowed: false });
  }
  const limit = ALLOWLIST[email];
  let remainingToday: number | null = null;
  if (limit != null) {
    const used = await questionsUsedToday(email);
    remainingToday = used == null ? 0 : Math.max(0, limit - used);
  }
  return NextResponse.json({ allowed: true, dailyLimit: limit, remainingToday });
}

export async function POST(req: NextRequest) {
  const email = await getSessionEmail();
  if (!email || !(email in ALLOWLIST)) {
    return NextResponse.json({ error: "Ask AI is not enabled for this account." }, { status: 403 });
  }

  const limit = ALLOWLIST[email];
  if (limit != null) {
    const used = await questionsUsedToday(email);
    if (used == null) {
      return NextResponse.json(
        { error: "Usage tracking is unavailable right now — try again shortly." },
        { status: 503 },
      );
    }
    if (used >= limit) {
      return NextResponse.json(
        { error: `Daily limit reached (${limit} questions). Resets at midnight ET.` },
        { status: 429 },
      );
    }
  }

  let body: { question?: string; history?: Array<{ role: string; content: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const history = (body.history || [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role as "user" | "assistant", content: truncate(m.content, 4000) }));

  const anthropic = new Anthropic();
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: question }];
  const totals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let answer = "";

  try {
    for (let round = 0; round < 6; round++) {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: systemPrompt(),
        tools: TOOLS,
        messages,
      });

      totals.input_tokens += resp.usage?.input_tokens || 0;
      totals.output_tokens += resp.usage?.output_tokens || 0;
      totals.cache_creation_input_tokens += resp.usage?.cache_creation_input_tokens || 0;
      totals.cache_read_input_tokens += resp.usage?.cache_read_input_tokens || 0;

      if (resp.stop_reason === "tool_use") {
        const toolUses = resp.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        );
        const results = await Promise.all(
          toolUses.map(async (use) => {
            let output: string;
            try {
              output = await runTool(use.name, (use.input || {}) as Record<string, unknown>);
            } catch (err) {
              output = `Tool error: ${err instanceof Error ? err.message : "failed"}`;
            }
            return {
              type: "tool_result" as const,
              tool_use_id: use.id,
              content: output,
            };
          }),
        );
        messages.push({ role: "assistant", content: resp.content });
        messages.push({ role: "user", content: results });
        continue;
      }

      answer = resp.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      break;
    }

    if (!answer) {
      answer = "I ran out of analysis budget before reaching a conclusion — try a narrower question.";
    }

    logAiUsage({ feature: `ask-ai:${email}`, model: MODEL, usage: totals });

    let remainingToday: number | null = null;
    if (limit != null) {
      const used = await questionsUsedToday(email);
      // The fire-and-forget log may not have landed yet; count it locally.
      remainingToday = used == null ? null : Math.max(0, limit - used - 1);
    }

    return NextResponse.json({ answer, remainingToday });
  } catch (err) {
    console.error("[ask-ai] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ask AI failed" },
      { status: 500 },
    );
  }
}
