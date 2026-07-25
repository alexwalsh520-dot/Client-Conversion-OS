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
