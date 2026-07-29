// Deterministic dash normalization — the ONE place copy is rewritten in place, and only ever
// punctuation. The framework bans em dashes absolutely; the prompt ban plus a naming retry has been
// losing for weeks, so the prompt stays as the belt and this is the suspenders.
//
// Rules, in order:
//   "word — Word"  → a clause break     → "word. Word"   (period, next word already capital)
//   "word — word"  → a clause break     → "word. Word"   (period + capitalize)
//   "word—word"    → a range/tight join → "word, word"   (comma is grammatically safe)
//   trailing/leading dash → dropped with its surrounding space collapsed
//
// No word is added, removed, or reordered. The caller logs the count.

const DASHES = /[—–]/; // em dash, en dash

/**
 * Replace every em/en dash in one string. Returns the cleaned text and how many were replaced.
 */
export function normalizeDashes(input: string): { text: string; count: number } {
  if (!input || !DASHES.test(input)) return { text: input || "", count: 0 };
  let count = 0;

  let out = input;

  // A numeric range is not a clause break and a comma would change what it means ("the 5, 10 rep
  // range"). An ASCII hyphen is the ordinary way to write it, and it is still punctuation-only.
  out = out.replace(/(\d)\s*[—–]\s*(\d)/g, (_m, a: string, b: string) => {
    count++;
    return `${a}-${b}`;
  });

  // Spaced dash between two words → sentence break. The half after the dash gets a capital.
  out = out.replace(/([^\s—–])\s+[—–]\s+(\S)/g, (_m, before: string, after: string) => {
    count++;
    return `${before}. ${after.toUpperCase()}`;
  });

  // Tight dash joining two words → comma, per the ruling: safe wherever it stood for an aside.
  out = out.replace(/([^\s])[—–]([^\s])/g, (_m, before: string, after: string) => {
    count++;
    return `${before}, ${after}`;
  });

  // Anything left is dangling (line start, line end, doubled). Drop it, close the gap, and restore
  // the capital ONLY on a line the dash used to open — never touch a line it never led.
  out = out.replace(/^([ \t]*)[—–][ \t]*([a-z])/gm, (_m, ws: string, ch: string) => {
    count++;
    return ws + ch.toUpperCase();
  });
  out = out.replace(/[—–]/g, () => {
    count++;
    return "";
  });
  out = out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,!?])/g, "$1").replace(/[ \t]+$/gm, "");

  return { text: out, count };
}

/**
 * Normalize every slide of every carousel in place. Returns the total dashes replaced so the caller
 * can log and report it.
 */
export function normalizeDashesInSlides<T extends { text?: string }>(
  carousels: { slides: T[] }[],
): number {
  let total = 0;
  for (const car of carousels) {
    for (const slide of car.slides || []) {
      const { text, count } = normalizeDashes(slide.text || "");
      if (count) {
        slide.text = text;
        total += count;
      }
    }
  }
  return total;
}
