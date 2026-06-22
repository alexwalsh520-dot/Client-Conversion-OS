// One-off parser: reads the Tyson 100-ad-pool copy doc and emits the 70 ads
// (B1-B30 lead_magnet, C1-C40 direct_cta) as JSON rows for factory_items.
// Run: node scripts/parse-factory-tyson.mjs > /tmp/factory-tyson.json
import fs from "node:fs";

const SRC =
  "/Users/alexwalsh/Documents/All/Agency/Tyson/03_AD_COPY_AND_DOCS/100_ad_pool_copy_2026-06-22.md";

const raw = fs.readFileSync(SRC, "utf8");
const lines = raw.split("\n");

// Map a section-header line to a short style slug.
function styleFromHeader(h) {
  const t = h.toUpperCase();
  if (t.includes("SCREENSHOT-PROOF")) return "screenshot-proof";
  if (t.includes("5%") || t.includes("99")) return "percent-math";
  if (t.includes("NETFLIX")) return "netflix";
  if (t.includes("STAT") || t.includes("CHART")) return "stat-chart";
  if (t.includes("IG-NATIVE") || t.includes("STORY FONT")) return "ig-native-story";
  if (t.includes("AI SHRED ROADMAP")) return "ai-shred-roadmap";
  if (t.includes("BULLET WORKHORSE")) return "bullet-workhorse";
  if (t.includes("FIRST-PERSON STORY")) return "first-person-story";
  if (t.includes("PATTERN-INTERRUPT QUESTION")) return "pattern-interrupt-question";
  if (t.includes("MIRROR") || t.includes("INWARD IDENTITY")) return "man-in-the-mirror";
  return "general";
}

const items = [];
let currentStyle = "general";
let bucket = null;
let sort = 0;

// An ad block starts with a line like "B1 (img 464F4AB6)" or "C6".
const adStart = /^([BC])(\d+)\s*(?:\((.*)\))?\s*$/;

let i = 0;
while (i < lines.length) {
  const line = lines[i];

  if (/^BUCKET B —/.test(line)) bucket = "lead_magnet";
  else if (/^BUCKET C —/.test(line)) bucket = "direct_cta";

  // Section header lines start with "------ " and contain a style name.
  if (/^------/.test(line)) {
    currentStyle = styleFromHeader(line);
    i++;
    continue;
  }

  const m = line.match(adStart);
  if (m && bucket) {
    const label = `${m[1]}${m[2]}`;
    const paren = (m[3] || "").trim();
    // image_direction: explicit "(img ...)" note, else the section's source note.
    let imageDirection = null;
    if (paren) imageDirection = paren;

    // Collect the copy until the next "-----" separator, next ad start, next
    // section header, or next bucket banner.
    const body = [];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (/^-----\s*$/.test(l)) { i++; break; }
      if (l.match(adStart)) break;
      if (/^------/.test(l)) break;
      if (/^={5,}/.test(l)) break;
      if (/^BUCKET [BC] —/.test(l)) break;
      body.push(l);
      i++;
    }
    const copyText = body.join("\n").trim();
    // If no inline (img ...) note, default to the doc's standard direction.
    if (!imageDirection) imageDirection = "generate from Tyson Raw Pics";

    items.push({
      label,
      bucket,
      style: currentStyle,
      copy_text: copyText,
      image_direction: imageDirection,
      sort_order: sort++,
    });
    continue;
  }
  i++;
}

process.stdout.write(JSON.stringify(items, null, 2));
process.stderr.write(`\nParsed ${items.length} ads\n`);
