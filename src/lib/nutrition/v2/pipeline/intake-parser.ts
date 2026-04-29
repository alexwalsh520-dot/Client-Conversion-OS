/**
 * Phase B6a — intake form parser.
 *
 * The nutrition_intake_forms table stores free-text fields filled in by
 * the client themselves (height "5'10", current_weight "318", goal_weight
 * "230"). Before B1's calculator can consume them, we need to convert to
 * canonical units (cm + kg).
 *
 * CRITICAL: CCOS clients are US-based. Naked numeric weights default to
 * POUNDS. A coach setting "185" in the form means 185 lbs, NOT 185 kg.
 * Mistaking the unit in either direction produces wildly wrong macros.
 *
 * Failures throw IntakeParseError with the field name + raw value so the
 * pipeline runner can surface the exact problem to the coach.
 *
 * Goal weight is non-blocking by design: missing or unparseable goal
 * weight is acceptable (results in a generic timeline note in the PDF).
 * Current weight, height, and age are blocking — the calculator can't run
 * without them.
 */

const KG_PER_LB = 0.453592;
const CM_PER_INCH = 2.54;

// ============================================================================
// Error type
// ============================================================================

export class IntakeParseError extends Error {
  readonly field: string;
  readonly rawValue: string;
  readonly hint?: string;
  constructor(field: string, rawValue: string, hint?: string) {
    const detail = hint ? ` — ${hint}` : "";
    super(`IntakeParseError on '${field}' — raw value "${rawValue}" could not be parsed${detail}`);
    this.name = "IntakeParseError";
    this.field = field;
    this.rawValue = rawValue;
    this.hint = hint;
  }
}

// ============================================================================
// Weight parser  (NAKED NUMBERS DEFAULT TO POUNDS)
// ============================================================================

export interface ParseWeightResult {
  /** Canonical kilograms — what B1's MacroInputsV2 consumes. */
  kg: number;
  /** Pounds — same value, lbs precision. Helpful for display. */
  lbs: number;
  /** "lb" if the value was treated as pounds; "kg" if explicit kg was given. */
  detectedUnit: "lb" | "kg";
}

/**
 * Parse a weight string into kilograms.
 *
 * Default: pounds. CCOS is US-based; clients write "185" meaning 185 lbs.
 *
 * Examples:
 *   "185"         → 185 lbs → 83.9 kg     (DEFAULT TO LBS)
 *   "185 lbs"     → 185 lbs → 83.9 kg
 *   "185lb"       → 185 lbs → 83.9 kg
 *   "185 pounds"  → 185 lbs → 83.9 kg
 *   "82 kg"       → 82 kg                  (explicit kg honored)
 *   "82kg"        → 82 kg
 *   "82 kilos"    → 82 kg
 *   "82 kilograms"→ 82 kg
 *   ""            → IntakeParseError
 *   "tbd"         → IntakeParseError
 */
export function parseWeight(raw: string, fieldName: string): ParseWeightResult {
  const cleaned = (raw || "").trim().toLowerCase();
  if (!cleaned) {
    throw new IntakeParseError(fieldName, raw, "weight is empty");
  }

  // Pull the leading numeric portion. Handles "185", "185.5", "185 lbs", etc.
  const numMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!numMatch) {
    throw new IntakeParseError(
      fieldName,
      raw,
      `expected a number optionally followed by a unit (e.g. "185", "185 lbs", "82 kg")`,
    );
  }
  const value = parseFloat(numMatch[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new IntakeParseError(fieldName, raw, `non-positive or non-finite numeric "${numMatch[1]}"`);
  }
  const unit = (numMatch[2] || "").trim();

  // Detect explicit kg unit. Accept common spellings.
  const isExplicitKg =
    unit === "kg" ||
    unit === "kgs" ||
    unit === "kilo" ||
    unit === "kilos" ||
    unit === "kilogram" ||
    unit === "kilograms";

  // Detect explicit lb unit. Accept common spellings.
  const isExplicitLb =
    unit === "lb" ||
    unit === "lbs" ||
    unit === "pound" ||
    unit === "pounds";

  if (!isExplicitKg && !isExplicitLb && unit !== "") {
    throw new IntakeParseError(
      fieldName,
      raw,
      `unrecognized unit "${unit}" — accepted: lb/lbs/pound/pounds/kg/kgs/kilo/kilos/kilogram/kilograms (or no unit, defaults to lbs)`,
    );
  }

  if (isExplicitKg) {
    return {
      kg: value,
      lbs: value / KG_PER_LB,
      detectedUnit: "kg",
    };
  }

  // Naked number OR explicit lb → treat as pounds.
  return {
    kg: value * KG_PER_LB,
    lbs: value,
    detectedUnit: "lb",
  };
}

// ============================================================================
// Height parser
// ============================================================================

export interface ParseHeightResult {
  cm: number;
  /** Display string, e.g. "5'10\"". */
  ftInLabel: string;
}

/**
 * Parse a height string into centimeters.
 *
 * The most common intake-form pattern is `"5'10"` (no closing quote).
 * Naked numbers ≥100 are assumed to be cm; <100 inches.
 *
 * Examples:
 *   "5'10"      → 5 ft 10 in = 178 cm    (the common form)
 *   "5'10\""    → 178 cm
 *   "5' 10\""   → 178 cm
 *   "5 ft 10 in"→ 178 cm
 *   "5ft10in"   → 178 cm
 *   "5 ft"      → 5 ft 0 in = 152 cm     (feet only, inches default 0)
 *   "5'"        → 152 cm
 *   "178"       → 178 cm                  (≥100 → cm)
 *   "68"        → 68 inches = 173 cm      (<100 → inches)
 *   "178 cm"    → 178 cm
 *   "5.83 ft"   → 5.83 × 12 = 70 in = 178 cm
 *   ""          → IntakeParseError
 */
export function parseHeight(raw: string, fieldName: string = "height"): ParseHeightResult {
  const cleaned = (raw || "").trim().toLowerCase();
  if (!cleaned) {
    throw new IntakeParseError(fieldName, raw, "height is empty");
  }

  // Try ft/in formats first (covers "5'10", "5'10\"", "5 ft 10 in", "5ft10in")
  // Allow apostrophe / "ft" for feet, and double-quote / "in" / nothing for inches.
  // Order is important: more-specific patterns first.
  const ftInPatterns: RegExp[] = [
    // "5'10\"" or "5' 10\"" or "5'10" (no closing quote — common!) or "5'10in"
    /^(\d+(?:\.\d+)?)\s*[']\s*(\d+(?:\.\d+)?)\s*(?:["”]|in|inch|inches)?$/,
    // "5 ft 10 in" or "5ft10in" or "5 feet 10 inches"
    /^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches|["”])?$/,
  ];
  for (const pat of ftInPatterns) {
    const m = cleaned.match(pat);
    if (m) {
      const ft = parseFloat(m[1]);
      const inches = parseFloat(m[2]);
      if (!Number.isFinite(ft) || !Number.isFinite(inches) || ft < 0 || inches < 0) {
        throw new IntakeParseError(fieldName, raw, "ft/in components non-positive");
      }
      const totalIn = ft * 12 + inches;
      const cm = Math.round(totalIn * CM_PER_INCH);
      return {
        cm,
        ftInLabel: `${Math.floor(ft)}'${Math.round(inches)}"`,
      };
    }
  }

  // Feet-only formats (no inches): "5'", "5 ft", "5ft", "5 feet"
  const ftOnlyPatterns: RegExp[] = [
    /^(\d+(?:\.\d+)?)\s*[']$/,
    /^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)$/,
  ];
  for (const pat of ftOnlyPatterns) {
    const m = cleaned.match(pat);
    if (m) {
      const ft = parseFloat(m[1]);
      if (!Number.isFinite(ft) || ft <= 0) {
        throw new IntakeParseError(fieldName, raw, "non-positive feet value");
      }
      const totalIn = ft * 12;
      const cm = Math.round(totalIn * CM_PER_INCH);
      return {
        cm,
        ftInLabel: `${Math.floor(ft)}'0"`,
      };
    }
  }

  // Naked-number formats. Try: explicit cm/in suffix, then bare number.
  const suffixMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!suffixMatch) {
    throw new IntakeParseError(
      fieldName,
      raw,
      `unrecognized height format — try "5'10\"" or "178 cm" or just "178"`,
    );
  }
  const value = parseFloat(suffixMatch[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new IntakeParseError(fieldName, raw, "non-positive numeric height");
  }
  const unit = (suffixMatch[2] || "").trim();

  // Explicit cm
  if (unit === "cm" || unit === "centimeter" || unit === "centimeters") {
    const cm = Math.round(value);
    return {
      cm,
      ftInLabel: cmToFtIn(cm),
    };
  }
  // Explicit inches
  if (unit === "in" || unit === "inch" || unit === "inches") {
    const cm = Math.round(value * CM_PER_INCH);
    return {
      cm,
      ftInLabel: cmToFtIn(cm),
    };
  }
  // Explicit meters
  if (unit === "m" || unit === "meter" || unit === "meters") {
    const cm = Math.round(value * 100);
    return {
      cm,
      ftInLabel: cmToFtIn(cm),
    };
  }
  if (unit !== "") {
    throw new IntakeParseError(
      fieldName,
      raw,
      `unrecognized height unit "${unit}"`,
    );
  }

  // Bare number — if ≥100, assume cm; <100, assume inches.
  // 100 was picked because: shortest realistic adult cm = ~140; tallest
  // inches measurement = ~84 (7 ft). The gap (84 < 100) gives clean
  // disambiguation. Anything <50 or >250 we reject as implausible.
  if (value >= 100) {
    if (value > 250) {
      throw new IntakeParseError(fieldName, raw, `${value} interpreted as cm but exceeds plausible range`);
    }
    const cm = Math.round(value);
    return {
      cm,
      ftInLabel: cmToFtIn(cm),
    };
  }
  if (value < 36 || value > 99) {
    throw new IntakeParseError(fieldName, raw, `${value} interpreted as inches but outside plausible range (36–99)`);
  }
  const cm = Math.round(value * CM_PER_INCH);
  return {
    cm,
    ftInLabel: cmToFtIn(cm),
  };
}

function cmToFtIn(cm: number): string {
  const totalIn = cm / CM_PER_INCH;
  const ft = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn - ft * 12);
  return `${ft}'${inches}"`;
}

// ============================================================================
// Age parser
// ============================================================================

/**
 * Age comes back from Supabase as `integer | null`. The form pre-validates
 * to integers; this function exists only to throw a structured error if a
 * non-positive or out-of-range integer somehow appears in the row.
 */
export function parseAge(raw: number | string | null | undefined, fieldName: string = "age"): number {
  if (raw === null || raw === undefined || raw === "") {
    throw new IntakeParseError(fieldName, String(raw ?? ""), "age is empty");
  }
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new IntakeParseError(fieldName, String(raw), "age must be an integer");
  }
  if (n < 13 || n > 100) {
    throw new IntakeParseError(fieldName, String(raw), `age ${n} out of plausible range (13–100)`);
  }
  return n;
}

// ============================================================================
// Goal-weight parser (NON-BLOCKING)
// ============================================================================

export interface ParseGoalWeightResult {
  /** Parsed kg, or null if unparseable / empty. */
  kg: number | null;
  /** Pounds for display, or null. */
  lbs: number | null;
  /** True if the parse failed but was non-blocking (empty / unparseable). */
  unparseable: boolean;
  /** When unparseable, the reason for diagnostics. */
  reason?: string;
}

/**
 * Goal weight is non-blocking. Empty values and unparseable values BOTH
 * return { kg: null, unparseable: true } rather than throwing — the
 * pipeline runner uses this to render a generic timeline note instead
 * of a specific projection.
 */
export function parseGoalWeight(raw: string): ParseGoalWeightResult {
  const cleaned = (raw || "").trim();
  if (!cleaned || /^(none|n\/?a|tbd|unknown|\?)$/i.test(cleaned)) {
    return {
      kg: null,
      lbs: null,
      unparseable: true,
      reason: cleaned ? `placeholder value "${cleaned}"` : "empty",
    };
  }
  try {
    const result = parseWeight(cleaned, "goal_weight");
    return { kg: result.kg, lbs: result.lbs, unparseable: false };
  } catch (err) {
    return {
      kg: null,
      lbs: null,
      unparseable: true,
      reason: err instanceof IntakeParseError ? err.hint : String(err),
    };
  }
}
