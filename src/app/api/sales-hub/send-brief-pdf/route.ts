import { NextRequest, NextResponse } from "next/server";
import { getSalesManagerChannel, uploadFileToSlack } from "@/lib/slack";
import { generatePDF } from "@/lib/pdf";

/**
 * POST /api/sales-hub/send-brief-pdf
 * Generates a PDF from markdown content and uploads it to #a-sales-manager
 */
export async function POST(req: NextRequest) {
  try {
    const { title, content, filename } = await req.json();

    if (!title || !content) {
      return NextResponse.json({ error: "title and content required" }, { status: 400 });
    }

    const channel = getSalesManagerChannel();
    if (!channel) {
      return NextResponse.json({ error: "No Slack channel configured" }, { status: 500 });
    }

    const pdfBuffer = generatePDF(title, content);
    const fname = filename || `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;

    const sent = await uploadFileToSlack(
      channel,
      pdfBuffer,
      fname,
      title,
      title
    );

    return NextResponse.json({ sent, filename: fname });
  } catch (err) {
    console.error("[send-brief-pdf] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send PDF" },
      { status: 500 }
    );
  }
}
