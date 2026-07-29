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

// QUARANTINE. When the audience audit fails twice the set is stored but held back: visible to the
// operator, invisible to everything else. It rides in the existing `meta` jsonb rather than a new
// column, so no migration is needed and old rows (meta null) are simply not quarantined.
//
// Everything that asks "does this day have its content?" must ask about LIVE rows only, or a
// quarantined day looks finished and never regenerates.
export type CarouselMeta = { intent?: string; quarantined?: boolean; audit_reason?: string } | null;
export const isQuarantined = (row: { meta?: CarouselMeta }): boolean => row?.meta?.quarantined === true;
export const isLive = (row: { meta?: CarouselMeta }): boolean => !isQuarantined(row);
