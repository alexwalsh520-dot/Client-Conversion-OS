/**
 * Dietary style: OMNIVORE.
 *
 * Default style — no animal-product restrictions. Included as a rule file
 * so the generator treats "omnivore" symmetrically with the other styles.
 * Its hard_exclude is empty.
 */

import { DietaryStyle, type DietaryRule } from "../types";

const dietary_omnivore: DietaryRule = {
  kind: "dietary",
  style: DietaryStyle.OMNIVORE,
  flag: DietaryStyle.OMNIVORE,
  label: "Omnivore",
  description: "Default — no animal-product restrictions.",
  hard_exclude: [],
  preferred_swaps: [],
  cautions: [],
  generator_prompt_additions: [
    "Client eats everything — no dietary-style restrictions.",
  ],
};

export default dietary_omnivore;
