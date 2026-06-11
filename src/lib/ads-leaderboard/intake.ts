// Client-safe intake question definitions for the Ads Leaderboard contest flow.
// Kept free of any Node-only imports (no crypto/fs) so it can be bundled into
// the public contestant client component. The SONNET script generator
// (server-only) re-exports these from sonnet-framework.ts.
//
// Framing: the contestant is one of OUR coaching clients making an ad about
// THEIR OWN experience with our 1:1 fitness coaching — a real story, in their
// words. Every question is about their journey, not about running a business.

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
    id: "before",
    label: "Where were you at before you started coaching with us?",
    help: "The real picture — how you looked, felt, and what your day was like.",
    placeholder: "e.g. 40lbs heavier, exhausted by 2pm, hiding in photos",
    type: "textarea",
    required: true,
  },
  {
    id: "struggle",
    label: "What had you already tried that didn't work?",
    help: "Diets, apps, gyms, programs — whatever you'd spun your wheels on.",
    placeholder: "e.g. Keto, F45, three different apps... nothing stuck",
    type: "textarea",
    required: true,
  },
  {
    id: "yes_moment",
    label: "What finally made you say yes to 1:1 coaching with us?",
    help: "The thing that tipped you over the edge to actually commit.",
    placeholder: "e.g. I saw a client's results and realized I needed real accountability",
    type: "textarea",
    required: true,
  },
  {
    id: "results",
    label: "What's different now? Be specific.",
    help: "Real numbers and real changes — pounds, energy, confidence, habits.",
    placeholder: "e.g. Down 38lbs, off my blood pressure meds, up at 6am every day",
    type: "textarea",
    required: true,
  },
  {
    id: "turning_point",
    label: "What was the moment it clicked that this was actually working?",
    help: "One specific memory or moment that proved it to you.",
    placeholder: "e.g. My daughter asked to race me to the car... and I won",
    type: "textarea",
    required: true,
  },
  {
    id: "audience",
    label: "Who is the one person watching this who needs to hear it?",
    help: "Describe the version of you from before — who is this for?",
    placeholder: "e.g. A busy dad who keeps saying 'I'll start Monday'",
    type: "textarea",
    required: true,
  },
  {
    id: "vibe",
    label: "Pick your energy",
    help: "How do you want to come across on camera?",
    type: "select",
    options: ["Real & raw", "Hyped & high energy", "Calm & confident", "Funny & self-aware"],
    required: true,
  },
];
