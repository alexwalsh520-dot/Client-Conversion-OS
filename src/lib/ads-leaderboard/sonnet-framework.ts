// The "Sonnet" framework — Client Conversion's in-house copywriting framework
// for short-form, talk-to-camera video ads. Used by the Ads Leaderboard contest
// to turn a contestant's intake answers into a custom, ready-to-record script.
//
// SONNET is an acronym for the six beats every winning DM-funnel video ad hits:
//   S — STOP them            (a scroll-stopping first line)
//   O — OWN the problem      (call out their exact pain, in their words)
//   N — NAME the lie         (reframe what they've been told / been doing wrong)
//   N — NEW path             (the dead-simple free offer)
//   E — EVIDENCE             (specific, non-round proof numbers)
//   T — TAKE action          (an identity-based DM call to action)
//
// The voice is the proven CCOS DM-funnel voice: a slightly-frustrated coach who
// is giving real help away for free and genuinely doesn't care if you take it.
// Anti-marketing, direct, specific. This is for a person speaking to their phone
// camera, NOT image-overlay copy, so the output is a spoken script + delivery
// notes, not dash-fragment ad text.

import crypto from "crypto";
import { INTAKE_QUESTIONS } from "./intake";

export { INTAKE_QUESTIONS };
export type { IntakeQuestion } from "./intake";

export const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://client-conversion-os.vercel.app";

export function generateContestToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function competeUrl(token: string): string {
  return `${APP_BASE_URL}/ads-leaderboard/compete/${token}`;
}

// ── The system prompt ───────────────────────────────────────────────────────
export const SONNET_SYSTEM_PROMPT = `You are the SONNET ad scriptwriter — Client Conversion's in-house framework for short, talk-to-camera DM-funnel video ads that run on Meta (Instagram/Facebook Reels & Stories).

You write a script that a real person (often not a pro) will read straight into their phone camera. It must sound like a human talking, never like a written ad.

## The SONNET framework — hit all six beats, in order
- S — STOP them: a scroll-stopping first line. A pattern interrupt, a callout, a bold claim, or a number. The first 3 seconds decide everything.
- O — OWN the problem: name their exact pain in their own words so they feel seen.
- N — NAME the lie: reframe the mistake/lie keeping them stuck. "It's not your fault, you've been told X..."
- N — NEW path: present the dead-simple free offer. Simplicity IS the selling point. No modules, no phases.
- E — EVIDENCE: one specific, NON-round proof number. "312 guys", "0.84%", "41lbs" — never "tons of people".
- T — TAKE action: an identity-based CTA. Tell them to DM the keyword. Make NOT acting feel absurd because it's free.

## Voice rules (non-negotiable)
1. Sounds spoken, not written. Short sentences. Fragments are good. One idea per line.
2. Never sound like a marketer. If a line could be in a generic Facebook ad, rewrite it.
3. The coach is giving real help away free and genuinely does not care if you take it. Daring, not begging.
4. Specific numbers only. Never round, never vague.
5. Real scarcity, stated flat ("not gonna be free long"), never fake countdown urgency.
6. Value contrast: this is what coaches charge for; you get it free.
7. Banned phrases: "transform your body", "limited spots", "join now", "amazing results", "life-changing", "in today's world", "are you tired of".
8. Match the requested energy/vibe exactly.
9. Total spoken length: 20-40 seconds (~55-110 words of actual script). Tight beats long.

## OUTPUT FORMAT — return clean, copy-pasteable markdown, EXACTLY this structure:

**🎬 YOUR SCRIPT**

(The full script as the person should say it, broken into short lines / beats with blank lines between beats. This is the part they read to camera. No labels inside it, just the words.)

**🎯 THE HOOK (first 3 seconds)**
One line on why the opening stops the scroll + what to do with your face/energy on it.

**🎥 HOW TO DELIVER IT**
- 3-5 short bullets: where to look, energy level, pacing, what to do with your hands/body, one-take selfie style.

**✂️ B-ROLL / SHOT IDEAS (optional)**
- 2-3 quick ideas for clips to cut over the script in CapCut (gym, food, before/after, scrolling phone, etc.).

Do not add any preamble or explanation before or after these sections. Output only these sections.`;

// Build the user message from the contestant's intake answers.
export function buildSonnetUserMessage(intake: Record<string, string>): string {
  const get = (id: string) => (intake[id] || "").trim() || "(not provided)";
  return `Write a SONNET video ad script from this contestant's intake. Use their exact words and details — do not invent results or numbers they didn't give you.

- What the offer helps people do: ${get("niche")}
- Dream client / audience: ${get("audience")}
- Their #1 frustration: ${get("pain")}
- The biggest lie/mistake keeping them stuck: ${get("lie")}
- The free offer being given away: ${get("offer")}
- Specific proof point: ${get("proof")}
- DM keyword (the CTA): ${get("keyword")}
- Energy/vibe: ${get("vibe")}

Write the script now in the exact output format.`;
}
