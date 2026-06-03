import type { VariationKind, VariationsMix } from "./settings";
import { expandMix } from "./settings";

// Builds the per-image prompts for a variations job. Each prompt instructs the
// image model to keep the WINNING ad's subject and layout and change ONLY the
// one dimension the variation is about. The reference image (the winning ad) is
// passed separately to the provider; these prompts describe the edit.

export type VariationPrompt = {
  kind: VariationKind;
  prompt: string;
};

// A rotating pool of backgrounds so a 6-background job gets 6 distinct looks.
const BACKGROUNDS = [
  "a clean modern gym interior with soft natural light",
  "a bright minimalist studio with a seamless neutral backdrop",
  "an outdoor sunrise setting with warm golden light",
  "a dark moody high-contrast studio with a single key light",
  "a home-workout living-room scene, lifestyle and relatable",
  "a vibrant solid-color background that makes the subject pop",
  "an upscale wellness spa setting, calm and premium",
  "a city rooftop at dusk with soft bokeh lights behind the subject",
];

export type BuildPromptsInput = {
  mix: VariationsMix;
  // The literal text printed on the winning ad (from ad_creative_copy /
  // onImageText). May be empty if the ad has no readable overlay text.
  onImageText: string;
  // The owner's creative SOP (plain English). Appended as a binding directive to
  // every prompt so the factory follows their house style without a code change.
  sop?: string;
};

export function buildPrompts(input: BuildPromptsInput): VariationPrompt[] {
  const kinds = expandMix(input.mix);
  const text = (input.onImageText || "").trim();
  const words = extractKeyWords(text);
  const sop = (input.sop || "").trim();
  const withSop = (prompt: string) =>
    sop ? `${prompt} House creative rules (follow these): ${sop}` : prompt;

  let bgIndex = 0;
  let wordIndex = 0;
  let copyIndex = 0;

  return kinds.map((kind) => {
    if (kind === "background") {
      const bg = BACKGROUNDS[bgIndex % BACKGROUNDS.length];
      bgIndex++;
      return { kind, prompt: withSop(backgroundPrompt(bg, text)) };
    }
    if (kind === "highlightWord") {
      const word = words.length ? words[wordIndex % words.length] : "";
      wordIndex++;
      return { kind, prompt: withSop(highlightWordPrompt(word, text)) };
    }
    // copyTweak
    const angle = COPY_ANGLES[copyIndex % COPY_ANGLES.length];
    copyIndex++;
    return { kind, prompt: withSop(copyTweakPrompt(angle, text)) };
  });
}

const KEEP_TEXT_RULE =
  "Keep the subject, composition, framing, and all overlaid text exactly the same as the reference image unless this instruction says otherwise. Match the original style, lighting mood, and typography. Output a single high-quality advertising image at the same aspect ratio.";

function backgroundPrompt(background: string, text: string): string {
  return [
    `Recreate this winning ad image but change ONLY the background to ${background}.`,
    "Keep the same subject/person, same pose, same overlaid text, same logo placement, and the same overall layout.",
    text ? `The overlaid text must still read exactly: "${text}".` : "",
    KEEP_TEXT_RULE,
  ]
    .filter(Boolean)
    .join(" ");
}

function highlightWordPrompt(word: string, text: string): string {
  const target = word
    ? `Visually emphasize the word "${word}" in the headline (make it larger, bolder, or a contrasting accent color) while keeping every other word the same.`
    : "Emphasize a different key word in the headline than the original emphasis — make one important word larger or a contrasting accent color — keeping all words the same.";
  return [
    "Recreate this winning ad image, keeping the same subject, background, and layout.",
    target,
    text ? `The full overlaid text must still read: "${text}".` : "",
    KEEP_TEXT_RULE,
  ]
    .filter(Boolean)
    .join(" ");
}

const COPY_ANGLES = [
  "rephrase the hook to lead with the result/benefit the customer gets",
  "rephrase the hook as a curiosity-driven question",
  "rephrase the hook to add urgency or a time element",
  "rephrase the hook to be punchier and shorter",
];

function copyTweakPrompt(angle: string, text: string): string {
  return [
    "Recreate this winning ad image, keeping the same subject, background, layout, and typography style.",
    text
      ? `The original overlaid hook is: "${text}". Slightly reword the hook — ${angle} — keeping it the same length and tone. Render the new wording in the same font and position as the original.`
      : `Add a short punchy advertising hook in the empty headline area — ${angle}. Use a font and placement that fits the existing design.`,
    KEEP_TEXT_RULE,
  ]
    .filter(Boolean)
    .join(" ");
}

// Pull candidate "key words" to emphasize from the on-image text. Skips short
// stop-words and punctuation. Returns up to 8 distinct words, longest first
// (longer words are more likely to be the meaningful ones).
const STOP_WORDS = new Set([
  "the", "and", "for", "you", "your", "with", "this", "that", "from", "are",
  "our", "get", "now", "out", "can", "all", "how", "but", "not", "was", "has",
  "a", "an", "to", "in", "of", "on", "is", "it", "or", "be", "we", "i",
]);

function extractKeyWords(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const words = text
    .split(/[^A-Za-z0-9'-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase()));
  for (const w of words) seen.add(w);
  return Array.from(seen).sort((a, b) => b.length - a.length).slice(0, 8);
}
