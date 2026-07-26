// The daily carousel contract, in one place. Everything that needs to agree on "how many carousels
// is a full day" imports from here: the generator, the generate route's no-regeneration guard, both
// crons' gap checks, the external API validator, the swipe view and the Slack delivery line.
// Changing the cadence is changing this number.

export const CAROUSELS_PER_DAY = 3;

// Slides per carousel, and how long a slide may run. The sentence cap matches the writing
// framework's own model slide — the validator measures the house style rather than fighting it.
export const MIN_SLIDES_PER_CAROUSEL = 5;
export const MAX_SLIDES_PER_CAROUSEL = 10;
export const MAX_SENTENCES_PER_SLIDE = 5;

// A sentence longer than this reads as a run-on once it wraps on the canvas; flagged for one retry.
export const MAX_WORDS_PER_SENTENCE = 20;

// The day's set is a fixed split, not a free choice: carousel 1 attracts the ICP (top of funnel),
// the rest dismantle objections (bottom of funnel). Intent is derived from the SLOT rather than from
// what the model labelled its own output, so the tag always describes what actually shipped.
export type CarouselIntent = "icp" | "objection";
export const ICP_CAROUSELS_PER_DAY = 1;
export const intentForSlot = (slot: number): CarouselIntent => (slot < ICP_CAROUSELS_PER_DAY ? "icp" : "objection");
export const INTENT_LABEL: Record<CarouselIntent, string> = { icp: "attract", objection: "objection" };
