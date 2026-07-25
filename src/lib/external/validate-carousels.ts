import { CAROUSELS_PER_DAY, MIN_SLIDES_PER_CAROUSEL, MAX_SLIDES_PER_CAROUSEL, MAX_SENTENCES_PER_SLIDE } from "@/lib/content/carousel-config";

// Validation for externally-submitted carousels. Mirrors the internal contract: the daily count,
// 5-10 slides each, at most 4 sentences per slide, and never a concrete dollar figure. Returns a list
// of human-readable problems (empty = valid) so the API can 422 with a precise reason.

export type IncomingSlide = { text?: string };
export type IncomingCarousel = { topic?: string; objection?: string; source?: string; slides?: IncomingSlide[] };

const MAX_SENTENCES = MAX_SENTENCES_PER_SLIDE;
const MIN_SLIDES = MIN_SLIDES_PER_CAROUSEL;
const MAX_SLIDES = MAX_SLIDES_PER_CAROUSEL;
const DOLLAR_DIGIT = /\$\s?\d/;

// Same sentence count the internal generator validates against: terminators that actually end a
// sentence, with ellipses and decimals neutralised so they don't inflate the count.
export function sentenceCount(text: string): number {
  const t = (text || "").replace(/\.\.\.+/g, ".").replace(/\b\d+\.\d+\b/g, "0");
  const matches = t.match(/[.!?]+(?=\s|$)/g);
  return t.trim() ? Math.max(1, matches ? matches.length : 0) : 0;
}

export function validateCarousels(carousels: unknown): string[] {
  const problems: string[] = [];
  if (!Array.isArray(carousels)) return ["`carousels` must be an array"];
  if (carousels.length !== CAROUSELS_PER_DAY) problems.push(`expected exactly ${CAROUSELS_PER_DAY} carousels, got ${carousels.length}`);

  carousels.forEach((c, ci) => {
    const car = c as IncomingCarousel;
    const slides = Array.isArray(car?.slides) ? car.slides : null;
    if (!slides) { problems.push(`carousel ${ci + 1}: missing slides array`); return; }
    if (slides.length < MIN_SLIDES || slides.length > MAX_SLIDES) {
      problems.push(`carousel ${ci + 1}: ${slides.length} slides (must be ${MIN_SLIDES}-${MAX_SLIDES})`);
    }
    slides.forEach((s, si) => {
      const text = typeof s?.text === "string" ? s.text : "";
      if (!text.trim()) { problems.push(`carousel ${ci + 1} slide ${si + 1}: empty text`); return; }
      if (sentenceCount(text) > MAX_SENTENCES) {
        problems.push(`carousel ${ci + 1} slide ${si + 1}: more than ${MAX_SENTENCES} sentences`);
      }
      if (DOLLAR_DIGIT.test(text)) {
        problems.push(`carousel ${ci + 1} slide ${si + 1}: contains a dollar figure`);
      }
    });
  });
  return problems;
}
