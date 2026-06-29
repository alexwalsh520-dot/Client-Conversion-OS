import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";
import { postToSlack } from "@/lib/slack";
import { MAS_BRAIN_IDENTITY } from "@/lib/mas-brain/identity";

// "Ask Ahmad" query layer — Phase 4 (read + gated writes).
// Answers a coach's situation in Ahmad's voice, grounded in his SOP library, pulls a
// client's linked CCOS data, and writes back ONLY when it matters: important client
// notes, escalations to Ahmad's inbox (Slack ping if urgent), and outcomes a coach
// reports. Every query is logged to mas_queries so the brain learns from what is asked.
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

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

/* ── Tools ─────────────────────────────────────────────────────────── */

const TOOLS: Anthropic.Tool[] = [
  {
    name: "find_client",
    description:
      "Look up coaching clients by name (partial, case-insensitive) to identify who the coach means. Returns matches with id, full name, coach, program, status, payment platform. If zero or more than one match, you MUST ask the coach to confirm the client's full name before giving client-specific advice or writing anything. Never guess.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "get_client_context",
    description:
      "For a known client_id (from find_client), pull that client's linked CCOS data: record (program, status, dates, payment platform), recent coach meetings, check-ins, pauses, finances, and existing Ask-Ahmad notes. Use before advising on a client-specific situation.",
    input_schema: { type: "object", properties: { client_id: { type: "number" } }, required: ["client_id"] },
  },
  {
    name: "search_sops",
    description:
      "Search Ahmad's SOP library (the source of truth for how he runs coaching). Returns the most relevant SOP titles with ids and a snippet. Use to find which SOP governs the situation, then read_sop for detail.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "read_sop",
    description: "Return the full text of one SOP by id (from search_sops). Ground your answer in its actual content.",
    input_schema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  },
  {
    name: "save_client_note",
    description:
      "Save an important note about a client so the team and the brain remember it later. ONLY call this when the information is genuinely important: a resolved dispute approach, a macro-change rationale, a pause arrangement, a paid extra meal plan, or a meaningful judgment call. Do NOT save routine chatter or generic advice. You must have identified the client (a real client_id) first.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "number" },
        category: { type: "string", enum: ["macros", "disputes", "pausing", "meal_plans", "general"] },
        note: { type: "string", description: "the important fact, written concisely" },
        importance: { type: "string", enum: ["high", "normal"] },
      },
      required: ["client_id", "category", "note"],
    },
  },
  {
    name: "escalate_to_ahmad",
    description:
      "Flag a situation for Ahmad's review inbox when you are not confident, the situation is novel, or it needs his ruling (especially disputes/refunds you are unsure about). Set urgent=true only when the coach is waiting on an answer right now (this pings Ahmad on Slack). After calling this, tell the coach you have flagged it for Ahmad.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "number", description: "omit if the situation is general / no client identified" },
        situation_summary: { type: "string" },
        brain_take: { type: "string", description: "your best tentative read, if any" },
        uncertainty_reason: { type: "string", description: "why you are unsure" },
        urgent: { type: "boolean" },
      },
      required: ["situation_summary", "uncertainty_reason"],
    },
  },
  {
    name: "record_outcome",
    description:
      "When a coach reports back how a past situation turned out, record it against that client's most recent question. Confirm which client first (full name). Use this to close the loop from situation to result.",
    input_schema: {
      type: "object",
      properties: { client_id: { type: "number" }, outcome: { type: "string" } },
      required: ["client_id", "outcome"],
    },
  },
];

type AskState = { clientId: number | null; escalated: boolean };

async function pingAhmadSlack(summary: string, asker: string) {
  const channel = process.env.SLACK_CHANNEL_ASK_AHMAD;
  if (!channel) return; // no private channel configured → skip silently (no leaking to shared channels)
  try {
    await postToSlack(channel, `:brain: *Ask Ahmad — urgent* (from ${asker})\nA coach needs your ruling:\n> ${truncate(summary, 600)}\nOpen Coaching → Ask Ahmad → Review Inbox.`);
  } catch (e) {
    console.error("[ask-ahmad] slack ping failed:", e);
  }
}

async function runTool(name: string, input: Record<string, unknown>, email: string, state: AskState): Promise<string> {
  const sb = getServiceSupabase();

  if (name === "find_client") {
    const q = String(input.name || "").trim();
    if (!q) return "No name provided.";
    const { data, error } = await sb
      .from("clients")
      .select("id, name, coach_name, program, offer, status, payment_platform, start_date, end_date")
      .ilike("name", `%${q}%`).limit(10);
    if (error) return `Error: ${error.message}`;
    if (!data || data.length === 0) return `No client matched "${q}". Ask the coach for the client's exact full name.`;
    return JSON.stringify(data);
  }

  if (name === "get_client_context") {
    const id = Number(input.client_id);
    if (!id) return "client_id is required.";
    state.clientId = id;
    const [client, meetings, checkins, pauses, finances, notes] = await Promise.all([
      sb.from("clients").select("*").eq("id", id).maybeSingle(),
      sb.from("coach_meetings").select("meeting_date, coach_name, notes").eq("client_id", id).order("meeting_date", { ascending: false }).limit(5),
      sb.from("client_check_ins").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(5),
      sb.from("program_pauses").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(5),
      sb.from("finances").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(10),
      sb.from("mas_client_notes").select("category, note, importance, created_by, created_at").eq("client_id", id).order("created_at", { ascending: false }).limit(20),
    ]);
    return truncate(JSON.stringify({
      client: client.data || null, recent_meetings: meetings.data || [], recent_check_ins: checkins.data || [],
      pauses: pauses.data || [], finances: finances.data || [], ask_ahmad_notes: notes.data || [],
    }), 18000);
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
    if (scored.length === 0) return `No strong match. Available SOPs:\n${JSON.stringify((data || []).map((s) => ({ id: s.id, title: s.title })))}`;
    return JSON.stringify(scored.map(({ score, ...rest }) => { void score; return rest; }));
  }

  if (name === "read_sop") {
    const id = Number(input.id);
    const { data, error } = await sb.from("sops").select("title, body_html").eq("id", id).maybeSingle();
    if (error) return `Error: ${error.message}`;
    if (!data) return `No SOP with id ${id}.`;
    return truncate(`# ${data.title}\n\n${htmlToText(data.body_html || "")}`, 18000);
  }

  if (name === "save_client_note") {
    const id = Number(input.client_id);
    const note = String(input.note || "").trim();
    if (!id || !note) return "client_id and note are required.";
    const { error } = await sb.from("mas_client_notes").insert({
      client_id: id,
      category: String(input.category || "general"),
      note,
      importance: String(input.importance || "normal"),
      created_by: "mas-brain",
      source: "ask-ahmad",
    });
    if (error) return `Could not save the note: ${error.message}`;
    return "Saved. The note is now on this client's record.";
  }

  if (name === "escalate_to_ahmad") {
    const urgent = Boolean(input.urgent);
    const summary = String(input.situation_summary || "").trim();
    if (!summary) return "situation_summary is required.";
    const cid = input.client_id ? Number(input.client_id) : null;
    const { error } = await sb.from("mas_review_queue").insert({
      kind: "uncertain_situation",
      client_id: cid,
      asked_by: email,
      situation_summary: summary,
      brain_take: input.brain_take ? String(input.brain_take) : null,
      uncertainty_reason: input.uncertainty_reason ? String(input.uncertainty_reason) : null,
      urgent,
      status: "pending",
    });
    if (error) return `Could not flag it: ${error.message}`;
    state.escalated = true;
    if (urgent) await pingAhmadSlack(summary, email);
    return urgent
      ? "Flagged for Ahmad and pinged him (urgent). Tell the coach Ahmad will weigh in shortly."
      : "Flagged for Ahmad's review inbox. Tell the coach Ahmad will weigh in.";
  }

  if (name === "record_outcome") {
    const id = Number(input.client_id);
    const outcome = String(input.outcome || "").trim();
    if (!id || !outcome) return "client_id and outcome are required.";
    const { data: recent } = await sb.from("mas_queries")
      .select("id").eq("client_id", id).is("outcome", null)
      .order("created_at", { ascending: false }).limit(1);
    if (!recent || recent.length === 0) return "No open question found for that client to attach an outcome to.";
    const { error } = await sb.from("mas_queries")
      .update({ outcome, outcome_at: new Date().toISOString() }).eq("id", recent[0].id);
    if (error) return `Could not record the outcome: ${error.message}`;
    return "Recorded. The loop from situation to result is now captured.";
  }

  return `Unknown tool: ${name}`;
}

function systemPrompt(askerName: string | null, taught: string): string {
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return `${MAS_BRAIN_IDENTITY}
${taught ? `\n---\nWHAT AHMAD HAS TAUGHT YOU\nThese are Ahmad's own lessons and rulings, in his words. Apply them as his explicit, current guidance. When one of these conflicts with a generic reading of an SOP, follow Ahmad's lesson.\n${taught}\n` : ""}
---
RUNTIME CONTEXT
- Today's date: ${today}.
- You are being consulted by: ${askerName || "a coach"}.
- Read tools: find_client, get_client_context, search_sops, read_sop. Ground every answer in real SOPs and real client data. Never invent policy or client facts.
- For any client-specific question, call find_client first. If it returns zero or multiple matches, ask the coach for the client's full name and stop. Do not guess.
- Write tools (use sparingly and deliberately):
  - save_client_note: only when the info is genuinely important (a resolved approach, a macro-change rationale, a pause arrangement, a paid extra meal plan, a real judgment call). Never save routine chatter. Identify the client first.
  - escalate_to_ahmad: when you are not confident, the situation is novel, or it needs Ahmad's ruling. For disputes/refunds you are unsure about, do NOT give an unconfirmed answer — escalate and tell the coach to wait for Ahmad. Set urgent=true only if the coach is waiting right now (it pings Ahmad on Slack).
  - record_outcome: when a coach reports how a past situation turned out, confirm the client, then record it.
- End every answer by asking the coach to come back and tell you how it went after they act.`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || null;
  if (!email) return NextResponse.json({ error: "You must be signed in to ask Ahmad." }, { status: 401 });
  const askerName = session?.user?.name || email;

  let body: { question?: string; history?: Array<{ role: string; content: string }> };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  const question = body.question?.trim();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const history = (body.history || [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role as "user" | "assistant", content: truncate(m.content, 4000) }));

  // Pull Ahmad's approved lessons + rulings so the brain applies what he has taught.
  let taught = "";
  try {
    const { data: learnRows } = await getServiceSupabase()
      .from("mas_learning_feed").select("content").eq("approved", true)
      .order("created_at", { ascending: false }).limit(60);
    taught = (learnRows || []).map((r) => `- ${r.content}`).join("\n").slice(0, 6000);
  } catch { /* non-fatal: fall back to identity + SOPs only */ }

  const anthropic = new Anthropic();
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: question }];
  const totals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const state: AskState = { clientId: null, escalated: false };
  let answer = "";

  try {
    for (let round = 0; round < 8; round++) {
      const resp = await anthropic.messages.create({
        model: MODEL, max_tokens: 1800, system: systemPrompt(askerName, taught), tools: TOOLS, messages,
      });
      totals.input_tokens += resp.usage?.input_tokens || 0;
      totals.output_tokens += resp.usage?.output_tokens || 0;
      totals.cache_creation_input_tokens += resp.usage?.cache_creation_input_tokens || 0;
      totals.cache_read_input_tokens += resp.usage?.cache_read_input_tokens || 0;

      if (resp.stop_reason === "tool_use") {
        const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        const results = await Promise.all(toolUses.map(async (use) => {
          let output: string;
          try { output = await runTool(use.name, (use.input || {}) as Record<string, unknown>, email, state); }
          catch (err) { output = `Tool error: ${err instanceof Error ? err.message : "failed"}`; }
          return { type: "tool_result" as const, tool_use_id: use.id, content: output };
        }));
        messages.push({ role: "assistant", content: resp.content });
        messages.push({ role: "user", content: results });
        continue;
      }

      answer = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      break;
    }

    if (!answer) answer = "I could not reach a confident answer this time. Try giving me a bit more detail on the situation.";
    answer = answer.replace(/\s*—\s*/g, ", "); // em-dash safety net (Ahmad's voice rule)

    // Learning log: every question is recorded so recurring situations become visible,
    // even when no outcome is ever reported. Fire-and-forget; never blocks the answer.
    getServiceSupabase().from("mas_queries").insert({
      asked_by: email,
      client_id: state.clientId,
      question,
      brain_answer: answer,
      confidence: state.escalated ? "low" : null,
      escalated: state.escalated,
    }).then(({ error }) => { if (error) console.error("[ask-ahmad] query log failed:", error.message); });

    logAiUsage({ feature: `ask-ahmad:${email}`, model: MODEL, usage: totals });
    return NextResponse.json({ answer, escalated: state.escalated });
  } catch (err) {
    console.error("[ask-ahmad] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Ask Ahmad failed" }, { status: 500 });
  }
}
