// Report delivery: every brief goes to #a-sales-manager as a PDF file with a
// short text comment (Matthew: "PDF style rather than plain text" — long Slack
// texts truncate on his phone). The per-call post stays a short text message.
//
// Jeremy writes Slack mrkdwn (*bold* labels, one idea per line); the PDF
// renderer (src/lib/pdf.ts) understands markdown headings, bullets and
// numbered lists, so the brief is translated line by line before rendering.
import { generatePDF } from "@/lib/pdf";
import { postAsCso, uploadFileAsCso } from "@/lib/slack";
import { fitSlack } from "@/lib/call-review-format";

/**
 * jsPDF's built-in Helvetica only knows WinAnsi. Anything outside it (emoji in
 * Instagram names, variation selectors, box characters) makes jsPDF fall back
 * to a 16-bit encoding for the whole line, which renders as spaced garbage —
 * so strip those and normalise the dashes and quotes it can't map. Pure.
 */
export function sanitizeForPdf(text: string): string {
  return text
    .replace(/[\u2014\u2015]/g, " - ").replace(/\u2013/g, "-")
    .replace(/[\u2018\u2019\u201A]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2026/g, "...").replace(/\u00A0/g, " ")
    .replace(/[\uFE00-\uFE0F\u200B-\u200D\u2060]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

/** Slack mrkdwn -> the markdown subset pdf.ts renders. Pure. */
export function mrkdwnToMarkdown(text: string): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const t = line.trim();
    // "*LABEL*" alone on a line is a section heading; "*LABEL* | rest" too.
    const heading = t.match(/^\*([^*]{2,80})\*\s*(?:\|\s*(.*))?$/);
    if (heading && !/^\*.*\*.*\*.*\*$/.test(t)) {
      out.push(`## ${heading[1].trim()}${heading[2] ? ` — ${heading[2].trim()}` : ""}`);
      continue;
    }
    let s = t
      .replace(/:rotating_light:/g, "!!").replace(/:white_check_mark:/g, "OK")
      .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2 ($1)").replace(/<(https?:\/\/[^>]+)>/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "**$1**")
      .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:])/g, "$1$2");
    if (/^[•·]\s*/.test(s)) s = s.replace(/^[•·]\s*/, "- ");
    out.push(s);
  }
  return out.join("\n");
}

export interface ReportDelivery {
  title: string; // PDF title + Slack file title
  filename: string; // e.g. daily-sales-brief-2026-09-18.pdf
  summary: string; // short Slack comment shown with the file (header lines)
  body: string; // full brief in Slack mrkdwn (header + Jeremy's sections)
}

/**
 * Upload the brief as a PDF with a short comment; if the upload fails, fall
 * back to the text post so the brief is never lost.
 */
export async function deliverReport(r: ReportDelivery): Promise<"pdf" | "text" | "failed"> {
  try {
    const pdf = generatePDF(sanitizeForPdf(r.title), sanitizeForPdf(mrkdwnToMarkdown(r.body)));
    const ok = await uploadFileAsCso(pdf, r.filename, r.title, r.summary);
    if (ok) return "pdf";
  } catch (e) {
    console.error("[report-delivery] pdf failed", e);
  }
  const ok = await postAsCso(fitSlack(r.body, 3800)).catch(() => false);
  return ok ? "text" : "failed";
}

/** Also handy for local previews: the PDF bytes for a brief. */
export function renderReportPdf(title: string, body: string): Buffer {
  return generatePDF(sanitizeForPdf(title), sanitizeForPdf(mrkdwnToMarkdown(body)));
}
