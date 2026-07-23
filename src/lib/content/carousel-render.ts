// Shared carousel slide model + rendering. Used by the thumbnails, the editor, and the PNG export so
// they all match. Everything is client-side canvas — no image APIs, no storage, only the free Google
// fonts the /studio editor already loads. Canvas is 1080×1350 (4:5), solid black.

export const CANVAS_W = 1080;
export const CANVAS_H = 1350;

export type CreatorSlug = "tyson" | "antwan" | "jake";

// Identity + accent ring per the visual spec. Avatars live in /public/carousel-avatars/<slug>.jpg.
// A creator without an avatar file renders their initials in the ring instead.
export const CAROUSEL_IDENTITY: Record<string, { name: string; handle: string; ring: string; avatar: string }> = {
  tyson: { name: "Tyson Sonnek", handle: "@tysonnek", ring: "#7a8450", avatar: "/carousel-avatars/tyson.jpg" },
  antwan: { name: "Antwan Rarcus", handle: "@antwanrarcus", ring: "#d03325", avatar: "/carousel-avatars/antwan.jpg" },
  jake: { name: "Jake Divljak", handle: "@recruitreadyfitness", ring: "#2f6f4f", avatar: "/carousel-avatars/jake.jpg" },
};

// Slide body defaults for the default layout.
export const SLIDE_BODY_FONT_SIZE = 56;
export const SLIDE_BODY_MAXW = CANVAS_W - 280;

// Same free Google fonts /studio loads (do not add paid fonts / new vendors).
export const CAROUSEL_FONTS = [
  { label: "SF Pro Display", value: "Inter, SF Pro Display, system-ui" },
  { label: "Source Serif Pro", value: "'Source Serif Pro', Georgia, serif" },
  { label: "Montserrat", value: "'Montserrat', Arial, sans-serif" },
  { label: "Playfair Display", value: "'Playfair Display', Georgia, serif" },
  { label: "Oswald", value: "'Oswald', Arial Narrow, sans-serif" },
  { label: "Bebas Neue", value: "'Bebas Neue', Impact, sans-serif" },
];
export const CAROUSEL_GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Source+Serif+Pro:wght@400;600;700;900&family=Montserrat:wght@400;600;700;800;900&family=Playfair+Display:wght@400;600;700;800;900&family=Oswald:wght@400;500;600;700&family=Bebas+Neue&display=swap";

const BODY_FONT = "Inter, SF Pro Display, system-ui";

export type SlideBlock = {
  id: string;
  kind: "header" | "text";
  x: number;
  y: number;
  locked?: boolean;
  // header
  avatarSize?: number;
  nameSize?: number;
  handleSize?: number;
  // text
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  maxWidth?: number;
  autoY?: boolean; // default body block is vertically centered below the header until moved
};

let _id = 0;
const nid = () => `b${Date.now().toString(36)}${(_id++).toString(36)}`;

// Default layout for a slide from its raw text (visual spec): header top-left, large white body,
// centered vertically below the header.
export function defaultBlocks(text: string): SlideBlock[] {
  return [
    // Header sits ~170px down (was ~90) so the avatar + name isn't crowding the top edge; the body
    // block below auto-centers in the space that remains beneath it.
    { id: nid(), kind: "header", x: 90, y: 170, avatarSize: 110, nameSize: 46, handleSize: 36, locked: true },
    { id: nid(), kind: "text", x: 140, y: 420, autoY: true, text: text || "", fontSize: SLIDE_BODY_FONT_SIZE, fontFamily: BODY_FONT, fontWeight: 400, color: "#ffffff", align: "left", lineHeight: 1.45, maxWidth: SLIDE_BODY_MAXW },
  ];
}


export function newTextBlock(): SlideBlock {
  return { id: nid(), kind: "text", x: 140, y: 500, text: "New text", fontSize: 48, fontFamily: BODY_FONT, fontWeight: 400, color: "#ffffff", align: "left", lineHeight: 1.4, maxWidth: CANVAS_W - 280 };
}

// Read a slide's blocks, falling back to the default layout built from its text.
export function blocksForSlide(slide: { text?: string; blocks?: unknown[] } | undefined): SlideBlock[] {
  if (slide && Array.isArray(slide.blocks) && slide.blocks.length) return slide.blocks as SlideBlock[];
  return defaultBlocks(slide?.text || "");
}

// Split a paragraph string on **bold** markers into styled runs (asterisks stripped).
export function parseBold(s: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), bold: false });
  return out.length ? out : [{ text: s, bold: false }];
}

type Run = { text: string; bold: boolean };
// Word-wrap a text block into display lines, each a list of bold/normal runs. Empty source lines
// become paragraph gaps (empty run arrays).
function wrapBlock(ctx: CanvasRenderingContext2D, block: SlideBlock): Run[][] {
  const fs = block.fontSize || 48;
  const fam = block.fontFamily || BODY_FONT;
  const baseW = block.fontWeight || 400;
  const maxW = block.maxWidth || CANVAS_W - 280;
  const setFont = (bold: boolean) => (ctx.font = `${bold ? Math.max(700, baseW) : baseW} ${fs}px ${fam}`);
  const lines: Run[][] = [];
  for (const src of (block.text || "").split("\n")) {
    if (!src.trim()) { lines.push([]); continue; }
    const words: Run[] = [];
    for (const seg of parseBold(src)) {
      for (const w of seg.text.split(/(\s+)/)) if (w.length) words.push({ text: w, bold: seg.bold });
    }
    let cur: Run[] = [];
    let curW = 0;
    for (const word of words) {
      setFont(word.bold);
      const ww = ctx.measureText(word.text).width;
      if (curW + ww > maxW && cur.length && word.text.trim()) { lines.push(cur); cur = []; curW = 0; }
      cur.push(word); curW += ww;
    }
    if (cur.length) lines.push(cur);
  }
  return lines;
}

function blockHeight(ctx: CanvasRenderingContext2D, block: SlideBlock): number {
  const fs = block.fontSize || 48;
  const lh = fs * (block.lineHeight || 1.45);
  const lines = wrapBlock(ctx, block);
  return lines.reduce((h, ln) => h + (ln.length ? lh : lh * 0.55), 0);
}

function drawInitials(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, name: string, ring: string) {
  ctx.save();
  ctx.fillStyle = "#1c1c1c";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  ctx.fillStyle = "#e8e8e8";
  ctx.font = `700 ${Math.round(r * 0.8)}px ${BODY_FONT}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(initials, cx, cy + 2);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.restore();
  void ring;
}

// Draw one header block (avatar + name + verified badge + handle).
function drawHeader(ctx: CanvasRenderingContext2D, block: SlideBlock, creator: string, avatar: HTMLImageElement | null) {
  const id = CAROUSEL_IDENTITY[creator];
  const size = block.avatarSize || 110;
  const r = size / 2;
  const cx = block.x + r;
  const cy = block.y + r;
  const ring = id?.ring || "#7a8450";

  if (avatar && avatar.complete && avatar.naturalWidth) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.drawImage(avatar, block.x, block.y, size, size);
    ctx.restore();
  } else {
    drawInitials(ctx, cx, cy, r, id?.name || creator, ring);
  }
  // Thin accent ring
  ctx.save();
  ctx.strokeStyle = ring; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  const textX = block.x + size + 26;
  const nameSize = block.nameSize || 46;
  const handleSize = block.handleSize || 36;
  ctx.textBaseline = "alphabetic";
  // Name (bold white)
  ctx.font = `700 ${nameSize}px ${BODY_FONT}`;
  ctx.fillStyle = "#ffffff";
  const nameY = block.y + nameSize + 6;
  ctx.fillText(id?.name || creator, textX, nameY);
  // Verified badge (blue circle + white check)
  const nameW = ctx.measureText(id?.name || creator).width;
  const bx = textX + nameW + 16;
  const by = nameY - nameSize * 0.36;
  const br = nameSize * 0.34;
  ctx.fillStyle = "#3897f0";
  ctx.beginPath(); ctx.arc(bx + br, by, br, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(2, br * 0.22); ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(bx + br * 0.55, by + br * 0.05);
  ctx.lineTo(bx + br * 0.9, by + br * 0.42);
  ctx.lineTo(bx + br * 1.45, by - br * 0.45);
  ctx.stroke();
  // Handle (gray)
  ctx.font = `400 ${handleSize}px ${BODY_FONT}`;
  ctx.fillStyle = "#a8a8a8";
  ctx.fillText(id?.handle || "", textX, block.y + size - 6);
}

export type Box = { x: number; y: number; w: number; h: number };

// Render a full slide to a provided canvas (must be 1080×1350). Returns each block's bounding box (in
// canvas px) so the editor can draw selection/drag handles from the same render pass. Avatar preloaded.
export function renderSlide(canvas: HTMLCanvasElement, blocks: SlideBlock[], creator: string, avatar: HTMLImageElement | null): Record<string, Box> {
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const boxes: Record<string, Box> = {};

  const header = blocks.find((b) => b.kind === "header");
  const headerBottom = header ? header.y + (header.avatarSize || 110) : 90;

  for (const block of blocks) {
    if (block.kind === "header") {
      drawHeader(ctx, block, creator, avatar);
      const size = block.avatarSize || 110;
      const id = CAROUSEL_IDENTITY[creator];
      ctx.font = `700 ${block.nameSize || 46}px ${BODY_FONT}`;
      const nameW = ctx.measureText(id?.name || creator).width;
      boxes[block.id] = { x: block.x, y: block.y, w: size + 26 + nameW + 60, h: size };
      continue;
    }

    // Text block
    const fs = block.fontSize || 48;
    const fam = block.fontFamily || BODY_FONT;
    const baseW = block.fontWeight || 400;
    const lh = fs * (block.lineHeight || 1.45);
    const maxW = block.maxWidth || CANVAS_W - 280;
    const lines = wrapBlock(ctx, block);

    let startY: number;
    if (block.autoY) {
      const regionTop = headerBottom + 60;
      const regionBottom = CANVAS_H - 80;
      const h = blockHeight(ctx, block);
      startY = Math.max(regionTop, regionTop + (regionBottom - regionTop - h) / 2);
    } else {
      startY = block.y;
    }

    ctx.textBaseline = "alphabetic";
    let curY = startY;
    for (const line of lines) {
      if (!line.length) { curY += lh * 0.55; continue; }
      const lineWidth = line.reduce((w, run) => { ctx.font = `${run.bold ? Math.max(700, baseW) : baseW} ${fs}px ${fam}`; return w + ctx.measureText(run.text).width; }, 0);
      let lx = block.x;
      if (block.align === "center") lx = block.x + (maxW - lineWidth) / 2;
      else if (block.align === "right") lx = block.x + maxW - lineWidth;
      const textY = curY + lh * 0.75;
      for (const run of line) {
        ctx.font = `${run.bold ? Math.max(700, baseW) : baseW} ${fs}px ${fam}`;
        ctx.fillStyle = block.color || "#ffffff";
        ctx.fillText(run.text, lx, textY);
        lx += ctx.measureText(run.text).width;
      }
      curY += lh;
    }
    boxes[block.id] = { x: block.x, y: startY, w: maxW, h: Math.max(fs, curY - startY) };
  }
  return boxes;
}

// Preload an avatar image (crossOrigin so it draws to canvas cleanly). Resolves null on failure.
export function loadAvatar(creator: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const src = CAROUSEL_IDENTITY[creator]?.avatar;
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Ensure the Google fonts are loaded before an export draw so canvas text matches the editor.
export async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined") return;
  if (!document.getElementById("carousel-fonts")) {
    const link = document.createElement("link");
    link.id = "carousel-fonts"; link.rel = "stylesheet"; link.href = CAROUSEL_GOOGLE_FONTS_URL;
    document.head.appendChild(link);
  }
  try {
    const fams = ["Montserrat", "Source Serif Pro", "Playfair Display", "Oswald", "Bebas Neue", "Inter"];
    await Promise.all(fams.flatMap((f) => [document.fonts.load(`400 56px ${f}`), document.fonts.load(`700 56px ${f}`)]));
    await document.fonts.ready;
  } catch { /* fonts best-effort */ }
}

// Render + download one slide as a 1080×1350 PNG.
export async function downloadSlide(blocks: SlideBlock[], creator: string, filename: string) {
  await ensureFonts();
  const avatar = await loadAvatar(creator);
  const canvas = document.createElement("canvas");
  renderSlide(canvas, blocks, creator, avatar);
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png", 1.0);
  link.click();
}
