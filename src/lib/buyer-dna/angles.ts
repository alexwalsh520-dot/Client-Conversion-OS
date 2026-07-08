// Turn the real buyer dossiers + the locked ICP into content and ad angles the team can actually
// make. Grounded in people who paid, not guesses. Replaces the creator's angle set on each run.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";
import { getCurrentIcp } from "./icp";
import type { Icp } from "./icp";

const MODEL = "claude-sonnet-4-6";

const SYS =
  "You turn a fitness creator's REAL buyer research into ORGANIC content ideas the creator can film. Ground every idea in the buyers' own pains, beliefs, triggers, and words. The idea should make the ideal buyer feel seen, not be a generic fitness tip. Return STRICT JSON:\n" +
  '{"angles":[{"title":"the idea in a few words","hook":"a spoken opening line in the buyer\'s world (no hard call-out, let them recognize themselves)","pain":"the specific pain or belief it speaks to","grounded_in":"which buyer insight this came from"}]}\n' +
  "12 to 16 ideas. Concrete and specific to THIS buyer, never generic. No prose outside the JSON.";

type Angle = { title?: string; hook?: string; pain?: string; grounded_in?: string };

function parse(text: string): Angle[] {
  const raw = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b < 0) return [];
  try {
    const p = JSON.parse(raw.slice(a, b + 1)) as { angles?: Angle[] };
    return Array.isArray(p.angles) ? p.angles : [];
  } catch {
    return [];
  }
}

export async function generateAngles(sb: SupabaseClient, client: string, anthropic: Anthropic) {
  const current = await getCurrentIcp(sb, client);
  if (!current) return { ok: false as const, reason: "No locked ICP yet. Generate the ICP first." };
  const icp = (current as { icp: Icp }).icp;

  const { data: dossiers } = await sb
    .from("buyer_dossiers")
    .select("display_name, research")
    .eq("client_key", client)
    .eq("qualifies_icp", true)
    .limit(300);

  const briefs = (dossiers || [])
    .map((d) => {
      const r = ((d as { research: Record<string, unknown> }).research) || {};
      if (!r || !Object.keys(r).length) return "";
      const line = (v: unknown) => (Array.isArray(v) ? v.slice(0, 3).join("; ") : "");
      return [
        r.what_brought_them_in ? `trigger: ${r.what_brought_them_in}` : "",
        line((r as Record<string, unknown>).pains) ? `pains: ${line((r as Record<string, unknown>).pains)}` : "",
        line((r as Record<string, unknown>).limiting_beliefs) ? `beliefs: ${line((r as Record<string, unknown>).limiting_beliefs)}` : "",
        line((r as Record<string, unknown>).their_words) ? `words: ${line((r as Record<string, unknown>).their_words)}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .filter(Boolean);

  const icpDigest = [
    icp.one_line || "",
    `Pains: ${(icp.top_pains || []).slice(0, 8).join("; ")}`,
    `Beliefs: ${(icp.limiting_beliefs || []).slice(0, 6).join("; ")}`,
    `Triggers: ${(icp.triggers || []).slice(0, 6).join("; ")}`,
    `Words: ${(icp.language || []).slice(0, 10).join("; ")}`,
  ].join("\n");

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: SYS,
    messages: [{ role: "user", content: `IDEAL BUYER:\n${icpDigest}\n\nREAL BUYER NOTES:\n${briefs.slice(0, 60).join("\n").slice(0, 40000)}` }],
  });
  logAiUsage({ feature: "buyer-dna-angles", model: MODEL, usage: resp.usage });
  const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
  const angles = parse(tb?.text || "");
  if (!angles.length) return { ok: false as const, reason: "Could not parse angles from the model." };

  const batchId = `${client}-${(current as { version: number }).version}-${new Date().toISOString().slice(0, 10)}`;
  await sb.from("buyer_content_angles").delete().eq("client_key", client);
  await sb.from("buyer_content_angles").insert(
    angles.slice(0, 16).map((a, i) => ({
      client_key: client,
      batch_id: batchId,
      angle_type: "organic",
      title: String(a.title || "").slice(0, 200),
      hook: a.hook ? String(a.hook).slice(0, 400) : null,
      rationale: a.pain ? String(a.pain).slice(0, 400) : null,
      grounded_in: a.grounded_in ? [String(a.grounded_in).slice(0, 300)] : [],
      sort_order: i,
    })),
  );
  return { ok: true as const, count: Math.min(angles.length, 16) };
}
