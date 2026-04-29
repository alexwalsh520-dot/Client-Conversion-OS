/**
 * Intolerance rule: LACTOSE (NOT a true allergy).
 *
 * Split from `allergy_dairy` per architecture brief. Lactose intolerance
 * excludes high-lactose dairy but ALLOWS:
 *   - Aged hard cheeses (cheddar, parmesan, swiss) — nearly lactose-free
 *   - Butter and ghee (trace lactose)
 *   - Greek yogurt / skyr (lower lactose than regular yogurt)
 *   - Whey protein ISOLATE (near-zero lactose)
 *
 * These checkboxes are INDEPENDENT in the UI: a client can tick dairy
 * allergy, lactose intolerance, both, or neither.
 */

import { AllergyFlag, type AllergyRule } from "../types";

const intolerance_lactose: AllergyRule = {
  kind: "intolerance",
  flag: AllergyFlag.INTOLERANCE_LACTOSE,
  label: "Lactose intolerance",
  description:
    "Lactose (milk sugar) intolerance — not a true allergy. Excludes " +
    "high-lactose dairy (milks, cream, fresh cheeses) but allows aged " +
    "cheeses, butter/ghee, and whey isolate.",
  hard_exclude: [
    // High-lactose liquid dairy
    "milk_skim",
    "milk_2_percent",
    "milk_whole",
    "half_and_half",
    "heavy_cream",
    // High-lactose fresh cheeses
    "cream_cheese",
    "cottage_cheese_full_fat",
    "cottage_cheese_low_fat",
    "ricotta_cheese_part_skim",
    "sour_cream",
    // High-lactose yogurt
    "regular_yogurt_plain",
    // Whey concentrate (has notable lactose; isolate is OK)
    "whey_protein_concentrate",
  ],
  preferred_swaps: [
    {
      from: "milk_2_percent",
      to: "almond_milk_unsweetened",
      reason: "Low-lactose plant milk.",
    },
    {
      from: "milk_whole",
      to: "soy_milk_unsweetened",
      reason: "Higher-protein lactose-free swap.",
    },
    {
      from: "regular_yogurt_plain",
      to: "greek_yogurt_2_plain",
      reason: "Strained Greek yogurt is lower-lactose; most intolerant clients tolerate.",
    },
    {
      from: "cottage_cheese_low_fat",
      to: "skyr_plain",
      reason: "Icelandic skyr is strained — lower lactose.",
    },
    {
      from: "cream_cheese",
      to: "greek_yogurt_whole_plain",
      reason: "Thick, tangy spread with less lactose.",
    },
    {
      from: "heavy_cream",
      to: "coconut_milk_unsweetened",
      reason: "Plant-based creamy texture.",
    },
    {
      from: "whey_protein_concentrate",
      to: "whey_protein_isolate",
      reason: "Isolate is near-zero lactose.",
    },
  ],
  cautions: [
    // Flag items that are usually tolerated but vary by severity
    "greek_yogurt_2_plain",
    "greek_yogurt_nonfat_plain",
    "greek_yogurt_whole_plain",
    "skyr_plain",
    "mozzarella_cheese_part_skim", // some residual lactose
    "mozzarella_cheese_whole",
  ],
  generator_prompt_additions: [
    "Client has lactose intolerance (NOT a true dairy allergy).",
    "ALLOWED: aged cheeses (cheddar, parmesan, swiss, feta, goat), butter/ghee, whey_protein_isolate, Greek yogurt / skyr.",
    "EXCLUDED: milks, cream, half-and-half, sour cream, cream cheese, cottage cheese, regular yogurt, whey concentrate.",
    "If Greek yogurt causes symptoms, swap to skyr or plant-based.",
  ],
};

export default intolerance_lactose;
