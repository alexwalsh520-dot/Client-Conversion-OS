/**
 * Medical rule: IBS (Irritable Bowel Syndrome).
 *
 * Blocks generation unless the coach acknowledges. Low-FODMAP leaning —
 * excludes or caps common FODMAP triggers (onion, garlic, wheat, lactose,
 * certain legumes, specific fruits).
 */

import { MedicalFlag, type MedicalRule } from "../types";

const medical_ibs: MedicalRule = {
  kind: "medical",
  flag: MedicalFlag.IBS,
  label: "IBS (Irritable Bowel Syndrome)",
  description:
    "Low-FODMAP-leaning swaps. Blocks generation until the coach " +
    "acknowledges — IBS triggers are personal and a plan should be tuned " +
    "with the client's specific tolerance.",
  hard_exclude: [
    // High-FODMAP, usually triggers
    "onion_yellow_raw",
    "onion_raw",          // canonical-banned anyway
    "red_onion_raw",
    "garlic_raw",
    "leeks_cooked",
  ],
  preferred_swaps: [
    {
      from: "onion_yellow_raw",
      to: "green_onion_raw", // green tops only are low-FODMAP
      reason: "Use green (onion tops) only — the white bulb is high-FODMAP.",
    },
    {
      from: "garlic_raw",
      to: "ginger_raw",
      reason: "Ginger aids digestion and is low-FODMAP. Garlic-infused olive oil (not in DB) is also safe.",
    },
    {
      from: "apple_raw",
      to: "blueberries_raw",
      reason: "Low-FODMAP berry.",
    },
    {
      from: "pear_raw",
      to: "strawberries_raw",
      reason: "Low-FODMAP berry.",
    },
    {
      from: "mango_raw",
      to: "kiwi_raw",
      reason: "Low-FODMAP tropical.",
    },
    {
      from: "watermelon_raw",
      to: "cantaloupe_raw",
      reason: "Lower-FODMAP melon (watermelon is high FODMAP).",
    },
    {
      from: "black_beans_cooked",
      to: "chicken_breast_cooked_skinless",
      reason: "Beans are high-FODMAP; animal protein is safer for most.",
    },
    {
      from: "chickpeas_cooked",
      to: "lentils_cooked", // small serving (~45g) is low-FODMAP
      reason: "A small portion of canned lentils (rinsed) is low-FODMAP; chickpeas usually aren't.",
    },
    {
      from: "whole_wheat_bread",
      to: "sourdough_bread", // fermentation lowers FODMAP
      reason: "Slow-fermented sourdough is usually tolerated.",
    },
    {
      from: "cottage_cheese_low_fat",
      to: "greek_yogurt_2_plain",
      reason: "Lower lactose (greek yogurt is strained).",
    },
    {
      from: "milk_2_percent",
      to: "almond_milk_unsweetened",
      reason: "Lactose-free plant milk.",
    },
  ],
  cautions: [
    // Common variable-tolerance triggers
    "black_beans_cooked",
    "kidney_beans_cooked",
    "pinto_beans_cooked",
    "lima_beans_cooked",
    "navy_beans_cooked",
    "split_peas_cooked",
    "chickpeas_cooked",
    "hummus",
    "milk_whole",
    "milk_2_percent",
    "milk_skim",
    "cream_cheese",
    "cottage_cheese_low_fat",
    "cottage_cheese_full_fat",
    "apple_raw",
    "pear_raw",
    "mango_raw",
    "honey",
    "agave_syrup",
    "dates_medjool",
    "broccoli_raw",
    "broccoli_steamed",
    "cauliflower_cooked",
    "brussels_sprouts_cooked",
    "cabbage_cooked",
    "cabbage_raw",
  ],
  block_generation_unless_acknowledged: true,
  acknowledgement_text:
    "Client has IBS. Triggers are individual — this plan uses low-FODMAP " +
    "defaults, but real-world tolerance must be dialed in 1:1 with the " +
    "client. Confirm you've discussed trigger-tracking. Tick to proceed.",
  generator_prompt_additions: [
    "Client has IBS. Use low-FODMAP defaults.",
    "Exclude: onion bulbs, garlic, high-FODMAP fruits (apple, pear, mango, watermelon).",
    "Green onion tops, garlic-infused oil, ginger are low-FODMAP safe.",
    "Small portions of canned rinsed lentils (~45g) are usually tolerated.",
    "Cruciferous veggies (broccoli, cauliflower) trigger some — flag to coach for individual tuning.",
  ],
};

export default medical_ibs;
