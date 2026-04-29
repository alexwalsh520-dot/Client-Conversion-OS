/**
 * Phase B6a-pivot dish-namer — response parser + per-name validator.
 *
 * Defensive against:
 *   - missing entries (some meals named, others not)
 *   - empty / whitespace-only names
 *   - too long (>60 chars) or too few words (<2)
 *   - duplicate names within the plan
 *   - schema violations (wrong types, missing fields)
 */

import type { ParsedNameEntry } from "./name-meals";

// ---------------------------------------------------------------------------
// Word-count helpers
// ---------------------------------------------------------------------------

const MIN_WORDS = 2;
const MAX_WORDS = 5;
const MAX_CHARS = 60;

/** Split a dish name into words for length validation. Treats "&" and
 *  hyphenated words as a single word. */
function wordCount(name: string): number {
  // Replace & with space; split on whitespace; filter empties
  return name
    .replace(/&/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

// ---------------------------------------------------------------------------
// Forbidden-phrase check (macro-speak / generic filler)
// ---------------------------------------------------------------------------

const FORBIDDEN_SUBSTRINGS: ReadonlyArray<string> = [
  "high protein",
  "low carb",
  "macro",
  "wellness",
  "nutritious",
  "lean ",
  "healthy ",
  "clean ",
  // "power" is allowed (e.g. "Power Bowl") only because of historical examples
  // we showed the LLM. Catch the obviously-generic uses by exact word match.
];

function violatesForbidden(name: string): string | null {
  const lower = name.toLowerCase();
  for (const phrase of FORBIDDEN_SUBSTRINGS) {
    if (lower.includes(phrase)) return phrase;
  }
  // Also reject the bare-suffix offenders
  const trimmed = lower.trim();
  if (trimmed === "bowl" || trimmed === "plate" || trimmed === "mix" || trimmed === "combo") {
    return `bare-suffix-only ("${trimmed}")`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parse + validate the LLM tool response
// ---------------------------------------------------------------------------

export interface ParseResult {
  /**
   * Parsed entries that pass per-name validation. Indexed by (day, slot).
   * Caller deduplicates against authored fallbacks for any missing key.
   */
  parsed: Map<string, ParsedNameEntry>;
  /** Names rejected during parse. Caller falls those back per-meal. */
  rejected: Array<{
    day: number;
    slot: number;
    raw: string;
    reason: string;
  }>;
  /** Plan-level failure: schema malformed, can't extract any names. Triggers
   *  full-plan fallback. */
  fatal: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseToolResponse(toolInput: any): ParseResult {
  const rejected: ParseResult["rejected"] = [];

  if (toolInput == null || typeof toolInput !== "object") {
    return {
      parsed: new Map(),
      rejected: [],
      fatal: `tool_input is not an object: ${typeof toolInput}`,
    };
  }

  // Accept the canonical shape ({ names: [...] }) plus a few common
  // variations the model occasionally produces despite the schema:
  //   - top-level array (Sonnet sometimes drops the wrapper)
  //   - { data: [...] } / { dishes: [...] } / { results: [...] }
  // Pick the first array we find.
  let namesArray: unknown = null;
  if (Array.isArray(toolInput)) {
    namesArray = toolInput;
  } else if (Array.isArray(toolInput.names)) {
    namesArray = toolInput.names;
  } else {
    for (const key of ["dishes", "data", "results", "items", "meals"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const candidate = (toolInput as any)[key];
      if (Array.isArray(candidate)) {
        namesArray = candidate;
        break;
      }
    }
  }
  if (!Array.isArray(namesArray)) {
    const keys = Object.keys(toolInput).join(", ");
    return {
      parsed: new Map(),
      rejected: [],
      fatal: `tool_input has no array under names/dishes/data/results/items/meals (top-level keys: [${keys}])`,
    };
  }
  // Use namesArray as the iteration source from here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolInput = { names: namesArray };

  const parsed = new Map<string, ParsedNameEntry>();
  const seenLowerNames = new Set<string>();

  for (const entry of toolInput.names) {
    if (entry == null || typeof entry !== "object") continue;
    const day = typeof entry.day === "number" ? Math.floor(entry.day) : NaN;
    const slot = typeof entry.slot === "number" ? Math.floor(entry.slot) : NaN;
    const rawName = typeof entry.name === "string" ? entry.name.trim() : "";

    if (!Number.isFinite(day) || day < 1 || day > 7) continue;
    if (!Number.isFinite(slot) || slot < 1 || slot > 6) continue;

    if (rawName.length === 0) {
      rejected.push({ day, slot, raw: rawName, reason: "empty" });
      continue;
    }
    if (rawName.length > MAX_CHARS) {
      rejected.push({ day, slot, raw: rawName, reason: `>${MAX_CHARS} chars` });
      continue;
    }
    const wc = wordCount(rawName);
    if (wc < MIN_WORDS) {
      rejected.push({ day, slot, raw: rawName, reason: `<${MIN_WORDS} words` });
      continue;
    }
    if (wc > MAX_WORDS) {
      rejected.push({ day, slot, raw: rawName, reason: `>${MAX_WORDS} words` });
      continue;
    }
    const forbidden = violatesForbidden(rawName);
    if (forbidden) {
      rejected.push({
        day,
        slot,
        raw: rawName,
        reason: `forbidden phrase: "${forbidden}"`,
      });
      continue;
    }
    const lowerKey = rawName.toLowerCase();
    if (seenLowerNames.has(lowerKey)) {
      rejected.push({ day, slot, raw: rawName, reason: "duplicate within plan" });
      continue;
    }
    seenLowerNames.add(lowerKey);

    parsed.set(`${day}|${slot}`, { day, slot, name: rawName });
  }

  return { parsed, rejected, fatal: null };
}
