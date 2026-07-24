/**
 * Daily Coach Tip generator.
 *
 * Produces ONE educational paragraph per day for the whole coaching team.
 * The topic is picked deterministically from the current UTC date so every
 * coach reads the same tip on the same day. Claude writes fresh copy each
 * run, so repeat topics won't feel repeated.
 *
 * MAS rule (memory: feedback_no_em_dashes): tips must NEVER contain
 * em-dashes or en-dashes. Enforced twice: explicit rule in the prompt,
 * plus a post-processing strip as a safety net.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logAiUsage } from "@/lib/ai-usage";

const MODEL = "claude-haiku-4-5";

const TOPICS: string[] = [
  "protein targets and how to hit them without obsessing",
  "meal prep systems that survive a busy week",
  "grocery shopping for adherence, not perfection",
  "handling restaurants and eating out",
  "alcohol without derailing progress",
  "travel nutrition tactics",
  "coaching sleep as a fat-loss lever",
  "hydration and how it affects hunger and training",
  "step counts and NEAT as the quiet driver of fat loss",
  "fiber, gut health, and adherence",
  "creatine: what it does, dosing, and who should skip it",
  "caffeine strategy for training and daily energy",
  "pre and post workout nutrition without the noise",
  "refeed days and diet breaks explained simply",
  "explaining scale fluctuation to clients",
  "when to trust the mirror over the scale",
  "progress photos: how to take them and how to read them",
  "handling plateaus without panic changes",
  "rate of loss guidance for different starting points",
  "reverse dieting: when it helps and when it stalls",
  "squat cueing for common form breakdowns",
  "deadlift setup and bracing that transfers to any variation",
  "bench press form checkpoints",
  "row variations for real back development",
  "progressive overload beyond just adding weight",
  "programming deloads without losing momentum",
  "warm ups that actually improve the working sets",
  "glute programming that works",
  "hamstring development for aesthetics and injury prevention",
  "handling client resistance without lecturing",
  "structuring accountability check-ins that get real answers",
  "habit stacking to make new behaviors stick",
  "environment design so willpower is not the plan",
  "coaching emotional eating with compassion and structure",
  "binge cycles: what to say and what to do next",
];

/**
 * Deterministic day-based rotation. Uses UTC day index so the cron (which
 * runs at 8:30 UTC) always picks the same topic for a given calendar day
 * across all coaches.
 */
export function pickTopicForDate(date: Date = new Date()): string {
  const dayIndex = Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
  return TOPICS[dayIndex % TOPICS.length];
}

/** Strip em-dashes (U+2014) and en-dashes (U+2013). Safety net for the no-em-dash rule. */
export function stripDashes(text: string): string {
  return text.replace(/[—–]/g, ", ");
}

const SYSTEM_PROMPT = `You write short daily messages that an online fitness coach sends DIRECTLY to a client, word for word, with no editing. Each message teaches ONE concept and tells the client exactly what to do with it.

Rules:
- Write TO the client, in warm, plain second person ("you"). This is a text message from their coach, not an article and not advice for the coach.
- Exactly ONE paragraph. About 70 to 110 words.
- No greeting that assumes a name (never "Hey [name]"), no placeholders, no square brackets. It must read naturally when sent as-is to any client.
- Explain the concept in everyday language, then give ONE concrete, doable action they can take today or this week.
- No jargon, no headings, no bullet points, no motivational filler, no rhetorical questions.
- Never use em-dashes or en-dashes. Use commas, colons, or periods instead.
- Do not start with the topic name or a title. Start with the substance.
- Do not sign off. No coach name, no "hope this helps", no emojis.`;

export async function generateDailyTip(
  now: Date = new Date(),
): Promise<{ topic: string; body: string }> {
  const topic = pickTopicForDate(now);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const anthropic = new Anthropic({ apiKey });
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Write today's client message. Topic: ${topic}.`,
      },
    ],
  });

  logAiUsage({ feature: "daily-coach-tip", model: MODEL, usage: msg.usage });

  const raw = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { topic, body: stripDashes(raw) };
}

/** Convert the topic slug to a human headline: "squat cueing for common form breakdowns" → "Squat Cueing for Common Form Breakdowns". */
function headlineFromTopic(topic: string): string {
  return topic
    .split(" ")
    .map((w, i) => {
      if (i === 0 || w.length > 3) return w.charAt(0).toUpperCase() + w.slice(1);
      return w;
    })
    .join(" ");
}

/**
 * Build the Slack blocks for the daily client message. A coach-facing header
 * names the topic and states the message is ready to send, then the message
 * itself sits in a code block so Slack shows a one-click copy affordance.
 */
export function tipToSlackBlocks(topic: string, body: string): unknown[] {
  const headline = headlineFromTopic(topic);
  // Triple backticks in the body would close the code block early. Guard it.
  const safeBody = body.replace(/```/g, "ʼʼʼ");
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:speech_balloon: *Today's client message: ${headline}*\nReady to send as-is. Copy below:`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "```\n" + safeBody + "\n```",
      },
    },
  ];
}
