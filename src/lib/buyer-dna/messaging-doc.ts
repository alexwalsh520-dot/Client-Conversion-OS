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
