/**
 * Shared TypeScript types for the v2 nutrition generator.
 *
 * All build specs, distribution templates, and swap rules import from this
 * single module. No magic strings anywhere in v2 — enums / const objects only.
 *
 * Layer map:
 *   Layer 1 (macros): extends calculateMacros() — BuildType, rest-day adjustment
 *   Layer 2 (structure): MealDistribution — per-slot macro split
 *   Layer 3 (restrictions): SwapRule — allergy / medical / dietary
 *   Layer 4 (solver): BuildSpec tier lists + PlanComplexityCap → MILP
 *
 * This file is DATA-ONLY. It exports no behavior. Wiring happens in a later
 * phase once all spec files are reviewed.
 */

// ============================================================================
// Enums (const objects — safer than TS enums, tree-shakeable)
// ============================================================================

export const BuildType = {
  RECOMP: "recomp",
  SHRED: "shred",
  BULK: "bulk",
  LEAN_GAIN: "lean_gain",
  ENDURANCE: "endurance",
  MAINTAIN: "maintain",
} as const;
export type BuildType = (typeof BuildType)[keyof typeof BuildType];
export const ALL_BUILD_TYPES: BuildType[] = Object.values(BuildType);

export const DistributionTemplateId = {
  STANDARD_3_MEAL: "standard_3_meal",
  LUNCH_CENTERED_3_MEAL: "lunch_centered_3_meal",
  STANDARD_4_MEAL: "standard_4_meal",
  ATHLETE_5_MEAL: "athlete_5_meal",
  BODYBUILDER_6_MEAL: "bodybuilder_6_meal",
  ENDURANCE_5_MEAL_TRAINING_DAY: "endurance_5_meal_training_day",
  ENDURANCE_3_MEAL_REST_DAY: "endurance_3_meal_rest_day",
} as const;
export type DistributionTemplateId =
  (typeof DistributionTemplateId)[keyof typeof DistributionTemplateId];
export const ALL_DISTRIBUTION_TEMPLATE_IDS: DistributionTemplateId[] =
  Object.values(DistributionTemplateId);

export const AllergyFlag = {
  DAIRY: "allergy_dairy",
  EGGS: "allergy_eggs",
  FISH: "allergy_fish",
  GLUTEN: "allergy_gluten",
  PEANUTS: "allergy_peanuts",
  SESAME: "allergy_sesame",
  SHELLFISH: "allergy_shellfish",
  SOY: "allergy_soy",
  SULFITES: "allergy_sulfites",
  TREE_NUTS: "allergy_tree_nuts",
  // Intolerance — lives alongside allergies for UI purposes but is NOT a
  // true allergy. Split from DAIRY per architecture brief.
  INTOLERANCE_LACTOSE: "intolerance_lactose",
} as const;
export type AllergyFlag = (typeof AllergyFlag)[keyof typeof AllergyFlag];
export const ALL_ALLERGY_FLAGS: AllergyFlag[] = Object.values(AllergyFlag);

export const MedicalFlag = {
  HBP: "medical_hbp",                        // high blood pressure → Na cap 1800
  DIABETES_T2: "medical_diabetes_t2",        // low-GI, carb shift
  KIDNEY: "medical_kidney",                  // protein cap, Na+K+P limit
  IBS: "medical_ibs",                        // low-FODMAP swaps
  PREGNANT_NURSING: "medical_pregnant_nursing", // shred lock, exclude high-Hg fish
  GOUT: "medical_gout",                      // purine limit
  REFLUX: "medical_reflux",                  // trigger avoidance
  PCOS: "medical_pcos",                      // low-GI, anti-inflammatory
} as const;
export type MedicalFlag = (typeof MedicalFlag)[keyof typeof MedicalFlag];
export const ALL_MEDICAL_FLAGS: MedicalFlag[] = Object.values(MedicalFlag);

export const DietaryStyle = {
  OMNIVORE: "omnivore",
  VEGETARIAN: "vegetarian",
  PESCATARIAN: "pescatarian",
  VEGAN: "vegan",
} as const;
export type DietaryStyle = (typeof DietaryStyle)[keyof typeof DietaryStyle];
export const ALL_DIETARY_STYLES: DietaryStyle[] = Object.values(DietaryStyle);

export const PlanComplexity = {
  BEGINNER: "beginner",
  INTERMEDIATE: "intermediate",
  ADVANCED: "advanced",
} as const;
export type PlanComplexity = (typeof PlanComplexity)[keyof typeof PlanComplexity];
export const PLAN_COMPLEXITY_INGREDIENT_CAP: Record<PlanComplexity, number> = {
  [PlanComplexity.BEGINNER]: 5,
  [PlanComplexity.INTERMEDIATE]: 7,
  [PlanComplexity.ADVANCED]: 10,
};

export const SolverBias = {
  VOLUME: "volume",     // prefer high-volume-per-kcal (shred, cut)
  NEUTRAL: "neutral",   // no tiebreaker
  DENSITY: "density",   // prefer calorie-dense (bulk, surplus, small stomachs)
} as const;
export type SolverBias = (typeof SolverBias)[keyof typeof SolverBias];

// ============================================================================
// Meal slots and tiers
// ============================================================================

export const MealSlotKind = {
  BREAKFAST: "breakfast",
  LUNCH: "lunch",
  DINNER: "dinner",
  SNACK: "snack",
  PRE_WORKOUT: "pre_workout",
  POST_WORKOUT: "post_workout",
} as const;
export type MealSlotKind = (typeof MealSlotKind)[keyof typeof MealSlotKind];

export const IngredientTier = {
  TIER_1: 1, // default pool — most frequent, always OK
  TIER_2: 2, // acceptable — use in moderation / with frequency caps
  TIER_3: 3, // exclude / flag — requires explicit tag
} as const;
export type IngredientTier = (typeof IngredientTier)[keyof typeof IngredientTier];

/**
 * Every Tier 3 entry MUST carry one of these tags. No vague "avoid" language.
 */
export const Tier3Tag = {
  HARD_EXCLUDE: "hard_exclude",   // solver never selects this slug
  SOFT_EXCLUDE: "soft_exclude",   // usable but capped (see frequency_cap)
  FLAG_TO_COACH: "flag_to_coach", // solver may use; UI surfaces a note
} as const;
export type Tier3Tag = (typeof Tier3Tag)[keyof typeof Tier3Tag];

/**
 * Hybrid tag marks ingredients that serve multiple macro roles
 * (e.g. Greek yogurt = protein + some fat, whole eggs = protein + fat,
 * salmon = protein + fat). Solver needs to know when a slug counts against
 * more than one tier/frequency bucket.
 */
export const HybridTagKind = {
  PROTEIN: "protein",
  FAT: "fat",
  CARB: "carb",
  PROTEIN_FAT: "protein+fat",
  PROTEIN_CARB: "protein+carb",
  CARB_FAT: "carb+fat",
} as const;
export type HybridTagKind = (typeof HybridTagKind)[keyof typeof HybridTagKind];

/**
 * Macro role of an ingredient slot (used for per-meal floors + tier counting).
 */
export const MacroRole = {
  PROTEIN: "protein",
  CARB: "carb",
  FAT: "fat",
  VEGGIE: "veggie",
  FRUIT: "fruit",
  CONDIMENT: "condiment",
  BEVERAGE: "beverage",
  SUPPLEMENT: "supplement",
} as const;
export type MacroRole = (typeof MacroRole)[keyof typeof MacroRole];

// ============================================================================
// BuildSpec — one per build type
// ============================================================================

export interface TierEntry {
  /** Ingredient slug — MUST exist in the Supabase `ingredients` table. */
  slug: string;
  /** Macro role (primary). For hybrids, see hybrid. */
  role: MacroRole;
  /** Optional hybrid macro tagging. */
  hybrid?: HybridTagKind;
  /** Optional notes for the coach / generator prompt. */
  notes?: string;
}

export interface Tier3Entry extends TierEntry {
  tag: Tier3Tag;
  /**
   * For SOFT_EXCLUDE: max uses per week across the plan. Ignored otherwise.
   * Solver enforces via an ILP ≤ constraint.
   */
  frequency_cap?: number;
  /**
   * For FLAG_TO_COACH: the message surfaced in the UI when the solver
   * selects this slug. Required when tag = FLAG_TO_COACH.
   */
  coach_note?: string;
}

/**
 * Per-week frequency cap on a slug (independent of tier).
 * Used for variety constraints: "no repeating anchor proteins more than 2×/week".
 */
export interface FrequencyCap {
  slug: string;
  max_per_week: number;
  reason: string;
}

export interface BuildSpec {
  /** One of BuildType. */
  id: BuildType;
  /** Human-readable label for UI buttons. */
  label: string;
  /** Short blurb for UI help text. */
  description: string;

  // ---- Macro targeting hooks (consumed by calculateMacrosForBuild) ----
  // Field names match the Section 8 locked spec verbatim.

  /**
   * kcal delta added to TDEE to derive training-day calories.
   *   recomp -150, shred -350, bulk +400, lean_gain +200,
   *   endurance +250, maintain 0.
   */
  kcal_offset_from_tdee: number;

  /** Protein grams per pound of bodyweight (training-day anchor). */
  protein_g_per_lb: number;

  /**
   * Fat as a fraction of TRAINING-day calories (e.g. 0.30 = 30%).
   * Calculator: fatG = round(trainingCalories × fat_pct_of_kcal / 9).
   * Fat is anchored to training-day kcal — rest days reuse the same gram
   * value so rest_day_fat_change stays at 0g (carbs absorb the kcal drop).
   */
  fat_pct_of_kcal: number;

  /**
   * Negative kcal delta from training-day calories on rest days
   * (e.g. -200 means rest day is 200 kcal below training).
   */
  rest_day_kcal_drop: number;

  /**
   * Per-spec rule: protein never changes between training and rest days.
   * Always 0 for every build today; field exists to match Section 8 verbatim
   * and to flag any future drift if the spec changes.
   */
  rest_day_protein_change: number;

  /**
   * Carbs absorb the rest-day kcal drop. Documentation field — calculator
   * computes carbs as the kcal balance, but this value should equal
   * rest_day_kcal_drop / 4 (rounded). Used for spec verification only.
   */
  rest_day_carbs_change: number;

  /**
   * Per-spec rule: fat never changes between training and rest days.
   * Always 0 for every build today; field exists to match Section 8 verbatim.
   */
  rest_day_fat_change: number;

  // ---- B4 audit thresholds (post-solver safety check 3) ----
  /**
   * Minimum fraction of "protein-anchored slots" (slots with ≥15g total
   * protein) whose highest-protein ingredient must be in this build's
   * tier_1 list. Audit BLOCKs the plan if actual fraction is below.
   * Required count = Math.ceil(total_anchored_slots × this_pct).
   */
  tier_1_protein_min_pct_of_anchored_slots: number;

  /**
   * Minimum fraction of "carb-anchored slots" (slots with ≥10g total carbs)
   * whose highest-carb ingredient must be in this build's tier_1 list.
   */
  tier_1_carb_min_pct_of_anchored_slots: number;

  // ---- Structure ----
  /** Default meal distribution template for this build. Coach can override. */
  default_distribution: DistributionTemplateId;
  /** Distribution templates permitted for this build. */
  allowed_distributions: DistributionTemplateId[];
  /**
   * Whether this build supports per-day variable meal counts
   * (training vs rest day). Only `endurance` returns true.
   */
  per_day_variable_meals: boolean;

  // ---- Solver behavior ----
  /** Default solver bias for this build. */
  default_solver_bias: SolverBias;

  // ---- Ingredient tier lists ----
  tier_1: TierEntry[];
  tier_2: TierEntry[];
  tier_3: Tier3Entry[];

  /**
   * Per-slug caps in addition to tier rules (e.g. variety guardrails).
   */
  frequency_caps: FrequencyCap[];

  /**
   * Free-form guidance strings that get concatenated into the LLM slot-picker
   * prompt. Keep these terse and directive ("prefer X over Y", "include fatty
   * fish at least 2×/week").
   */
  generator_prompt_notes: string[];

  /**
   * Build-specific notes that go on the PDF cover or into coach documentation.
   */
  coach_notes: string[];
}

// ============================================================================
// MealDistribution — one per template
// ============================================================================

/**
 * A single meal slot's macro share (as percentages summing to 100 within each
 * column across all slots in the template).
 */
export interface DistributionSlot {
  /** Slot index within the day (1-based). */
  index: number;
  /** Display name shown on PDF ("Breakfast", "Lunch", "Snack 1"). */
  label: string;
  /** Slot kind for protein-floor / tier-counting logic. */
  kind: MealSlotKind;
  /** % of day's total protein in this slot. */
  protein_pct: number;
  /** % of day's total carbs in this slot. */
  carb_pct: number;
  /** % of day's total fat in this slot. */
  fat_pct: number;
  /**
   * Solver bias for this specific slot (optional — overrides build default).
   * Only used for endurance where pre-workout carbs should bias volume-light
   * and post-workout should bias density.
   */
  bias?: SolverBias;
}

export interface MealDistribution {
  id: DistributionTemplateId;
  label: string;
  description: string;
  /** Number of slots in the day. */
  meals_per_day: number;
  /**
   * Tag: does this template apply to training days, rest days, or both?
   * Only endurance-specific templates differentiate.
   */
  day_kind: "training" | "rest" | "any";
  slots: DistributionSlot[];
}

// ============================================================================
// SwapRule — one per allergy / medical / dietary flag
// ============================================================================

/**
 * Every swap rule lists:
 *   - hard_exclude: slugs the solver must never select
 *   - preferred_swaps: slug → slug suggestions surfaced to the LLM / PDF
 *   - cautions: slugs kept in the pool but flagged on the UI
 *
 * Medical flags can additionally demand coach acknowledgement before
 * generation (block_generation_unless_acknowledged) and can force build
 * choices (e.g. disable Shred during pregnancy).
 */

export interface SwapSuggestion {
  from: string; // slug being replaced
  to: string;   // replacement slug
  reason: string;
}

export interface SwapRuleBase {
  /** The flag slug (matches the enum value). */
  flag: string;
  /** Human-readable label for the UI checkbox. */
  label: string;
  /** Short blurb shown near the checkbox. */
  description: string;
  /** Slugs the solver MUST NOT select when this flag is on. */
  hard_exclude: string[];
  /** Slugs to prefer as substitutions (surfaced to LLM + coach notes). */
  preferred_swaps: SwapSuggestion[];
  /** Slugs allowed but flagged — UI shows a caution note. */
  cautions?: string[];
  /** Free-text additions to the generator prompt when this flag is on. */
  generator_prompt_additions?: string[];
}

export interface AllergyRule extends SwapRuleBase {
  kind: "allergy" | "intolerance";
}

export interface MedicalRule extends SwapRuleBase {
  kind: "medical";
  /** If true, UI must show an acknowledgement banner before allowing generation. */
  block_generation_unless_acknowledged: boolean;
  /** Optional acknowledgement text shown to the coach. */
  acknowledgement_text?: string;
  /** If set, disables one or more BuildTypes in the UI. */
  build_lock?: { disabled_builds: BuildType[]; reason: string };
  /** Optional sodium cap override (mg/day). Takes precedence over default 2300. */
  sodium_cap_mg?: number;
  /** Optional protein cap (g/lb). Takes precedence over build default. */
  protein_cap_per_lb?: number;
}

export interface DietaryRule extends SwapRuleBase {
  kind: "dietary";
  /** Style ID matching DietaryStyle enum. */
  style: DietaryStyle;
}

export type SwapRule = AllergyRule | MedicalRule | DietaryRule;

// ============================================================================
// Meal templates — deterministic picker (B6a-pivot)
// ============================================================================
//
// Replaces the LLM picker (B3) with hand-authored per-build × dietary
// templates. Each template defines a 7-day pattern of meal slugs with
// substitution chains for allergy/medical/dietary handling.

export type WeekdayName =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/**
 * One ingredient in a templated meal slot. The substitution chain is
 * walked at runtime when the primary slug is in the client's hardExclude
 * set; the first non-excluded element wins. If the entire chain is
 * exhausted, the runtime emits a structured infeasibility error.
 */
export interface MealTemplateIngredient {
  slug: string;
  /** True for the slot's primary protein source. */
  anchor: boolean;
  /** Ordered fallback slugs. Walked left-to-right when `slug` is excluded. */
  swap_chain: string[];
}

export interface MealTemplateMeal {
  /** 1-based, matches MealDistribution.slots[i].index. */
  slot: number;
  /** Display label, e.g. "Breakfast". */
  name: string;
  /**
   * Authored fallback dish name. The production path generates dish names
   * via the dish-namer LLM module post-solve (so the names always reflect
   * the actual rendered ingredients). This authored value is the safety
   * net used when the LLM call fails, returns a malformed response, or
   * is missing for a specific meal.
   *
   * Required (NOT optional) — every meal ships with a fallback name,
   * even if the LLM is the primary source.
   *
   * Authoring guidance (still applies; LLM aims for the same style):
   *   • 2–5 words.
   *   • Real food, not chemistry. Lead with the anchor protein or the
   *     carb headline.
   *   • Avoid macro-speak. NOT "High Protein Bowl".
   *   • Don't repeat names within a single template's 7 days.
   *
   * Examples: "Blueberry Almond Protein Oats", "Lemon Herb Chicken &
   * Rice", "Miso Salmon with Sweet Potato".
   *
   * See docs/nutrition-template-authoring-spec.md §9 for the full
   * naming guide.
   */
  dish_name: string;
  ingredients: MealTemplateIngredient[];
}

export interface MealTemplateDay {
  day_of_week: WeekdayName;
  /** Endurance only. Defaults "training" for builds that don't cycle. */
  day_kind?: "training" | "rest";
  meals: MealTemplateMeal[];
}

export interface MealTemplate {
  /** Unique identifier, e.g. "recomp_omnivore_a". Stored on plan rows. */
  id: string;
  build: BuildType;
  dietary: DietaryStyle;
  /**
   * Authoritative meal count for this template's training days. For
   * Endurance, rest-day entries within weekly_pattern carry their own
   * shorter meal arrays (per-day variable count).
   */
  meals_per_day: number;
  description: string;
  /** Length 7. One entry per weekday in canonical order Mon→Sun. */
  weekly_pattern: MealTemplateDay[];
}

// ============================================================================
// Solver infeasibility messages (per Q6 resolution)
// ============================================================================

export interface InfeasibilityMessage {
  /** What constraint is binding (e.g. "protein_floor_breakfast", "sodium_cap"). */
  binding_constraint: string;
  /** Human-readable explanation. */
  message: string;
  /** 2–3 actionable recommendations the coach can pick from. */
  recommendations: string[];
}

// ============================================================================
// Ingredient registry reference — NOT a live fetch, just a pointer for
// static validation scripts. The actual validation happens against the
// Supabase `ingredients` table at build time (see self-check log).
// ============================================================================

/**
 * Canonical slug resolution. These are the ONLY slugs v2 code may write;
 * duplicates (salsa_jarred, tomato_raw, tomato_red_raw, onion_raw,
 * corn_cooked) exist in the DB for legacy reasons but must not be referenced
 * in build specs or swap rules.
 *
 * Exception: broccoli_raw is allowed inside raw-salad slot contexts only;
 * default broccoli usage must be broccoli_steamed.
 */
export const CANONICAL_SLUGS = {
  SALSA: "salsa",
  TOMATO: "tomato_roma_raw",
  ONION: "onion_yellow_raw",
  CORN: "corn_kernels_cooked",
  BROCCOLI: "broccoli_steamed",
} as const;

export const NON_CANONICAL_SLUGS_BANNED = [
  "salsa_jarred",
  "tomato_raw",
  "tomato_red_raw",
  "onion_raw",
  "corn_cooked",
  // broccoli_raw is conditionally allowed — not in this banned list
] as const;

// ============================================================================
// Type guards
// ============================================================================

export function isBuildType(v: unknown): v is BuildType {
  return typeof v === "string" && (ALL_BUILD_TYPES as string[]).includes(v);
}
export function isAllergyFlag(v: unknown): v is AllergyFlag {
  return typeof v === "string" && (ALL_ALLERGY_FLAGS as string[]).includes(v);
}
export function isMedicalFlag(v: unknown): v is MedicalFlag {
  return typeof v === "string" && (ALL_MEDICAL_FLAGS as string[]).includes(v);
}
export function isDietaryStyle(v: unknown): v is DietaryStyle {
  return typeof v === "string" && (ALL_DIETARY_STYLES as string[]).includes(v);
}
