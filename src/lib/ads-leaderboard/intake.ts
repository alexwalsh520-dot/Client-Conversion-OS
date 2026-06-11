// Client-safe intake question definitions for the Ads Leaderboard contest flow.
// Kept free of any Node-only imports (no crypto/fs) so it can be bundled into
// the public contestant client component. The SONNET script generator
// (server-only) re-exports these from sonnet-framework.ts.

export interface IntakeQuestion {
  id: string;
  label: string;
  help?: string;
  placeholder?: string;
  type: "text" | "textarea" | "select";
  options?: string[];
  required?: boolean;
}

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  {
    id: "niche",
    label: "What does your offer help people do?",
    help: "One line. The transformation, plainly.",
    placeholder: "e.g. Help busy dads lose 20lbs without giving up beer",
    type: "text",
    required: true,
  },
  {
    id: "audience",
    label: "Who is this for? Describe your dream client.",
    help: "Age, gender, what their life looks like right now.",
    placeholder: "e.g. Men 30-45 who used to be athletic and are now 30lbs heavier",
    type: "textarea",
    required: true,
  },
  {
    id: "pain",
    label: "What is the #1 thing they're frustrated about?",
    help: "The exact words they'd use. Be specific, not generic.",
    placeholder: "e.g. They've started 5 diets this year and quit every one by week 2",
    type: "textarea",
    required: true,
  },
  {
    id: "lie",
    label: "What's the biggest lie or mistake keeping them stuck?",
    help: "What does everyone tell them that's actually wrong?",
    placeholder: "e.g. That they need to do 2 hours of cardio a day",
    type: "textarea",
    required: true,
  },
  {
    id: "offer",
    label: "What's the free thing you're giving away?",
    help: "Your challenge / plan / group. Keep it dead simple.",
    placeholder: "e.g. Free 6-week shred challenge: workout plan + simple diet + group",
    type: "textarea",
    required: true,
  },
  {
    id: "proof",
    label: "What's one specific proof point?",
    help: "A real number or result. Specific beats impressive.",
    placeholder: "e.g. 312 guys joined the last round / I lost 41lbs myself",
    type: "text",
  },
  {
    id: "keyword",
    label: "What word should people DM you to join?",
    help: "One short, punchy word. This is your CTA.",
    placeholder: "e.g. SHRED",
    type: "text",
    required: true,
  },
  {
    id: "vibe",
    label: "Pick your energy",
    type: "select",
    options: ["Tough-love / call them out", "Hype / high energy", "Calm + confident", "Funny / self-aware"],
    required: true,
  },
];
