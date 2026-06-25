import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";
import { MAS_BRAIN_IDENTITY } from "@/lib/mas-brain/identity";

// "Ask Ahmad" query layer — Phase 3 (READ-ONLY).
// Answers a coach's situation in Ahmad's voice, grounded in his SOP library, and
// pulls a client's linked CCOS data on demand via tools. It writes NOTHING: no
// client notes, no query log, no escalations. Those arrive in Phase 4.
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

// Crude but dependable HTML -> text for SOP bodies (the sops table stores body_html).
function htmlToText(html: string): string {
  return (html || "")
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ── Tools (all read-only) ─────────────────────────────────────────── */

const TOOLS: Anthropic.Tool[] = [
  {
    name: "find_client",
    description:
      "Look up coaching clients by name (partial, case-insensitive) to identify who the coach means. Returns matches with id, full name, coach, program, status, and payment platform. If zero or more than one match, you MUST ask the coach to confirm the client's full name before giving client-specific advice. Never guess which client.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "client name or partial name" } },
      required: ["name"],
    },
  },
  {
    name: "get_client_context",
    description:
      "For a known client_id (from find_client), pull that client's linked CCOS data: their record (program, status, dates, payment platform), recent coach meetings, recent check-ins, pauses, finances, and any existing Ask-Ahmad notes. Use this before advising on a client-specific situation.",
    input_schema: {
      type: "object",
      properties: { client_id: { type: "number" } },
      required: ["client_id"],
    },
  },
  {
    name: "search_sops",
    description:
      "Search Ahmad's SOP library (the source of truth for how he runs coaching). Returns the most relevant SOP titles with ids and a snippet. Use this to find which SOP governs the situation, then read_sop to get the detail.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "keywords, e.g. 'refund dispute klarna' or 'pause program'" } },
      required: ["query"],
    },
  },
  {
    name: "read_sop",
    description: "Return the full text of one SOP by its id (from search_sops). Ground your answer in its actual content.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
];

async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  const sb = getServiceSupabase();

  if (name === "find_client") {
    const q = String(input.name || "").trim();
    if (!q) return "No name provided.";
    const { data, error } = await sb
      .from("clients")
      .select("id, name, coach_name, program, offer, status, payment_platform, start_date, end_date")
      .ilike("name", `%${q}%`)
      .limit(10);
    if (error) return `Error: ${error.message}`;
    if (!data || data.length === 0) return `No client matched "${q}". Ask the coach for the client's exact full name.`;
    return JSON.stringify(data);
  }

  if (name === "get_client_context") {
    const id = Number(input.client_id);
    if (!id) return "client_id is required.";
    const [client, meetings, checkins, pauses, finances, notes] = await Promise.all([
      sb.from("clients").select("*").eq("id", id).maybeSingle(),
      sb.from("coach_meetings").select("meeting_date, coach_name, notes").eq("client_id", id).order("meeting_date", { ascending: false }).limit(5),
      sb.from("client_check_ins").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(5),
      sb.from("program_pauses").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(5),
      sb.from("finances").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(10),
      sb.from("mas_client_notes").select("category, note, importance, created_by, created_at").eq("client_id", id).order("created_at", { ascending: false }).limit(20),
    ]);
    const ctx = {
      client: client.data || null,
      recent_meetings: meetings.data || [],
      recent_check_ins: checkins.data || [],
      pauses: pauses.data || [],
      finances: finances.data || [],
      ask_ahmad_notes: notes.data || [],
    };
    return truncate(JSON.stringify(ctx), 18000);
  }

  if (name === "search_sops") {
    const q = String(input.query || "").toLowerCase();
    const terms = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const { data, error } = await sb.from("sops").select("id, title, description, tags, body_html");
    if (error) return `Error: ${error.message}`;
    const scored = (data || []).map((s) => {
      const hay = `${s.title} ${s.description || ""} ${(s.tags || []).join(" ")}`.toLowerCase();
      const body = (s.body_html || "").toLowerCase();
      let score = 0;
      for (const t of terms) { if (hay.includes(t)) score += 3; if (body.includes(t)) score += 1; }
      return { id: s.id, title: s.title, tags: s.tags || [], snippet: htmlToText(s.body_html || "").slice(0, 200), score };
    }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
    if (scored.length === 0) {
      const all = (data || []).map((s) => ({ id: s.id, title: s.title }));
      return `No strong match. Available SOPs:\n${JSON.stringify(all)}`;
    }
    return JSON.stringify(scored.map(({ score, ...rest }) => { void score; return rest; }));
  }

  if (name === "read_sop") {
    const id = Number(input.id);
    const { data, error } = await sb.from("sops").select("title, body_html").eq("id", id).maybeSingle();
    if (error) return `Error: ${error.message}`;
    if (!data) return `No SOP with id ${id}.`;
    return truncate(`# ${data.title}\n\n${htmlToText(data.body_html || "")}`, 18000);
  }

  return `Unknown tool: ${name}`;
}

function systemPrompt(askerName: string | null): string {
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return `${MAS_BRAIN_IDENTITY}

---
RUNTIME CONTEXT
- Today's date: ${today}.
- You are being consulted by: ${askerName || "a coach"}.
- You have read-only tools: find_client, get_client_context, search_sops, read_sop. Use them to ground every answer in real SOPs and real client data. Never invent policy or client facts.
- For any client-specific question, call find_client first. If it returns zero or multiple matches, ask the coach for the client's full name and stop. Do not guess.
- This is a preview mode: you can read and advise, but you cannot save notes or escalate to Ahmad yet. If a situation truly needs Ahmad's ruling (especially disputes/refunds you are unsure about), say so plainly and tell the coach you will be able to escalate it once that is switched on.
- End every answer by asking the coach to come back and tell you how it went after they act.`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || null;
  if (!email) {
    return NextResponse.json({ error: "You must be signed in to ask Ahmad." }, { status: 401 });
  }
  const askerName = session?.user?.name || email;

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
        max_tokens: 1800,
        system: systemPrompt(askerName),
        tools: TOOLS,
        messages,
      });
      totals.input_tokens += resp.usage?.input_tokens || 0;
      totals.output_tokens += resp.usage?.output_tokens || 0;
      totals.cache_creation_input_tokens += resp.usage?.cache_creation_input_tokens || 0;
      totals.cache_read_input_tokens += resp.usage?.cache_read_input_tokens || 0;

      if (resp.stop_reason === "tool_use") {
        const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        const results = await Promise.all(
          toolUses.map(async (use) => {
            let output: string;
            try { output = await runTool(use.name, (use.input || {}) as Record<string, unknown>); }
            catch (err) { output = `Tool error: ${err instanceof Error ? err.message : "failed"}`; }
            return { type: "tool_result" as const, tool_use_id: use.id, content: output };
          }),
        );
        messages.push({ role: "assistant", content: resp.content });
        messages.push({ role: "user", content: results });
        continue;
      }

      answer = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text).join("\n").trim();
      break;
    }

    if (!answer) answer = "I could not reach a confident answer this time. Try giving me a bit more detail on the situation.";

    // Safety net: strip any em-dashes the model emits (Ahmad's voice rule).
    answer = answer.replace(/\s*—\s*/g, ", ");

    logAiUsage({ feature: `ask-ahmad:${email}`, model: MODEL, usage: totals });
    return NextResponse.json({ answer });
  } catch (err) {
    console.error("[ask-ahmad] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Ask Ahmad failed" }, { status: 500 });
  }
}
