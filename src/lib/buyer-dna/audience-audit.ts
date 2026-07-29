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

  const sys =
    `You are auditing marketing content for AUDIENCE FIT. The content is supposed to be for exactly this audience:\n\n${lock}\n\n` +
    "For each item, decide whether it is written FOR that audience. Judge the audience it speaks to, not its quality.\n" +
    "ON-AUDIENCE: it names, describes, or speaks to that person's situation, even obliquely.\n" +
    "OFF-AUDIENCE: it speaks to a different person — a different career stage, a different goal, a different life. When a piece would land equally on anyone, that is not off-audience by itself; only call it off when it is aimed somewhere else.\n" +
    'Return STRICT JSON and nothing else: {"items":[{"label":"the item label","on_audience":true,"why":"one short sentence"}]}';

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
