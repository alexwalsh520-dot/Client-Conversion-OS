import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";

// Teach Ahmad — admin only. Ahmad types a lesson and/or attaches screenshots; Sonnet
// (vision) reads them and distills a concise, first-person lesson the brain applies on
// future questions. Saved to mas_learning_feed as approved guidance (tag 'taught').
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";
const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

type ImageIn = { media_type?: string; data?: string };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: { text?: string; images?: ImageIn[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const text = (body.text || "").trim();
  const images = Array.isArray(body.images) ? body.images.slice(0, 6) : [];
  if (!text && images.length === 0) {
    return NextResponse.json({ error: "Add a note or at least one screenshot to teach." }, { status: 400 });
  }

  // Build the user content: the lesson text + any screenshots.
  const content: Anthropic.ContentBlockParam[] = [];
  content.push({
    type: "text",
    text: text
      ? `Here is something I want to teach you. My note:\n\n${text}${images.length ? "\n\n(Screenshots attached below.)" : ""}`
      : "Here are screenshots of something I want to teach you. Read them and capture the lesson.",
  });
  for (const img of images) {
    const media_type = String(img.media_type || "");
    let data = String(img.data || "");
    const comma = data.indexOf("base64,");
    if (comma !== -1) data = data.slice(comma + "base64,".length); // strip any data: URL prefix
    if (!ALLOWED.has(media_type) || !data) continue;
    content.push({
      type: "image",
      source: { type: "base64", media_type: media_type as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data },
    });
  }

  const system = `You are helping Ahmad teach his coaching brain. Ahmad is giving you a lesson, sometimes with screenshots, about how he thinks or how he handles a scenario in his fitness-coaching business.

Read his note and any screenshots carefully. Produce a concise, practical, first-person lesson (written as Ahmad, "I...") that captures the principle and exactly how he handles the scenario, so the brain can apply it to future situations. Keep it tight and specific. If screenshots show an example exchange, extract the reusable lesson, not the verbatim text. Never use em-dashes. Output ONLY the lesson, nothing else.`;

  try {
    const anthropic = new Anthropic();
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content }],
    });
    let lesson = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    lesson = lesson.replace(/\s*—\s*/g, ", ");
    if (!lesson) return NextResponse.json({ error: "Could not read that. Try rephrasing or a clearer screenshot." }, { status: 422 });

    const { error } = await getServiceSupabase().from("mas_learning_feed").insert({
      content: lesson,
      tags: ["taught"],
      approved: true,
    });
    if (error) return NextResponse.json({ error: `Saved the lesson but could not store it: ${error.message}` }, { status: 500 });

    logAiUsage({
      feature: `ask-ahmad-teach:${session.user.email.toLowerCase()}`,
      model: MODEL,
      usage: {
        input_tokens: resp.usage?.input_tokens || 0,
        output_tokens: resp.usage?.output_tokens || 0,
        cache_creation_input_tokens: resp.usage?.cache_creation_input_tokens || 0,
        cache_read_input_tokens: resp.usage?.cache_read_input_tokens || 0,
      },
    });

    return NextResponse.json({ lesson });
  } catch (err) {
    console.error("[ask-ahmad-teach] error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Teaching failed" }, { status: 500 });
  }
}
