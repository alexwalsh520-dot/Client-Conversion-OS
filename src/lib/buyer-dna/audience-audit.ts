// AUDIENCE AUDIT — the lock is checked, not trusted.
//
// A creator's icpLock says who every word is for. Putting that in the system prompt makes it likely;
// it does not make it true. This is the check: one cheap LLM call that reads the lock and the
// content's own hooks/topics and rules each item on-audience or off-audience.
//
// It never rewrites anything. It returns a verdict; the caller retries once, and on a second failure
// refuses to store the set and alerts. This exists because a route with an incomplete lookup table
// wrote one creator's ICP into another's row and a full day of off-audience content shipped silently.

import Anthropic from "@anthropic-ai/sdk";
import { logAiUsage } from "@/lib/ai-usage";
import { icpLockFor } from "@/lib/creators";
import { extractJson } from "./json";

const MODEL = "claude-sonnet-4-6";

export type AuditItem = { label: string; text: string };
export type AuditVerdict = {
  ok: boolean;
  /** null when the creator has no lock, or the audit could not run — the caller must not treat that as a pass. */
  ran: boolean;
  offAudience: { label: string; why: string }[];
  lock: string | null;
};

/**
 * Judge a set of items against the creator's audience lock. `items` should be the things that carry
 * the audience signal — carousel slide-1 hooks and topics, or a playbook's hooks and actions.
 */
export async function auditAudience(
  client: string,
  items: AuditItem[],
  anthropic: Anthropic,
): Promise<AuditVerdict> {
  const lock = icpLockFor(client);
  if (!lock || !items.length) return { ok: true, ran: false, offAudience: [], lock };

  // This audit exists to catch content written for SOMEONE ELSE, not content that is merely broad.
  // The first version flagged a creator's own on-brief hooks for "having no military angle" — which
  // would have blocked his set every night. Off-audience requires a different audience, named.
  const sys =
    `You are auditing marketing content for AUDIENCE FIT. The content is supposed to be for exactly this audience:\n\n${lock}\n\n` +
    "For each item, decide whether it is written for a DIFFERENT audience than the one above. Judge who it is aimed at, not its quality and not how specific it is.\n" +
    "Mark on_audience TRUE when: it speaks to that person's situation, OR it is broad enough that this person is plainly included. Content that would land on a wider group INCLUDING them is on-audience. Not every piece has to name the niche — the absence of a niche detail is NOT a failure.\n" +
    "Mark on_audience FALSE only when you can NAME the different audience it is actually written for — a different life stage, a different goal, a different problem that this audience does not have. If you cannot name that other audience in your reason, the answer is TRUE.\n" +
    "Being generic is never enough to fail. Being aimed elsewhere is.\n" +
    'Return STRICT JSON and nothing else: {"items":[{"label":"the item label","on_audience":true,"why":"one short sentence; if false, name the audience it is actually for"}]}';

  const user = items.map((i) => `[${i.label}]\n${i.text}`).join("\n\n---\n\n");

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: sys,
      messages: [{ role: "user", content: user }],
    });
    logAiUsage({ feature: "icp-audit", model: MODEL, usage: resp.usage });
    const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
    const parsed = extractJson<{ items?: { label?: string; on_audience?: boolean; why?: string }[] }>(tb?.text || "");
    const rows = Array.isArray(parsed?.items) ? parsed!.items! : [];
    // A verdict we could not parse is NOT a pass — it is an audit that did not run.
    if (!rows.length) return { ok: true, ran: false, offAudience: [], lock };
    const off = rows
      .filter((r) => r && r.on_audience === false)
      .map((r) => ({ label: r.label || "(unlabelled)", why: r.why || "" }));
    return { ok: off.length === 0, ran: true, offAudience: off, lock };
  } catch {
    return { ok: true, ran: false, offAudience: [], lock };
  }
}

/** The retry instruction naming what failed, for the one full regeneration the caller allows. */
export function auditFeedback(verdict: AuditVerdict): string {
  const named = verdict.offAudience.map((o) => `${o.label} (${o.why})`).join("; ");
  return (
    `AUDIENCE FAILURE. These are written for the wrong audience: ${named}. ` +
    `Every item must be for: ${verdict.lock}. ` +
    "Rewrite the whole set for that audience. Do not keep a single idea that belongs to a different person."
  );
}
