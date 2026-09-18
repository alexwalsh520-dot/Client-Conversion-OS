// Brief PDF renderer — "field notebook" style (owner's reference design):
// warm cream graph-paper page, heavy display title with a green hand-drawn
// underline swoosh, yellow label chips, and white bordered section cards with
// offset black shadows. Every Slack-delivered brief (sales, marketing, weekly,
// DM Brief, tracker shadow) goes through generatePDF via report-delivery.ts.
//
// Input is the markdown subset produced by mrkdwnToMarkdown + sanitizeForPdf
// (Latin-1 only): `## Heading` sections, `**bold**` spans, `- ` bullets,
// `1.` numbered lines, `---` rules, pipe-separated stat lines, plain lines.
//
// Fonts: Archivo Black (display) + Inter regular/bold (body), OFL, embedded
// from src/lib/pdf-fonts.ts. If embedding ever fails we fall back to
// helvetica — a brief must never fail to render over a font.
import { jsPDF } from "jspdf";
import { ARCHIVO_BLACK_TTF, INTER_BOLD_TTF, INTER_REGULAR_TTF } from "@/lib/pdf-fonts";

// ---------------------------------------------------------------------------
// Palette + layout constants
// ---------------------------------------------------------------------------

const CREAM: RGB = [245, 243, 232]; // #F5F3E8 page
const GRID: RGB = [233, 229, 212]; // #E9E5D4 graph-paper lines
const INK: RGB = [20, 20, 20]; // #141414 near-black
const BODY: RGB = [51, 51, 51]; // #333 body text
const LEDE: RGB = [85, 85, 85]; // #555 subtitle
const MUTED: RGB = [119, 119, 119]; // #777 small meta
const FOOT: RGB = [153, 153, 153]; // #999 footer
const YELLOW: RGB = [247, 214, 74]; // #F7D64A chips
const GREEN: RGB = [40, 162, 76]; // #28A24C swoosh / improvements
const RED: RGB = [222, 75, 50]; // #DE4B32 misses
const WHITE: RGB = [255, 255, 255];

type RGB = [number, number, number];

const GRID_CELL = 24; // graph-paper cell size, pt
const MARGIN = 46; // page side margin
const FOOTER_H = 34; // space reserved above bottom edge
const CARD_PAD_X = 14;
const CARD_PAD_TOP = 16;
const CARD_PAD_BOTTOM = 14;
const CARD_RADIUS = 10;
const CARD_SHADOW = 3; // offset of black shadow rect
const CHIP_H = 21;
const CHIP_RADIUS = 8;
const CHIP_SHADOW = 2.5;
const SECTION_GAP = 26; // gap between a card's bottom and the next chip

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

let fontsOk: boolean | null = null; // per-process memo of whether embedding works

function registerFonts(doc: jsPDF): boolean {
  if (fontsOk === false) return false;
  try {
    doc.addFileToVFS("ArchivoBlack-Regular.ttf", ARCHIVO_BLACK_TTF);
    doc.addFont("ArchivoBlack-Regular.ttf", "ArchivoBlack", "normal");
    doc.addFileToVFS("Inter-Regular.ttf", INTER_REGULAR_TTF);
    doc.addFont("Inter-Regular.ttf", "Inter", "normal");
    doc.addFileToVFS("Inter-Bold.ttf", INTER_BOLD_TTF);
    doc.addFont("Inter-Bold.ttf", "Inter", "bold");
    doc.setFont("Inter", "normal"); // throws if registration failed
    fontsOk = true;
    return true;
  } catch (e) {
    console.error("[pdf] custom fonts unavailable, falling back to helvetica", e);
    fontsOk = false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rich text (bold spans + conservative accent colors)
// ---------------------------------------------------------------------------

interface Token {
  text: string;
  bold: boolean;
  color: RGB;
}

interface RichLine {
  tokens: Token[];
  width: number;
}

const RED_WORD = /^(no-shows?|missed|misses|fail|fails|failed|failing)[.,;:!)]?$/i;
const ZERO_PCT = /^\(?0(\.0+)?%[.,;:!)]?$/;
const MONEY = /^\(?[+-]?\$[\d,]+(\.\d+)?[kKmM]?[.,;:!)]?$/;
const PCT = /^\(?[+-]?\d+(\.\d+)?%[.,;:!)]?$/;

/** Split a markdown-ish string into styled word tokens. */
function tokenize(text: string, baseBold: boolean, baseColor: RGB): Token[] {
  const tokens: Token[] = [];
  // Split on ** toggles, then on whitespace inside each run.
  const parts = text.split("**");
  let greenNext = false;
  for (let i = 0; i < parts.length; i++) {
    const bold = baseBold || i % 2 === 1;
    for (const word of parts[i].split(/\s+/)) {
      if (!word) continue;
      let color = baseColor;
      let wBold = bold;
      if (ZERO_PCT.test(word) || RED_WORD.test(word)) {
        color = RED;
        wBold = true;
      } else if (MONEY.test(word) || PCT.test(word)) {
        wBold = true;
        if (greenNext) color = GREEN;
      } else if (greenNext && word !== "->") {
        color = GREEN;
      }
      greenNext = word === "->" || word.endsWith("->");
      tokens.push({ text: word, bold: wBold, color });
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface Block {
  height: number;
  /** Draw the block with its top edge at y, left edge at x. */
  draw: (x: number, y: number) => void;
  /** Extra breathing room requested below this block. */
  gapAfter: number;
}

interface Section {
  chip: string | null; // null => preamble card without a chip
  lines: string[];
}

export function generatePDF(title: string, markdownContent: string): Buffer {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const useCustom = registerFonts(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  const cardInnerW = contentW - CARD_PAD_X * 2;
  const pageBottom = pageH - FOOTER_H;

  const setDisplay = (size: number) => {
    doc.setFont(useCustom ? "ArchivoBlack" : "helvetica", useCustom ? "normal" : "bold");
    doc.setFontSize(size);
  };
  const setBody = (size: number, bold: boolean) => {
    doc.setFont(useCustom ? "Inter" : "helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
  };
  const widthOf = (text: string, size: number, bold: boolean): number => {
    setBody(size, bold);
    return doc.getTextWidth(text);
  };

  // --- page chrome ---------------------------------------------------------

  const drawBackground = () => {
    doc.setFillColor(...CREAM);
    doc.rect(0, 0, pageW, pageH, "F");
    doc.setDrawColor(...GRID);
    doc.setLineWidth(0.6);
    for (let gx = GRID_CELL; gx < pageW; gx += GRID_CELL) doc.line(gx, 0, gx, pageH);
    for (let gy = GRID_CELL; gy < pageH; gy += GRID_CELL) doc.line(0, gy, pageW, gy);
  };

  let y = 0;
  const newPage = () => {
    doc.addPage();
    drawBackground();
    y = MARGIN + CHIP_H; // room for a chip straddling the first card's top
  };

  drawBackground();

  // --- rich text layout ----------------------------------------------------

  /** Greedy word-wrap of styled tokens into lines of at most maxWidth. */
  /** Hard-split a token wider than maxWidth (long URLs, IG handles). */
  const splitWide = (tok: Token, size: number, maxWidth: number): Token[] => {
    if (widthOf(tok.text, size, tok.bold) <= maxWidth) return [tok];
    const out: Token[] = [];
    let chunk = "";
    for (const ch of tok.text) {
      if (chunk && widthOf(chunk + ch, size, tok.bold) > maxWidth) {
        out.push({ ...tok, text: chunk });
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    if (chunk) out.push({ ...tok, text: chunk });
    return out;
  };

  const layout = (tokens: Token[], size: number, maxWidth: number): RichLine[] => {
    const spaceW = widthOf(" ", size, false);
    const lines: RichLine[] = [];
    let cur: Token[] = [];
    let curW = 0;
    for (const tok of tokens.flatMap((t) => splitWide(t, size, maxWidth))) {
      const w = widthOf(tok.text, size, tok.bold);
      const add = cur.length === 0 ? w : curW + spaceW + w;
      if (cur.length > 0 && add > maxWidth) {
        lines.push({ tokens: cur, width: curW });
        cur = [tok];
        curW = w;
      } else {
        cur.push(tok);
        curW = add;
      }
    }
    if (cur.length > 0) lines.push({ tokens: cur, width: curW });
    return lines.length > 0 ? lines : [{ tokens: [], width: 0 }];
  };

  /** Draw laid-out lines; y is the BASELINE of the first line. */
  const drawRich = (lines: RichLine[], x: number, yBase: number, size: number, lineH: number) => {
    const spaceW = widthOf(" ", size, false);
    let ly = yBase;
    for (const line of lines) {
      let lx = x;
      for (const tok of line.tokens) {
        setBody(size, tok.bold);
        doc.setTextColor(...tok.color);
        doc.text(tok.text, lx, ly);
        lx += doc.getTextWidth(tok.text) + spaceW;
      }
      ly += lineH;
    }
    doc.setTextColor(...BODY);
  };

  // --- block builders (measure now, draw later) ----------------------------

  const richBlock = (
    text: string,
    opts: { size: number; bold?: boolean; color?: RGB; indent?: number; bullet?: string | null; gapAfter?: number },
  ): Block => {
    const size = opts.size;
    const lineH = Math.round(size * 1.45);
    const indent = opts.indent ?? 0;
    const tokens = tokenize(text, opts.bold ?? false, opts.color ?? BODY);
    const lines = layout(tokens, size, cardInnerW - indent);
    return {
      height: lines.length * lineH,
      gapAfter: opts.gapAfter ?? 4,
      draw: (x, top) => {
        const baseline = top + size; // approx ascent
        if (opts.bullet) {
          setBody(size, true);
          doc.setTextColor(...INK);
          doc.text(opts.bullet, x + (opts.bullet === "•" ? 3 : 0), baseline);
        }
        drawRich(lines, x + indent, baseline, size, lineH);
      },
    };
  };

  /** Pipe-separated stat line -> row of small bordered stat pills. */
  const statRowBlock = (segments: string[]): Block => {
    const size = 9.5;
    const pillH = 20;
    const padX = 8;
    const gap = 8;
    const rowGap = 8;
    const pills = segments.map((s) => ({ text: s, w: widthOf(s, size, true) + padX * 2 }));
    // wrap pills into rows
    const rows: { text: string; w: number }[][] = [];
    let row: { text: string; w: number }[] = [];
    let rowW = 0;
    for (const p of pills) {
      const w = Math.min(p.w, cardInnerW);
      const add = row.length === 0 ? w : rowW + gap + w;
      if (row.length > 0 && add > cardInnerW) {
        rows.push(row);
        row = [p];
        rowW = w;
      } else {
        row.push(p);
        rowW = add;
      }
    }
    if (row.length > 0) rows.push(row);
    return {
      height: rows.length * pillH + (rows.length - 1) * rowGap + 2,
      gapAfter: 8,
      draw: (x, top) => {
        let py = top;
        for (const r of rows) {
          let px = x;
          for (const p of r) {
            const w = Math.min(p.w, cardInnerW);
            doc.setFillColor(...CREAM);
            doc.setDrawColor(...INK);
            doc.setLineWidth(1.2);
            doc.roundedRect(px, py, w, pillH, 6, 6, "FD");
            setBody(size, true);
            doc.setTextColor(...INK);
            doc.text(p.text, px + padX, py + pillH / 2 + size / 2 - 1.5);
            px += w + gap;
          }
          py += pillH + rowGap;
        }
        doc.setTextColor(...BODY);
      },
    };
  };

  const dividerBlock = (): Block => ({
    height: 9,
    gapAfter: 4,
    draw: (x, top) => {
      doc.setDrawColor(...GRID);
      doc.setLineWidth(1);
      doc.line(x, top + 4, x + cardInnerW, top + 4);
    },
  });

  const spacerBlock = (h: number): Block => ({ height: h, gapAfter: 0, draw: () => {} });

  const lineToBlock = (line: string): Block | null => {
    const t = line.trim();
    if (!t) return spacerBlock(5);
    if (/^(-+|_{3,}|={3,})$/.test(t)) return dividerBlock();
    if (t.startsWith("### ")) {
      return richBlock(t.replace(/^###\s*/, ""), { size: 11.5, bold: true, color: INK, gapAfter: 5 });
    }
    if (t.startsWith("# ")) {
      return richBlock(t.replace(/^#\s*/, ""), { size: 12.5, bold: true, color: INK, gapAfter: 6 });
    }
    if (/^[-*]\s+/.test(t)) {
      return richBlock(t.replace(/^[-*]\s+/, ""), { size: 10.5, indent: 14, bullet: "•" });
    }
    const num = t.match(/^(\d+[.)])\s+(.*)$/);
    if (num) {
      return richBlock(num[2], { size: 10.5, indent: 20, bullet: num[1] });
    }
    // Pipe-separated stat line (2+ segments, shortish segments) -> pill row.
    const segs = t.split("|").map((s) => s.replace(/\*\*/g, "").trim()).filter(Boolean);
    if (segs.length >= 2 && segs.every((s) => s.length <= 42)) {
      return statRowBlock(segs);
    }
    // Small meta lines (parenthetical asides) render muted.
    if (/^\(.*\)$/.test(t)) {
      return richBlock(t, { size: 9, color: MUTED });
    }
    return richBlock(t, { size: 10.5 });
  };

  // --- split markdown into preamble + ## sections --------------------------

  const sections: Section[] = [];
  let cur: Section = { chip: null, lines: [] };
  for (const raw of markdownContent.split("\n")) {
    const t = raw.trim();
    const h2 = t.match(/^##\s+(.*)$/);
    if (h2 && !t.startsWith("###")) {
      if (cur.lines.some((l) => l.trim())) sections.push(cur);
      cur = { chip: h2[1].replace(/\*\*/g, "").trim(), lines: [] };
    } else {
      cur.lines.push(raw);
    }
  }
  if (cur.lines.some((l) => l.trim())) sections.push(cur);

  // Briefs open with a "*DAILY SALES BRIEF | date*" header line that becomes a
  // ## section duplicating the PDF title. Drop that chip, and promote its
  // short plain lines (e.g. "Prepared by Jeremy") to the centered lede.
  const lettersOf = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");
  const extraLede: string[] = [];
  if (sections.length > 0 && sections[0].chip) {
    const chipLetters = lettersOf(sections[0].chip!);
    const titleLetters = lettersOf(title);
    if (chipLetters && titleLetters && (chipLetters === titleLetters || chipLetters.startsWith(titleLetters) || titleLetters.startsWith(chipLetters))) {
      const kept = sections[0].lines.map((l) => l.trim()).filter(Boolean);
      const ledeish =
        kept.length <= 2 && kept.every((l) => l.length <= 110 && !/^[-*#]|^\d+[.)]\s|\|/.test(l));
      if (ledeish) {
        extraLede.push(...kept.map((l) => l.replace(/\*\*/g, "")));
        sections.shift();
      } else {
        sections[0] = { chip: null, lines: sections[0].lines };
      }
    }
  }

  // --- header: title + swoosh + lede ---------------------------------------

  const displayTitle = title.toUpperCase();
  // Shrink-to-fit: prefer the largest size (<=38) that keeps the title on one
  // line; otherwise the largest that keeps it to two lines.
  const linesAt = (s: number): number => {
    setDisplay(s);
    return (doc.splitTextToSize(displayTitle, contentW) as string[]).length;
  };
  let oneLineSize = 0;
  let twoLineSize = 0;
  for (let s = 38; s >= 20; s--) {
    const n = linesAt(s);
    if (n <= 1) {
      oneLineSize = s;
      break;
    }
    if (n <= 2 && twoLineSize === 0) twoLineSize = s;
  }
  const titleSize =
    oneLineSize >= 27 ? oneLineSize : twoLineSize > 0 ? Math.min(twoLineSize, 32) : oneLineSize || 20;
  setDisplay(titleSize);
  const titleLines: string[] = doc.splitTextToSize(displayTitle, contentW);
  const titleLineH = titleSize * 1.12;

  y = MARGIN + 26;
  doc.setTextColor(...INK);
  setDisplay(titleSize);
  for (const tl of titleLines) {
    doc.text(tl, pageW / 2, y + titleSize * 0.78, { align: "center" });
    y += titleLineH;
  }

  // Green hand-drawn underline swoosh under the title.
  const lastW = doc.getTextWidth(titleLines[titleLines.length - 1] ?? displayTitle);
  const swooshW = Math.max(160, Math.min(lastW * 0.8, contentW * 0.65));
  const sx = pageW / 2 - swooshW / 2;
  const sy = y + 6;
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(4);
  doc.setLineCap("round");
  // Slightly curved stroke (bezier, relative coords), plus a short second flick.
  doc.lines(
    [[swooshW * 0.3, 4.5, swooshW * 0.72, 5.5, swooshW, 0.5]],
    sx,
    sy,
    [1, 1],
    "S",
  );
  doc.lines(
    [[swooshW * 0.18, 2.5, swooshW * 0.34, 3, swooshW * 0.46, 1]],
    sx + swooshW * 0.24,
    sy + 7.5,
    [1, 1],
    "S",
  );
  y = sy + 22;

  // Lede: generated date, centered.
  const genDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  const ledeMaxW = Math.min(contentW, widthOf("x", 10.5, false) * 68);
  const allLede = [...extraLede, `Generated ${genDate} ET`];
  for (const raw of allLede) {
    setBody(10.5, false);
    doc.setTextColor(...LEDE);
    const wrapped: string[] = doc.splitTextToSize(raw, ledeMaxW);
    for (const ll of wrapped) {
      doc.text(ll, pageW / 2, y + 9, { align: "center" });
      y += 15;
    }
  }
  y += 24;

  // --- chips + cards --------------------------------------------------------

  const drawChip = (label: string, x: number, top: number): number => {
    const size = 9.5;
    const charSpace = 0.8;
    setDisplay(size);
    const text = label.toUpperCase();
    doc.setCharSpace(charSpace);
    const textW = doc.getTextWidth(text) + charSpace * Math.max(0, text.length - 1);
    const w = Math.min(textW + 22, contentW - 20);
    // offset black shadow
    doc.setFillColor(...INK);
    doc.roundedRect(x + CHIP_SHADOW, top + CHIP_SHADOW, w, CHIP_H, CHIP_RADIUS, CHIP_RADIUS, "F");
    // chip
    doc.setFillColor(...YELLOW);
    doc.setDrawColor(...INK);
    doc.setLineWidth(1.6);
    doc.roundedRect(x, top, w, CHIP_H, CHIP_RADIUS, CHIP_RADIUS, "FD");
    doc.setTextColor(...INK);
    doc.text(text, x + 11, top + CHIP_H / 2 + size / 2 - 1.2, { maxWidth: w - 18 });
    doc.setCharSpace(0);
    return w;
  };

  const drawCardBox = (top: number, height: number) => {
    doc.setFillColor(...INK);
    doc.roundedRect(MARGIN + CARD_SHADOW, top + CARD_SHADOW, contentW, height, CARD_RADIUS, CARD_RADIUS, "F");
    doc.setFillColor(...WHITE);
    doc.setDrawColor(...INK);
    doc.setLineWidth(1.5);
    doc.roundedRect(MARGIN, top, contentW, height, CARD_RADIUS, CARD_RADIUS, "FD");
  };

  for (const section of sections) {
    // build blocks, dropping leading/trailing spacers
    let blocks = section.lines.map(lineToBlock).filter((b): b is Block => b !== null);
    while (blocks.length > 0 && blocks[0].height <= 6 && blocks[0].gapAfter === 0) blocks = blocks.slice(1);
    while (blocks.length > 0) {
      const last = blocks[blocks.length - 1];
      if (last.height <= 6 && last.gapAfter === 0) blocks = blocks.slice(0, -1);
      else break;
    }
    if (blocks.length === 0 && !section.chip) continue;

    let first = true;
    let i = 0;
    // A section may span pages: each page's portion gets its own card box.
    while (i < blocks.length || (first && section.chip)) {
      const chipOverhang = section.chip ? CHIP_H / 2 : 0;
      // Never split a chip from the card's first line: need chip + first block.
      const firstNeed =
        chipOverhang + CARD_PAD_TOP + (blocks[i]?.height ?? 0) + CARD_PAD_BOTTOM + CARD_SHADOW;
      if (first && y + firstNeed > pageBottom) newPage();

      const cardTop = y + chipOverhang;
      let innerY = cardTop + CARD_PAD_TOP;
      const portion: { block: Block; top: number }[] = [];
      while (i < blocks.length) {
        const b = blocks[i];
        const fits = innerY + b.height + CARD_PAD_BOTTOM + CARD_SHADOW <= pageBottom;
        // Always place at least one block per portion so we make progress.
        if (!fits && portion.length > 0) break;
        portion.push({ block: b, top: innerY });
        innerY += b.height + b.gapAfter;
        i++;
        if (!fits) break; // oversized single block: let it run, break after
      }
      // trim trailing gap
      const lastPlaced = portion[portion.length - 1];
      const contentBottom = lastPlaced ? lastPlaced.top + lastPlaced.block.height : innerY;
      const cardH = Math.max(contentBottom + CARD_PAD_BOTTOM - cardTop, CHIP_H + 6);

      drawCardBox(cardTop, cardH);
      if (first && section.chip) drawChip(section.chip, MARGIN + 12, y);
      for (const p of portion) p.block.draw(MARGIN + CARD_PAD_X, p.top);

      first = false;
      y = cardTop + cardH + CARD_SHADOW + SECTION_GAP;
      if (i < blocks.length) newPage();
      if (!section.chip && blocks.length === 0) break;
    }
  }

  // --- footer on every page --------------------------------------------------

  const pages = doc.getNumberOfPages();
  const footDate = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    setBody(8.5, false);
    doc.setTextColor(...FOOT);
    doc.text(`CCOS Sales Manager · generated ${footDate} ET`, MARGIN, pageH - 18);
    doc.text(`Page ${p} of ${pages}`, pageW - MARGIN, pageH - 18, { align: "right" });
  }

  return Buffer.from(doc.output("arraybuffer"));
}
