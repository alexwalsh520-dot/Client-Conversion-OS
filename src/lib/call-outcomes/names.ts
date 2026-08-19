// Prospect-name matching between GHL and the sales tracker.
//
// These two systems never agree on spelling. GHL takes the name the prospect
// typed into the booking widget; the sheet takes whatever the setter typed by
// hand minutes later. Real pairs seen in production:
//
//   GHL "Jazy Mantillal"    ↔ sheet "Jazy Mantilla "     (trailing letter + space)
//   GHL "Genesis De Jesus"  ↔ sheet "Génesis De Jesus"   (accent)
//   GHL "Greg Kuebler"      ↔ sheet "Gregory Keubler"    (nickname + transposition)
//
// So exact equality alone would drop a third of the day. The matcher below
// normalizes hard, then falls back to a surname-similarity + given-name-prefix
// rule that survives all three cases without being loose enough to collide two
// different prospects on the same day.

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Optimal string alignment distance (Levenshtein + adjacent transposition).
 * Transposition matters here: "kuebler" → "keubler" is one swap, not two edits.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push(new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1, // deletion
        rows[i][j - 1] + 1, // insertion
        rows[i - 1][j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + cost); // transposition
      }
    }
  }
  return rows[a.length][b.length];
}

/** One name is a shortening of the other ("greg" / "gregory"), min 3 chars. */
function isPrefixOf(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) return a === b;
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * Score how well two prospect names match. Returns null when they don't.
 * Lower is better: 0 = identical after normalization.
 */
export function nameMatchScore(
  aRaw: string | null | undefined,
  bRaw: string | null | undefined,
): number | null {
  const a = normalizeName(aRaw);
  const b = normalizeName(bRaw);
  if (!a || !b) return null;
  if (a === b) return 0;

  // Whole-string near-miss (one typo anywhere).
  const whole = editDistance(a, b);
  if (whole <= 2) return whole;

  const at = a.split(" ");
  const bt = b.split(" ");
  if (at.length < 2 || bt.length < 2) return null; // single-token names are too risky

  // Surname close + given name is a prefix/nickname of the other.
  const surnameDist = editDistance(at[at.length - 1], bt[bt.length - 1]);
  if (surnameDist <= 2 && isPrefixOf(at[0], bt[0])) return 3 + surnameDist;

  return null;
}

/** Pick the best-scoring candidate, or null when nothing matches. */
export function bestNameMatch<T>(
  target: string | null | undefined,
  candidates: T[],
  nameOf: (c: T) => string | null | undefined,
  tieBreak?: (c: T) => number, // lower wins among equal scores
): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  let bestTie = Infinity;

  for (const c of candidates) {
    const score = nameMatchScore(target, nameOf(c));
    if (score === null) continue;
    const tie = tieBreak ? tieBreak(c) : 0;
    if (score < bestScore || (score === bestScore && tie < bestTie)) {
      best = c;
      bestScore = score;
      bestTie = tie;
    }
  }
  return best;
}
