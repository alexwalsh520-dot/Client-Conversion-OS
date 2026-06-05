#!/usr/bin/env node
/**
 * sync-skills — regenerate public/skills-data.json FROM the real SKILL.md files.
 *
 * This is the single source of truth bridge: the in-app Skills page (Deep Dive →
 * Skills) shows whatever this writes, and this reads the ACTUAL skill files on
 * disk. So the page can never drift from the skills — it is generated from them,
 * not hand-copied. Run it whenever a skill changes:  node scripts/sync-skills.mjs
 *
 * Only pure presentation (emoji, accent colour, one-line tagline) is curated
 * here; the substance (name + full body) is read live from each SKILL.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, "..", "public", "skills-data.json");

// Presentation-only metadata. The body + name come from the file itself.
const SKILLS = [
  { id: "cmo", emoji: "🎯", accent: "#c9a96e", tagline: "Think like the person whose neck is on the line",
    displayPath: "~/.claude/skills/cmo/SKILL.md", file: join(HOME, ".claude/skills/cmo/SKILL.md"), selfImproving: true },
  { id: "ad-decisions", emoji: "⚖️", accent: "#5b8def", tagline: "Weekly: exactly what to kill and what to scale",
    displayPath: "~/.claude/skills/ad-decisions/SKILL.md", file: join(HOME, ".claude/skills/ad-decisions/SKILL.md"), selfImproving: false },
  { id: "ccos-ad-launcher", emoji: "🚀", accent: "#3fb27f", tagline: "Chat-first Meta ad launching, safely",
    displayPath: "~/.codex/skills/ccos-ad-launcher/SKILL.md", file: join(HOME, ".codex/skills/ccos-ad-launcher/SKILL.md"), selfImproving: false },
];

function parse(raw) {
  // Split YAML-ish frontmatter from the markdown body.
  let name = null, description = null, body = raw;
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (m) {
    body = m[2];
    const fm = m[1];
    const nameM = fm.match(/^name:\s*(.+)$/m);
    if (nameM) name = nameM[1].trim();
    // description can be a one-liner or a folded ">" block
    const dm = fm.match(/^description:\s*>?\s*\n?([\s\S]*?)(?:\n[a-zA-Z_]+:|$)/m);
    if (dm) description = dm[1].replace(/\n\s+/g, " ").trim();
  }
  return { name, description, body: body.trim() };
}

function titleCase(id) { return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }

const out = { updated: new Date().toISOString().slice(0, 10),
  generatedBy: "scripts/sync-skills.mjs — reads the real SKILL.md files; do not hand-edit",
  skills: [] };

for (const s of SKILLS) {
  let raw;
  try { raw = readFileSync(s.file, "utf8"); }
  catch { console.warn(`[sync-skills] missing: ${s.file} — keeping placeholder`); raw = ""; }
  const { description, body } = parse(raw);
  out.skills.push({
    id: s.id,
    name: prettyName(s.id),
    emoji: s.emoji, accent: s.accent, tagline: s.tagline,
    selfImproving: s.selfImproving, path: s.displayPath,
    description: description || "",
    markdown: body || "_Skill file not found on disk._",
  });
}

// Friendlier display names than the raw frontmatter slug.
function prettyName(id) {
  return ({ "cmo": "CMO", "ad-decisions": "Kill / Scale Decision", "ccos-ad-launcher": "CCOS Ad Launcher" })[id] || titleCase(id);
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`[sync-skills] wrote ${OUT} from ${out.skills.length} skill files (updated ${out.updated}).`);
