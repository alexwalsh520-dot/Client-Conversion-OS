import { jsPDF } from "jspdf";

export function generatePDF(title: string, markdownContent: string): Buffer {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 50;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const addPage = () => {
    doc.addPage();
    y = margin;
  };

  const checkPageBreak = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - margin) {
      addPage();
    }
  };

  // Title
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  const titleLines = doc.splitTextToSize(title, maxWidth);
  checkPageBreak(titleLines.length * 24 + 20);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 24 + 10;

  // Date
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} EST`, margin, y);
  y += 20;
  doc.setTextColor(0, 0, 0);

  // Divider
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  // Parse and render markdown lines
  const lines = markdownContent.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      y += 8;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      // H3
      checkPageBreak(30);
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      const text = trimmed.replace(/^###\s*/, "").replace(/\*\*/g, "");
      const wrapped = doc.splitTextToSize(text, maxWidth);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 16 + 6;
    } else if (trimmed.startsWith("## ")) {
      // H2
      checkPageBreak(36);
      y += 8;
      doc.setFontSize(15);
      doc.setFont("helvetica", "bold");
      const text = trimmed.replace(/^##\s*/, "").replace(/\*\*/g, "");
      const wrapped = doc.splitTextToSize(text, maxWidth);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 18 + 8;
    } else if (trimmed.startsWith("# ")) {
      // H1
      checkPageBreak(40);
      y += 10;
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      const text = trimmed.replace(/^#\s*/, "").replace(/\*\*/g, "");
      const wrapped = doc.splitTextToSize(text, maxWidth);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 22 + 10;
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      // Bullet point
      checkPageBreak(20);
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      const text = trimmed.replace(/^[-*]\s*/, "").replace(/\*\*/g, "");
      const wrapped = doc.splitTextToSize(text, maxWidth - 20);
      doc.text("\u2022", margin + 4, y);
      doc.text(wrapped, margin + 20, y);
      y += wrapped.length * 14 + 4;
    } else if (/^\d+\.\s/.test(trimmed)) {
      // Numbered list
      checkPageBreak(20);
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      const match = trimmed.match(/^(\d+\.)\s*(.*)/);
      if (match) {
        const num = match[1];
        const text = match[2].replace(/\*\*/g, "");
        const wrapped = doc.splitTextToSize(text, maxWidth - 25);
        doc.text(num, margin, y);
        doc.text(wrapped, margin + 25, y);
        y += wrapped.length * 14 + 4;
      }
    } else if (trimmed.startsWith("---")) {
      // Horizontal rule
      checkPageBreak(15);
      y += 5;
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, y, pageWidth - margin, y);
      y += 15;
    } else {
      // Regular paragraph
      checkPageBreak(20);
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      const text = trimmed.replace(/\*\*/g, "");
      const wrapped = doc.splitTextToSize(text, maxWidth);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 14 + 4;
    }
  }

  // Return as Buffer
  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
