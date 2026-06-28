import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Factory assist — the in-app "Claude" button on a doc/script/email asset.
// Reads the asset (body + comments) plus the project's funnel context
// (the composite avatar + SOP digest stored on factory_projects.context_md)
// and returns an edited draft. The client applies + saves it (so Alex can undo).
// ---------------------------------------------------------------------------

const SYSTEM = (ctx: string) =>
  `You are the CMO + senior direct-response copywriter building a cold-traffic DM funnel for a 1:1 fitness coaching offer. You write in the buyer's real voice, grounded ONLY in the funnel context below — never generic fitness fluff.

RULES:
- Use the avatar's REAL language, pains, objections, desires and triggers from the context. Reference them, don't invent.
- Lead with the converting psychology: "you don't have a discipline problem, you have a system problem", "trying vs committing", the operator mindset, identity preservation, the deadline/identity-threat trigger.
- Honest, masculine, specific. No hype words ("easy/simple/quick/guaranteed"), no emojis unless asked.
- When the user leaves COMMENTS on the doc, treat each as an edit instruction and apply it.
- Output ONLY the revised asset text (markdown), ready to paste. No preamble, no explanation, unless the instruction explicitly asks for analysis.

FUNNEL CONTEXT:
${ctx || "(no context loaded for this project yet)"}`;

export async function POST(req: NextRequest) {
  const s = await auth();
  if (!s?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const itemId = body?.itemId as string;
  const instruction = (body?.instruction as string) || "Improve this draft.";
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

  const sb = getServiceSupabase();
  const { data: item, error } = await sb
    .from("factory_items")
    .select("id, project_id, kind, label, body_md, copy_text, comments")
    .eq("id", itemId)
    .single();
  if (error || !item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const { data: project } = await sb
    .from("factory_projects")
    .select("context_md")
    .eq("id", item.project_id)
    .maybeSingle();

  const comments = Array.isArray(item.comments) ? item.comments : [];
  const commentText = comments.length
    ? comments
        .map((c: { author?: string; text?: string }) => `- [${c.author || "note"}] ${c.text || ""}`)
        .join("\n")
    : "(none)";

  const current = item.body_md || item.copy_text || "(empty — write it from scratch)";

  const userMsg = `ASSET: ${item.label} (kind: ${item.kind})

CURRENT DRAFT:
${current}

COMMENTS / NOTES ON THIS DRAFT:
${commentText}

INSTRUCTION: ${instruction}

Return the full revised asset.`;

  try {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM(project?.context_md || ""),
      messages: [{ role: "user", content: userMsg }],
    });
    logAiUsage({ feature: "factory-assist", model: MODEL, usage: resp.usage });
    const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
    return NextResponse.json({ draft: tb?.text || "(no response)" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "assist failed" }, { status: 500 });
  }
}
