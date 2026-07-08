// The Ideal Customer Profile.
//  - Tyson: LEARNED backward from the dossiers of everyone who paid the threshold or more, then
//    locked as the current standard. Regenerates as new qualifying buyers close.
//  - Antwan: FIXED / chosen up front (seeded from the doc we wrote), never derived from data.
// A new generation bumps the version and becomes the locked one; the old version stays for history.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";

const MODEL = "claude-sonnet-4-6";

export type Icp = {
  one_line?: string;
  who_they_are?: string;
  top_pains?: string[];
  limiting_beliefs?: string[];
  desires?: string[];
  objections?: string[];
  triggers?: string[];
  language?: string[];
  disqualifiers?: string[];
};

const SYS =
  "You are building the Ideal Customer Profile for a fitness coach, learned only from REAL people who paid a premium price. You get short research briefs on each buyer. Find the patterns that REPEAT across them, ranked by how often they show up. This becomes the standard the coach's content is graded against, so be precise and grounded, never generic. Return STRICT JSON:\n" +
  '{"one_line":"who the ideal buyer is, one sentence","who_they_are":"2-4 sentences on life stage, identity, situation","top_pains":["pains that show up again and again"],"limiting_beliefs":["recurring beliefs holding them back"],"desires":["what they actually want"],"objections":["what they hesitate on before buying"],"triggers":["what was going on when they reached out"],"language":["distinctive words or phrases they use, to mirror in content"],"disqualifiers":["signs someone is NOT this buyer"]}\n' +
  "4 to 8 items per list, ordered by how common they are across the buyers. Ground everything in the briefs. No invented traits. No prose outside the JSON.";

function parseIcp(text: string): Icp | null {
  const raw = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b < 0) return null;
  try {
    return JSON.parse(raw.slice(a, b + 1)) as Icp;
  } catch {
    return null;
  }
}

// Build the readable version in code so it is always plain and dash-free.
export function icpToMarkdown(icp: Icp, meta: { mode: string; buyerCount: number; thresholdCents: number | null }): string {
  const list = (label: string, arr?: string[]) =>
    arr && arr.length ? `## ${label}\n${arr.map((x) => `- ${x}`).join("\n")}\n` : "";
  const head =
    meta.mode === "derived"
      ? `Learned from ${meta.buyerCount} buyers who paid $${Math.round((meta.thresholdCents || 0) / 100)} or more.`
      : "Chosen up front. Fixed standard.";
  return [
    `# Ideal Buyer`,
    head,
    icp.one_line ? `\n**${icp.one_line}**\n` : "",
    icp.who_they_are ? `${icp.who_they_are}\n` : "",
    list("Top pains", icp.top_pains),
    list("Limiting beliefs", icp.limiting_beliefs),
    list("What they want", icp.desires),
    list("What they hesitate on", icp.objections),
    list("What was going on when they reached out", icp.triggers),
    list("Words they use", icp.language),
    list("Not this buyer if", icp.disqualifiers),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function getCurrentIcp(sb: SupabaseClient, client: string) {
  const { data } = await sb
    .from("creator_icp")
    .select("*")
    .eq("client_key", client)
    .eq("locked", true)
    .order("version", { ascending: false })
    .limit(1);
  return data && data[0] ? data[0] : null;
}

async function nextVersion(sb: SupabaseClient, client: string): Promise<number> {
  const { data } = await sb
    .from("creator_icp")
    .select("version")
    .eq("client_key", client)
    .order("version", { ascending: false })
    .limit(1);
  return data && data[0] ? Number((data[0] as { version: number }).version) + 1 : 1;
}

async function lockNew(sb: SupabaseClient, client: string, row: Record<string, unknown>) {
  // unlock previous, then insert the new locked version
  await sb.from("creator_icp").update({ locked: false }).eq("client_key", client).eq("locked", true);
  const { data, error } = await sb.from("creator_icp").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

// Tyson path: synthesize the ICP from qualifying dossiers.
export async function generateDerivedIcp(
  sb: SupabaseClient,
  client: string,
  thresholdCents: number,
  anthropic: Anthropic,
) {
  const { data: dossiers } = await sb
    .from("buyer_dossiers")
    .select("display_name, amount_cents, research")
    .eq("client_key", client)
    .eq("qualifies_icp", true)
    .order("amount_cents", { ascending: false })
    .limit(300);

  const briefs = (dossiers || [])
    .map((d) => {
      const r = ((d as { research: unknown }).research || {}) as Record<string, string[] | string>;
      const has = r.summary || (Array.isArray(r.pains) && r.pains.length);
      if (!has) return null;
      const line = (label: string, v: unknown) =>
        Array.isArray(v) && v.length ? `${label}: ${v.slice(0, 4).join("; ")}` : "";
      return [
        `- ${(d as { display_name: string }).display_name} ($${Math.round(((d as { amount_cents: number }).amount_cents || 0) / 100)})`,
        r.summary ? `  ${r.summary}` : "",
        r.what_brought_them_in ? `  came in: ${r.what_brought_them_in}` : "",
        `  ${line("pains", r.pains)}`,
        `  ${line("beliefs", r.limiting_beliefs)}`,
        `  ${line("objections", r.objections)}`,
        `  ${line("words", r.their_words)}`,
      ]
        .filter((x) => x && x.trim())
        .join("\n");
    })
    .filter(Boolean) as string[];

  if (briefs.length < 3) {
    return { ok: false as const, reason: `Only ${briefs.length} usable buyer briefs. Build more dossiers first.` };
  }

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYS,
    messages: [{ role: "user", content: `Buyers who paid $${Math.round(thresholdCents / 100)}+:\n\n${briefs.join("\n\n").slice(0, 120000)}` }],
  });
  logAiUsage({ feature: "buyer-dna-icp", model: MODEL, usage: resp.usage });
  const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
  const icp = parseIcp(tb?.text || "");
  if (!icp) return { ok: false as const, reason: "Could not parse ICP from the model." };

  const version = await nextVersion(sb, client);
  const markdown = icpToMarkdown(icp, { mode: "derived", buyerCount: briefs.length, thresholdCents });
  const row = await lockNew(sb, client, {
    client_key: client,
    version,
    mode: "derived",
    threshold_cents: thresholdCents,
    buyer_count: briefs.length,
    icp,
    icp_markdown: markdown,
    locked: true,
    model: MODEL,
    generated_at: new Date().toISOString(),
  });
  return { ok: true as const, version, buyerCount: briefs.length, icp: row };
}

// Antwan path: store the chosen ICP as-is (fixed), no data derivation.
export async function seedFixedIcp(sb: SupabaseClient, client: string, icp: Icp) {
  const version = await nextVersion(sb, client);
  const markdown = icpToMarkdown(icp, { mode: "fixed", buyerCount: 0, thresholdCents: null });
  const row = await lockNew(sb, client, {
    client_key: client,
    version,
    mode: "fixed",
    threshold_cents: null,
    buyer_count: 0,
    icp,
    icp_markdown: markdown,
    locked: true,
    model: null,
    generated_at: new Date().toISOString(),
  });
  return { ok: true as const, version, icp: row };
}
