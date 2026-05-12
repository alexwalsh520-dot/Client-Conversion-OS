// Daily Coacher: post-processing safeguards for Claude-generated text.
//
// Em-dashes are forbidden in any Daily Coacher output (tips, summaries,
// draft messages). We instruct Claude not to produce them in the system
// prompts, but Claude occasionally drifts back to em-dash style on long
// generations. This module is the safety net.

/**
 * Replace em-dashes (U+2014) and en-dashes (U+2013) with safe alternatives,
 * preserving sentence flow.
 *
 * Strategy:
 *   - " — " or " — " (with surrounding whitespace) becomes ", "
 *   - Bare "—" / "–" with no whitespace becomes "-" (preserves word-pairs
 *     like "high-protein" if Claude renders them with an en-dash)
 *
 * Idempotent — running twice is the same as once.
 */
export function stripDashes(input: string): string {
  if (!input) return input;
  return input
    // Em-dash with surrounding spaces → comma. Handles "X — Y" → "X, Y".
    .replace(/\s*—\s*/g, ", ")
    // En-dash with surrounding spaces → comma (rare but possible).
    .replace(/\s*–\s*/g, ", ")
    // Any remaining bare em/en (e.g., inside a hyphenated word) → hyphen.
    .replace(/[—–]/g, "-")
    // Collapse double-comma artifacts from cases like "X, — Y".
    .replace(/,\s*,/g, ",")
    // Collapse stray double-spaces left over.
    .replace(/  +/g, " ")
    .trim();
}
