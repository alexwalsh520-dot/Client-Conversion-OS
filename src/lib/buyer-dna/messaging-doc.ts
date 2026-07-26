// The creator's own Master Messaging / ICP document. When a creator gives us one, it is the single
// richest source of who the buyer is, their pains, and the exact language to mirror — so the
// generators treat it as ground truth even before there are any buyers or ingested posts.
//
// The document TEXT lives ONLY in Supabase (content_messaging_docs). Nothing doc-derived is ever
// committed to this repo. This module only reads it back.

import type { SupabaseClient } from "@supabase/supabase-js";

export type MessagingDoc = { version: number; title: string | null; doc_text: string };

// Newest messaging doc for a creator, or null if they have none (the common case — only creators
// onboarded from a doc have one, so every existing creator's generators are unaffected).
export async function getMessagingDoc(sb: SupabaseClient, client: string): Promise<MessagingDoc | null> {
  try {
    const { data } = await sb
      .from("content_messaging_docs")
      .select("version, title, doc_text")
      .eq("client_key", client)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as MessagingDoc | null;
    return row && row.doc_text ? row : null;
  } catch {
    // Table not created yet (pre-migration) — degrade to "no doc", never throw.
    return null;
  }
}

// The house writing framework — one document that applies to EVERY creator, stored under this
// reserved client_key in the same table. It is the authoritative style/structure reference for the
// carousel + playbook generators; per-creator docs sit alongside it, not above it. Newest version
// wins, so updating the framework is just inserting a new row.
// The framework CHANNEL. Any document whose client_key starts with this prefix is house guidance
// that applies to EVERY creator — the general resource pack, the hook-writing guide, and whatever
// comes next. Adding a new one is inserting a row; no code change. Newest version of each wins.
//
// Order is stable and meaningful: the general pack first (it governs overall voice and structure),
// then the more specific guides (which win on the narrow thing they cover). Alphabetical after the
// base pack gives us that for free — "__global__" sorts before "__global_hooks__".
export const GLOBAL_DOC_PREFIX = "__global";
export const GLOBAL_DOC_KEY = "__global__";
export const GLOBAL_HOOKS_KEY = "__global_hooks__";

export async function listGlobalFrameworkDocs(sb: SupabaseClient): Promise<MessagingDoc[]> {
  try {
    const { data } = await sb
      .from("content_messaging_docs")
      .select("client_key, version, title, doc_text")
      .like("client_key", `${GLOBAL_DOC_PREFIX}%`)
      .order("client_key", { ascending: true })
      .order("version", { ascending: false });
    const newest = new Map<string, MessagingDoc & { client_key: string }>();
    for (const r of (data || []) as (MessagingDoc & { client_key: string })[]) {
      if (!newest.has(r.client_key) && r.doc_text) newest.set(r.client_key, r); // version-desc => first wins
    }
    return [...newest.values()];
  } catch {
    // Table missing (pre-migration) — generators fall back to running without the framework.
    return [];
  }
}

// Back-compat single-doc accessor for callers that only want the base pack.
export function getGlobalFrameworkDoc(sb: SupabaseClient): Promise<MessagingDoc | null> {
  return getMessagingDoc(sb, GLOBAL_DOC_KEY);
}

// Pull one named section out of a framework doc ("PART 8: ..." up to the next "PART n:").
function docSection(text: string, part: number): string {
  const start = text.search(new RegExp(`^PART\\s*${part}\\s*:`, "im"));
  if (start < 0) return "";
  const rest = text.slice(start);
  const end = rest.slice(1).search(/^PART\s*\d+\s*:/im);
  return (end > 0 ? rest.slice(0, end + 1) : rest).trim();
}

// The hook guide's HARD rules, hoisted into the system prompt. The guide is the more specific
// authority for anything hook-shaped, and its rules only bind if they sit where rules land — the
// same lesson the em-dash ban taught. Read from the stored doc; nothing quoted into this repo.
export function frameworkHookRules(doc: MessagingDoc | null, maxChars = 5000): string {
  if (!doc) return "";
  // Parts 8 (rules), 9 (structures to rotate) and 11 (anti-AI checklist) are the binding ones;
  // the rest of the guide still ships in full in the reference block below.
  const picked = [8, 9, 11].map((n) => docSection(doc.doc_text, n)).filter(Boolean).join("\n\n");
  return picked.slice(0, maxChars);
}

// The framework's voice rules, lifted out of the stored document and hoisted into the SYSTEM prompt.
// Position is the whole point: the same rules sitting deep inside a 20k-char reference block do not
// survive contact with generation, but at the top of the system prompt they do. Returns "" when the
// section can't be found, so nothing is invented — the full framework still ships in the user block.
export function frameworkVoiceSection(doc: MessagingDoc | null, maxChars = 3500): string {
  if (!doc) return "";
  const t = doc.doc_text;
  const start = t.search(/^PART\s*1\s*:/im);
  if (start < 0) return "";
  const rest = t.slice(start);
  const end = rest.search(/^PART\s*2\s*:/im);
  return (end > 0 ? rest.slice(0, end) : rest).trim().slice(0, maxChars);
}

// The framework's own absolute prohibitions, read back OUT of the stored document at runtime.
// Nothing from the framework — including its vocabulary — is written into this repo, and an updated
// framework changes what gets enforced without a code change.
//
// Two things are derived: `lines` (the framework's own wording, restated near the top of the system
// prompt where a prohibition actually survives generation) and `terms` (lowercased phrases the
// generator checks for after parsing, to drive a targeted retry).
export function frameworkProhibitions(doc: MessagingDoc | null): { lines: string[]; terms: string[] } {
  if (!doc) return { lines: [], terms: [] };
  const lines: string[] = [];
  const terms: string[] = [];
  for (const raw of doc.doc_text.split("\n")) {
    const line = raw.replace(/^[•\-\s]+/, "").trim();
    if (!/^NO\b/i.test(line)) continue;
    lines.push(line);
    // Quoted phrases: NO "Here's the thing" / "Let's be real" ...
    for (const m of line.matchAll(/"([^"]{2,60})"/g)) terms.push(m[1].toLowerCase());
    // Bare comma lists after a colon: NO these words: a, b, c
    const after = line.split(":").slice(1).join(":");
    if (after && !after.includes('"')) {
      for (const part of after.split(",")) {
        const w = part.trim().replace(/[.•].*$/, "").trim();
        if (w && w.length <= 24 && /^[a-zA-Z][a-zA-Z' -]*$/.test(w)) terms.push(w.toLowerCase());
      }
    }
  }
  return { lines: [...new Set(lines)], terms: [...new Set(terms)] };
}

// The framework block. Sits ABOVE per-creator grounding and explicitly outranks the generator's own
// hardcoded stylistic rules, so a framework update changes the writing without a code change.
// Returns "" when no framework doc exists — generators then run exactly as they did before.
export function frameworkBlock(doc: MessagingDoc | null, maxChars = 24000): string {
  if (!doc) return "";
  return (
    "THE AUTHORITATIVE WRITING FRAMEWORK — this is the house standard for how this content is " +
    "written, and it OUTRANKS every other stylistic instruction you are given. Where it conflicts " +
    "with anything else in this prompt, follow the framework. Only the mechanical output contract " +
    "(the JSON shape, the sentence cap, no dollar figures) is non-negotiable. Note that any " +
    "bracketed [INSERT ...] placeholders inside it are illustrative — the real material follows " +
    "below this block:\n" +
    doc.doc_text.slice(0, maxChars)
  );
}

// The full framework reference block for the whole channel: every __global* doc, in stable order,
// each labelled. Precedence is stated explicitly so a more specific guide wins on its own subject
// without the model having to guess.
export function frameworkChannelBlock(docs: MessagingDoc[], maxCharsPerDoc = 24000): string {
  if (!docs.length) return "";
  const parts = docs.map((d) =>
    `--- ${(d.title || "FRAMEWORK DOCUMENT").toUpperCase()} (v${d.version}) ---\n${d.doc_text.slice(0, maxCharsPerDoc)}`,
  );
  return (
    "THE AUTHORITATIVE WRITING FRAMEWORK — the house standard for how this content is written. It " +
    "OUTRANKS every other stylistic instruction here; only the mechanical output contract (JSON " +
    "shape, counts, sentence cap, no dollar figures) is non-negotiable.\n" +
    "PRECEDENCE where these documents disagree: a document dedicated to a narrower subject wins on " +
    "that subject (the hook guide governs anything hook-shaped, including every first slide), the " +
    "general pack governs overall voice and structure everywhere else, and the MARKET directive in " +
    "this system prompt governs terminology and spelling regardless of either. Bracketed " +
    "[INSERT ...] placeholders inside are illustrative; the real material follows below.\n\n" +
    parts.join("\n\n")
  );
}

// The grounding block injected at the TOP of a generator's prompt, framed as ground truth. Trimmed
// to a generous cap so it never dominates the token budget. Returns "" when there is no doc, so a
// creator without one (e.g. Tyson) gets a byte-for-byte-unchanged prompt.
export function messagingDocBlock(doc: MessagingDoc | null, maxChars = 15000): string {
  if (!doc) return "";
  const body = doc.doc_text.slice(0, maxChars);
  return (
    "THE CREATOR'S MASTER MESSAGING DOCUMENT — treat this as ground truth for who the buyer is, the " +
    "pains, the language, and the messaging pillars. Mirror its exact phrases and one-liners. When " +
    "other evidence (buyers, calls, DMs) is absent, THIS is the source; never invent quotes that " +
    "aren't grounded here:\n" +
    body
  );
}
