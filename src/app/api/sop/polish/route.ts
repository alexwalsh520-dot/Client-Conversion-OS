/**
 * POST /api/sop/polish
 *   body: { html: string, title?: string }
 *   returns: { html: string, usage: { input_tokens, output_tokens } }
 *
 * Reformats a chunk of SOP HTML to the CCOS template via Claude. Admins
 * only. Used by the editor's "Polish with AI" button — caller swaps the
 * editor content with the response.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { polishSopHtml } from "@/lib/sop/polish";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PostBody {
  html?: string;
  title?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const html = body.html?.trim();
  if (!html) {
    return NextResponse.json({ error: "html is required" }, { status: 400 });
  }

  try {
    const result = await polishSopHtml(html, body.title);
    return NextResponse.json({
      html: result.html,
      usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
    });
  } catch (err) {
    console.error("[api/sop/polish] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "polish failed" },
      { status: 500 }
    );
  }
}
