/**
 * POST /api/sop/import  (multipart/form-data)
 *   file: PDF or DOCX (required)
 *   title: optional title hint for the polish step
 *
 *   returns: { html: string, source_filename: string }
 *
 * Extracts text from the uploaded file, then runs it through the polish
 * formatter so the returned HTML is already template-shaped. Used by
 * the New SOP page when the user drops a file.
 *
 * Admins only. Doesn't store the file — the body_html is what gets saved
 * when the user clicks "Create" in the editor afterwards.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import Anthropic from "@anthropic-ai/sdk";
import { logAiUsage } from "@/lib/ai-usage";
import mammoth from "mammoth";
import { polishSopHtml } from "@/lib/sop/polish";
import { sanitizeSopHtml } from "@/lib/sop/sanitize";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

const PDF_EXTRACT_PROMPT = `You are extracting the text content from a PDF document so it can be reformatted as a Standard Operating Procedure. Output ONLY the raw text content of the document. No commentary, no formatting metadata. Preserve paragraph breaks with blank lines. Preserve any obvious list structure (use "- " for bullets, "1. " for numbered items). Skip page numbers, headers, footers, and decorative elements. If the document has clearly distinct sections, separate them with blank lines.`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  const titleHint = (form.get("title") as string | null)?.trim() || undefined;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "file too large (max 25 MB)" }, { status: 413 });
  }

  const mime = file.type;
  const name = file.name || "import";
  const buffer = Buffer.from(await file.arrayBuffer());

  let rawText: string | null = null;

  try {
    if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
      rawText = await extractPdfTextViaClaude(buffer);
    } else if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.toLowerCase().endsWith(".docx")
    ) {
      const { value } = await mammoth.extractRawText({ buffer });
      rawText = value;
    } else {
      return NextResponse.json(
        { error: `Unsupported file type: ${mime || "unknown"}. Accepted: PDF, DOCX.` },
        { status: 400 }
      );
    }
  } catch (err) {
    console.error("[api/sop/import] extraction failed:", err);
    return NextResponse.json(
      { error: `Failed to extract text: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }

  if (!rawText || !rawText.trim()) {
    return NextResponse.json({ error: "No readable text in the file." }, { status: 422 });
  }

  // Wrap raw text in minimal HTML so the polisher has something to work with
  const wrappedHtml = rawText
    .trim()
    .split(/\n\n+/)
    .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  try {
    const polished = await polishSopHtml(wrappedHtml, titleHint);
    return NextResponse.json({
      html: polished.html || sanitizeSopHtml(wrappedHtml),
      source_filename: name,
    });
  } catch (err) {
    console.error("[api/sop/import] polish failed:", err);
    // Fall back to raw (sanitized) so the user still gets the extracted text
    return NextResponse.json({
      html: sanitizeSopHtml(wrappedHtml),
      source_filename: name,
      polish_error: err instanceof Error ? err.message : "polish failed",
    });
  }
}

async function extractPdfTextViaClaude(buffer: Buffer): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: buffer.toString("base64"),
            },
          },
          { type: "text", text: PDF_EXTRACT_PROMPT },
        ],
      },
    ],
  });

  logAiUsage({ feature: "sop-import", model: ANTHROPIC_MODEL, usage: response.usage });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude returned no text block for PDF extraction");
  }
  return block.text;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
