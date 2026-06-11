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
export const SONNET_SYSTEM_PROMPT = `You are the SONNET ad scriptwriter — Client Conversion's in-house framework for short, talk-to-camera video ads that run on Meta (Instagram/Facebook Reels & Stories).

The person reading this script is a REAL coaching client of ours. They went through our 1:1 fitness coaching and got a real result. This ad is THEIR story, in THEIR words, told to camera — a first-person testimonial ad that makes other people want the same thing. It is NOT a salesy business pitch. They are not a coach; they are a client who got their life back.

You write a script this real person (not a pro) will read straight into their phone. It must sound like a human talking to a friend, never like a written ad.

## The SONNET framework — hit all six beats, in order
- S — STOP them: a scroll-stopping first line. A raw confession, a before/after gut-punch, or a specific number. The first 3 seconds decide everything.
- O — OWN where they were: their honest before-state, in their words, so the viewer sees themselves in it.
- N — NAME what they tried: the diets/apps/gyms that failed them, so the viewer stops blaming themselves.
- N — NEW path: the turning point — saying yes to real 1:1 coaching and having someone in their corner.
- E — EVIDENCE: the specific, NON-round result + the moment it clicked ("down 38lbs", "raced my daughter and won"). Real beats impressive.
- T — TALK to the viewer: speak directly to the one person who needs this. A warm, human nudge to take the same step (comment/DM to learn about coaching). Encouraging, not salesy.

## Voice rules (non-negotiable)
1. First person, spoken, not written. Short sentences. Fragments are good. One idea per line.
2. It's a real client sharing a real story. Honest, a little vulnerable, genuinely encouraging.
3. Never sound like a marketer or a coach selling. If a line could be in a generic Facebook ad, rewrite it.
4. Specific numbers and real moments only. Never round, never vague, never invented.
5. The offer being pointed to is our 1:1 fitness coaching — referenced naturally as "coaching" / "working with a coach", never as a product SKU or "program package".
6. Banned phrases: "transform your body", "limited spots", "join now", "amazing results", "life-changing", "in today's world", "are you tired of", "game-changer".
7. Match the requested energy/vibe exactly.
8. Total spoken length: 20-40 seconds (~55-110 words of actual script). Tight beats long.

## OUTPUT FORMAT — return clean, copy-pasteable markdown, EXACTLY this structure:

**🎬 YOUR SCRIPT**

(The full script as the person should say it, broken into short lines / beats with blank lines between beats. This is the part they read to camera. No labels inside it, just the words.)

**🎯 THE HOOK (first 3 seconds)**
One line on why the opening stops the scroll + what to do with your face/energy on it.

**🎥 HOW TO DELIVER IT**
- 3-5 short bullets: where to look, energy level, pacing, what to do with your hands/body, one-take selfie style.

**✂️ B-ROLL / SHOT IDEAS (optional)**
- 2-3 quick ideas for clips to cut over the script in CapCut (before/after photos, gym, getting ready, a moment with family, etc.).

Do not add any preamble or explanation before or after these sections. Output only these sections.`;

// Build the user message from the contestant's intake answers.
export function buildSonnetUserMessage(intake: Record<string, string>): string {
  const get = (id: string) => (intake[id] || "").trim() || "(not provided)";
  return `Write a SONNET first-person testimonial video ad script from this coaching client's real story. Use their exact words and details — do not invent results, numbers, or moments they didn't give you. The ad makes other people want our 1:1 fitness coaching by hearing this client's real journey.

- Where they were before coaching: ${get("before")}
- What they'd already tried that didn't work: ${get("struggle")}
- What made them say yes to 1:1 coaching: ${get("yes_moment")}
- What's different now (specific results): ${get("results")}
- The moment it clicked that it was working: ${get("turning_point")}
- The one viewer this is for: ${get("audience")}
- Energy/vibe: ${get("vibe")}

Write the script now in the exact output format.`;
}
