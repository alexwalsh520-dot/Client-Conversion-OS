/**
 * Per-day Claude meal generator.
 * Each call produces ONE day only — small output (~1000 tokens), ~5-8s.
 * Caller parallelizes 7 concurrent calls to stay well under Vercel's 60s limit.
 *
 * Claude outputs dish names + ingredient slugs + grams.
 * All macro arithmetic is done by code.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { IngredientRow } from "./ingredient-filter";
import type { MacroTargets } from "./macro-calculator";
import type { DayPlan } from "./macro-validator";

export interface ClientIntakeSummary {
  firstName: string;
  lastName: string;
  fitnessGoal: string;
  foodsEnjoy: string;
  foodsAvoid: string;
  allergies: string;
  proteinPreferences: string;  // "Chicken, Beef, Fish, Eggs, Dairy" — order matters
  canCook: string;
  mealCount: string;
  medications: string;
  supplements: string;
  sleepHours: string;
  waterIntake: string;
  dailyMealsDescription: string;
}

export interface DayGenerationInput {
  dayNumber: number;                 // 1-7
  weekday: string;                   // "Monday"..."Sunday"
  mealSlots: { name: string; time: string }[]; // per-day meal structure
  intake: ClientIntakeSummary;
  targets: MacroTargets;             // daily targets
  allowedIngredients: IngredientRow[]; // already filtered for allergies
  priorComments: string[];           // newest first
  // Client flags detected by code from intake form
  prefersQuickPrep: boolean;
  prefersSpicy: boolean;
  // Preferred proteins in ranked order (from intake "Protein Preferences")
  preferredProteins: string[];
  // Variation hint (e.g., avoid proteins used on prior days)
  avoidProteins?: string[];
  // Corrective feedback from a prior attempt on this day, if any
  priorAttemptError?: string;
  // Structural format hint to rotate meal formats across the week (bowl, wrap, salad, plate, etc.)
  formatHints?: Partial<Record<string, string>>;
  // Sodium budget context — populated for ANY client with a below-universal
  // daily sodium target (HBP: 1,800; stimulant: 2,000). Gives Claude a
  // running per-meal budget + a reference table of common high-sodium items
  // so it can plan meal-by-meal without blowing the daily total.
  sodiumContext?: {
    sodiumCapMg: number;
    dayNumber: number;
    reason: "hbp" | "stimulant";
    // HBP-only weekly frequency caps. Undefined for non-HBP (stimulant-only)
    // clients since they don't have the same compounding sodium pattern.
    hbpWeeklyCaps?: {
      allowedCheeseDaysLeft: number;
      allowedSourdoughDaysLeft: number;
      allowedFlourTortillaDaysLeft: number;
    };
  };
}

function buildSystemPrompt(): string {
  return `You are a precise nutritionist building ONE day of a meal plan.

OUTPUT FORMAT (non-negotiable):
- Return ONLY valid JSON. No markdown fences. No prose.
- All quantities are integer grams.

INGREDIENT CONSTRAINT (HARD RULE):
You may only use ingredient slugs from the ALLOWED INGREDIENTS list provided
in the user message below. Do not invent new slugs, do not pluralize, do not
add modifiers (e.g. "raw", "cooked", "diced") unless that exact slug appears
in the list. If the allowed list contains \`tomato_roma_raw\` but not
\`roma_tomato_raw\`, use \`tomato_roma_raw\`. If an ingredient you want to
use isn't in the list, pick the closest semantic match from the list instead.
Slugs not in the list will cause the plan to fail validation and be rejected.

CRITICAL — exact slug match required (these are the most common mistakes —
do not make them):
- Do NOT use \`bell_pepper_raw\` → use \`bell_pepper_red_raw\` or
  \`bell_pepper_green_raw\`. The allowed list does not contain a generic
  "bell_pepper_raw" — you must pick a color variant.
- Do NOT use \`tomato_raw\` → use \`tomato_roma_raw\` or \`tomato_red_raw\`.
- Do NOT drop color, variety, or cooking-state modifiers from the allowed
  list (e.g. "chicken_breast" is wrong if the list has
  "chicken_breast_cooked_skinless").
- If unsure which variant to pick, default to the most common one:
  red bell pepper over green, Roma tomato over generic red, skinless
  cooked over raw for meats.
- The rule applies to EVERY slug you write. Before emitting JSON, scan your
  ingredient list and verify each slug appears VERBATIM in the allowed list
  above. If any slug doesn't match, replace it.

MACRO HIERARCHY — strictness applies top-down:
1. CALORIES must be within ±5% of target, in BOTH directions. Do not undershoot OR overshoot.
   Plans that run 10%+ under target leave the client hungry and under-fueled.
2. FAT grams must be within ±10% of target. FAT is the #1 cause of plans failing validation.
   → Use added fats SPARINGLY: butter/oil 5-10g per meal (NOT 15-25g); cheese 15-20g
     portions (NOT 30-50g); nuts 15g portions (NOT 30g). Track them across the day.
   → NO SINGLE MEAL may contain more than 40% of the daily fat target. Spread fats across the day.
   → CROSS-MEAL BALANCE: if the day's MAIN protein (dinner or lunch) is inherently high-fat
     (salmon ~12g fat/100g, fatty beef, pork belly, duck), keep the other meals LEAN —
     use egg whites instead of whole eggs, skip butter/oil in cooking, use cottage cheese
     or Greek yogurt instead of cream cheese. Stacking fatty fish on top of an eggs+beef+
     butter breakfast will blow the daily fat budget.
3. PROTEIN must be within ±7% of target. Spread 20-40g per meal.
   → AIM AT the target, not above it. Hitting the protein NUMBER exactly matters —
     overshooting by 10-15g per meal stacks to +70-105g/day, which starves carbs
     and underfuels the client. If you're unsure, err on the low side of protein
     and let carbs fill the remaining calories.
   → Protein and carbs both cost 4 kcal/g — an extra 30g protein = 30g less carbs
     for the same calorie budget.
4. CARBS must be within ±7% of target. Starches (rice, oats, potato, bread, pasta,
   tortilla) fill the remaining calorie budget after protein and fat are set.
   → Generous carb portions are expected — 120-180g cooked rice, 80-100g dry oats,
     250-300g potato are normal serving sizes for a full meal.

MEAL COMPOSITION:
- LUNCH AND DINNER must each include at least ONE vegetable ingredient
  (bell pepper, onion, tomato, lettuce, corn, broccoli, spinach, mushrooms, cucumber, etc.).
  A "taco bowl" or "burrito bowl" without any vegetables is not realistic — peppers, onions,
  tomato, and lettuce belong in those dishes.
- Most meals should have 4-6 ingredients, not 2-3.

PER-MEAL PROTEIN FLOORS (mandatory):
- Breakfast must provide at least 25% of the daily protein target.
- Lunch    must provide at least 30% of the daily protein target.
- Dinner   must provide at least 30% of the daily protein target.
- Snacks fill the remainder.
- Concrete floors by daily target:
    Daily 150g → breakfast ≥ 38g, lunch ≥ 45g, dinner ≥ 45g
    Daily 180g → breakfast ≥ 45g, lunch ≥ 54g, dinner ≥ 54g
    Daily 200g → breakfast ≥ 50g, lunch ≥ 60g, dinner ≥ 60g
    Daily 220g → breakfast ≥ 55g, lunch ≥ 66g, dinner ≥ 66g
  NOTE: recomp clients with high daily protein targets (200g+) will NOT be
  able to hit a 50g+ breakfast floor with oats + fruit + nut butter — that
  base tops out around 15-20g. Use Greek yogurt 300g (≈30g) + whey 30g
  (≈25g) + eggs, or cottage cheese 200g (≈25g) + eggs 150g (≈20g) + whey,
  or similar multi-anchor combinations.
- Start EVERY meal by choosing a protein anchor that can mathematically support
  these grams at a reasonable portion (chicken breast 150-220g, beef 150-200g,
  salmon 150-200g, eggs 150g + cottage cheese 100g, Greek yogurt 200-300g, whey
  25-35g, tofu 150-200g, etc.). Do not try to squeeze protein out of a base that
  can't carry it (a bowl of oats + fruit + nut butter will NOT hit 50g protein).
- BEFORE FINALIZING the day, re-check each meal's protein grams against its
  floor. If breakfast is under floor, add or increase the protein anchor
  (don't ship with "close enough" — re-compute grams). This check is the last
  thing you do before returning the JSON.

PORTION SANITY (these signal a structural mistake, not a valid plan):
- No single meal may contain more than 350g of any single meat (chicken, beef, pork, fish).
- No single meal may contain more than 50g of any single oil/butter.
- No single meal may contain more than 200g of any single cheese type.
- No single meal may contain more than 150g of dry grains (pre-cook weight).
- If hitting the day's macros SEEMS to require exceeding these, the protein anchor
  is wrong — pick a different ingredient or combine two proteins.

UNIVERSAL SODIUM AWARENESS (applies to EVERY client, every day,
regardless of medical flags — this prevents stacking moderate-sodium
items into days that breach the 2300 mg AHA ceiling):
- No single day may combine ALL THREE of these three categories:
    (a) flour tortilla OR corn tortilla
    (b) cheese (mozzarella, cheddar, parmesan, cottage cheese, feta, etc.)
    (c) salted butter OR jarred salsa OR marinara sauce
  Pick at most 2 of these 3 categories on any given day. If a day already
  uses (a) + (b), keep (c) off the plate — cook with olive oil, skip the
  jarred salsa, skip the marinara.
- Default to UNSALTED butter whenever butter is used. Only use salted butter
  when the dish specifically requires it (rare).
- Weekly cheese cap for non-medical clients: at most 5 meals across the
  7-day week contain cheese. HBP clients have a stricter 3-meal cap (see
  medical sodium block below when present).

VARIETY — applies to EVERY meal slot, not just lunch:
- Follow the per-meal "format hint" when one is provided; it exists so your meal doesn't
  look identical to the other days of the week.
- Don't default to the same shape every day (e.g., not every breakfast an "oats bowl",
  not every lunch a "rice bowl", not every dinner a "protein + rice plate").
- Some repetition is fine for simple snacks, but breakfast/lunch/dinner should each have
  meaningful variation across the 7 days in at least protein source, carb source, AND
  structural format.

INGREDIENT SELECTION:
- Respect the client's ranked protein preferences — their #1 choice should appear 1-2×/week;
  pick a variety across the 7 days. Do not skip their top preference.
- Respect the foods-enjoy list: favor matching ingredients when they fit the macros.
- Respect "foods to avoid" and allergies absolutely.

DISH NAMING (truth-in-labeling):
- Every meal needs a real dish name (e.g., "Beef Burrito Bowl", "Oats with Berries and Whey").
- If you name a meal "Spicy X", it MUST include a real spicy ingredient
  (salsa, hot_sauce, jalapeno_raw, or similar). Do NOT label a meal "Spicy" without one.
- If you name a meal "Crockpot X" or "Slow Cooker X", it should look like a real one-pot dish
  — include vegetables and sauce/seasoning, not just a protein cube + rice + cheese.`;
}

function buildUserPrompt(input: DayGenerationInput): string {
  const {
    intake, targets, mealSlots, allowedIngredients, priorComments,
    dayNumber, weekday, avoidProteins, priorAttemptError,
    prefersQuickPrep, prefersSpicy, preferredProteins,
  } = input;

  // Compact ingredient list. When the client has a sodium cap in play
  // (HBP target <1800 or stimulant 2000), append real sodium mg/100g to
  // each row so Claude picks against actual USDA values instead of
  // guessing. DB is 279/279 populated, so every row has a number.
  const showSodium = !!input.sodiumContext;
  const ingredientList = allowedIngredients
    .map((i) => {
      const base = `${i.slug}|${i.name}|${i.category}|${i.calories_per_100g}kc/${i.protein_g_per_100g}p/${i.carbs_g_per_100g}c/${i.fat_g_per_100g}f per 100g`;
      if (!showSodium) return base;
      const na =
        i.sodium_mg_per_100g === null || i.sodium_mg_per_100g === undefined
          ? "?"
          : `${Math.round(Number(i.sodium_mg_per_100g))}`;
      return `${base}|${na}mg Na`;
    })
    .join("\n");

  const commentsBlock =
    priorComments.length > 0
      ? `\n\nNUTRITIONIST NOTES (apply, newest first):\n${priorComments
          .slice(0, 7)
          .map((c, i) => `${i + 1}. ${c}`)
          .join("\n")}`
      : "";

  const mealSlotsBlock = mealSlots
    .map((s, i) => {
      const hint = input.formatHints?.[s.name];
      return `${i + 1}. ${s.name} at ${s.time}${hint ? `  (format hint: ${hint})` : ""}`;
    })
    .join("\n");

  // Client-specific directives
  const directives: string[] = [];
  if (preferredProteins.length > 0) {
    directives.push(
      `Client's ranked protein preferences: ${preferredProteins.join(" → ")}. Favor their top 2 protein preferences in today's meals.`
    );
  }
  if (avoidProteins && avoidProteins.length > 0) {
    directives.push(
      `For variety, don't use these proteins today (already used on prior days): ${avoidProteins.join(", ")}.`
    );
  }
  if (prefersQuickPrep) {
    directives.push(
      "Client prefers QUICK PREP / crockpot / one-pot style meals. Avoid meals requiring >20 minutes of active cooking. Favor: ground meat, pre-cooked rotisserie chicken, canned tuna/salmon, microwaveable rice, bagged salad, simple assembly."
    );
  }
  if (prefersSpicy) {
    directives.push(
      "Client likes SPICY food. Where it fits (lunch/dinner especially), include salsa, hot sauce, jalapeños, chili powder, or sriracha as flavoring elements (they add flavor without major macro impact)."
    );
  }
  const directivesBlock = directives.length > 0 ? `\n\nCLIENT DIRECTIVES:\n${directives.map((d) => `- ${d}`).join("\n")}` : "";

  // Sodium management block — populated when the client has a below-universal
  // sodium target (HBP 1,800; stimulant 2,000). Instructs Claude to track a
  // RUNNING sodium total meal-by-meal as it builds the day, not just check
  // at the end. Also surfaces HBP weekly caps when applicable.
  const sc = input.sodiumContext;
  let sodiumBlock = "";
  if (sc) {
    const cap = sc.sodiumCapMg;
    const mealCount = input.mealSlots.length;
    const perMealAvg = Math.round(cap / mealCount);
    const reasonLine =
      sc.reason === "hbp"
        ? "Client has high blood pressure — sodium is their single most important dietary lever."
        : "Client is on a stimulant medication (raises blood pressure). Conservative sodium target applied.";
    const weeklyCapsLine = sc.hbpWeeklyCaps
      ? `
- HBP WEEKLY CAPS (days REMAINING before this day; plan accordingly):
    • Cheese: ${sc.hbpWeeklyCaps.allowedCheeseDaysLeft}/3 days left (all forms — cheddar, mozzarella, parmesan, cottage cheese, feta, cream cheese, etc.)
    • Sourdough bread: ${sc.hbpWeeklyCaps.allowedSourdoughDaysLeft}/2 days left — default to whole wheat / whole grain / oat-based
    • Flour tortillas: ${sc.hbpWeeklyCaps.allowedFlourTortillaDaysLeft}/3 days left — corn tortillas preferred (~15mg vs ~400mg)`
      : "";
    // Stimulant per-day stacking cap — prevents days like Anthony's Saturday
    // where moderate-sodium items (salsa + cheese + tortilla) stack to 2800+ mg
    // even though each item individually looks fine.
    const stimulantPerDayLine =
      sc.reason === "stimulant"
        ? `
- STIMULANT PER-DAY CAP (in addition to weekly caps):
    On any single day, pick AT MOST ONE of: salsa, hot sauce, cheese,
    flour tortilla, marinara sauce. Stacking two or more of these on the
    same day reliably pushes the day over the ${cap} mg sodium budget even
    when portions look reasonable. Swap the extras for no-sodium
    alternatives (fresh pico de gallo, fresh herbs, corn tortilla, plain
    tomato sauce + fresh basil).`
        : "";
    sodiumBlock = `\n\nSODIUM MANAGEMENT (DAILY BUDGET):
${reasonLine}
- Daily sodium budget: ${cap} mg. Today's total MUST land at or below ${cap}.
- Per-meal average budget: ~${perMealAvg} mg (for ${mealCount} meals/day).

HOW TO USE THE BUDGET (meal-by-meal, not end-of-day):
  Before you finalize each meal's ingredient list, estimate the meal's sodium
  using the reference table below. Track a running daily total as you build:
      running_total = sodium(meal_1) + sodium(meal_2) + ...
  If adding a proposed meal would push running_total above ${cap}, SWAP the
  highest-sodium ingredient in that meal before finalizing (e.g., corn tortilla
  for flour, olive oil + lemon for ranch/Italian, unsalted butter for salted,
  dry-cooked beans for canned, no-salt-added tuna for salted).

PRIMARY SOURCE: the allowed-ingredients list above shows real USDA sodium (mg per 100g) as the LAST pipe-delimited column (e.g. "|627mg Na"). Use THOSE numbers to build running_total. The table below is only for quick sanity checks when comparing swap candidates.

SODIUM REFERENCE TABLE (approximate):
  Breads:      sourdough ~340mg/slice, whole-wheat ~130mg/slice, white ~150mg/slice, English muffin ~200mg each
  Cheese:      mozzarella ~180mg/30g, cheddar ~180mg/30g, parmesan ~380mg/30g, feta ~320mg/30g, cottage cheese ~360mg/100g
  Tortillas:   flour (large) ~400mg each, corn ~15mg each   [prefer CORN]
  Cured meats: deli turkey ~700mg/100g, bacon ~600mg/slice, ham ~900mg/100g, salami ~1,500mg/100g
  Sauces:      soy sauce ~900mg/tbsp, marinara ~450mg/120g, BBQ ~300mg/30ml, ranch ~270mg/30ml, hot sauce ~180mg/15ml
  Canned:      black beans canned ~400mg/100g vs cooked from dry ~2mg/100g   [prefer DRY-COOKED or "no salt added"]
  Beef:        chuck/ground 80/20 has ~50% more sodium than sirloin/tenderloin (more connective tissue)
  Salsa:       commercial ~200mg/60g, fresh pico de gallo ~60mg/60g
  Fresh basics: plain rice ~0mg, oats ~0mg, fresh meats ~50-80mg/100g, fresh vegetables ~5-40mg/100g, fresh fruits <5mg/100g${weeklyCapsLine}${stimulantPerDayLine}`;
  }

  const retryBlock = priorAttemptError
    ? `\n\nCORRECTIVE FEEDBACK — your previous attempt for this day failed validation:\n${priorAttemptError}\nFix by adjusting portion sizes (smaller oil/butter/cheese/nut portions are the usual culprits). Do not change the set of ingredients dramatically.`
    : "";

  return `CLIENT INTAKE
Name: ${intake.firstName} ${intake.lastName}
Goal: ${intake.fitnessGoal}
Preferred foods: ${intake.foodsEnjoy || "no preferences listed"}
Foods to avoid: ${intake.foodsAvoid || "none"}
Allergies: ${intake.allergies || "none"}
Can cook: ${intake.canCook || "unknown"}
Typical meals: ${intake.dailyMealsDescription || "not provided"}

DAY: ${dayNumber} (${weekday})

DAILY TARGETS (hit these via portion sizes):
Calories: ${targets.calories} kcal  (max ${Math.round(targets.calories * 1.05)})
Protein:  ${targets.proteinG}g       (min ${Math.round(targets.proteinG * 0.93)}, max ${Math.round(targets.proteinG * 1.07)})
Carbs:    ${targets.carbsG}g
Fat:      ${targets.fatG}g           (max ${Math.round(targets.fatG * 1.10)} — DO NOT OVERSHOOT)

MEAL STRUCTURE (produce exactly these meals, in this order):
${mealSlotsBlock}${directivesBlock}${sodiumBlock}${commentsBlock}${retryBlock}

ALLOWED INGREDIENTS — DO NOT INVENT
(format: slug|name|category|macros per 100g${showSodium ? "|sodium mg" : ""})
Pick ONLY from these slugs. Do not pluralize, reorder tokens, or add/drop modifiers.
${ingredientList}

RESPOND WITH JSON ONLY. No markdown fences, no prose. Schema:
{
  "meals": [
    {
      "name": "Breakfast",
      "time": "7:30 AM",
      "dishName": "Tex-Mex Egg Scramble Bowl",
      "ingredients": [
        { "slug": "eggs_whole_cooked", "grams": 150 }
      ]
    }
  ]
}

The "name" field is fixed (from the meal structure above: Breakfast, Lunch, etc.).
The "dishName" field is a short (2-5 word) dish name you invent based on the ingredients.
Examples: "Tex-Mex Egg Scramble Bowl", "Lemon Herb Chicken & Rice", "Miso Salmon with Quinoa", "Peanut Butter Banana Oats".`;
}

const DAY_CALL_MAX_TOKENS = 1800; // slight bump for dishName + variety

export async function generateDay(
  input: DayGenerationInput,
  apiKey: string
): Promise<DayPlan> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: DAY_CALL_MAX_TOKENS,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`Day ${input.dayNumber}: no text response from Claude`);
  }
  const raw = textBlock.text;

  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  let parsed: {
    meals: {
      name: string;
      time: string;
      dishName?: string;
      ingredients: { slug: string; grams: number }[];
    }[];
  };
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      `Day ${input.dayNumber}: failed to parse Claude JSON: ${(err as Error).message} | raw: ${raw.slice(0, 300)}`
    );
  }

  if (!parsed.meals || !Array.isArray(parsed.meals)) {
    throw new Error(`Day ${input.dayNumber}: Claude response missing 'meals' array`);
  }

  return {
    day: input.dayNumber,
    meals: parsed.meals.map((m) => ({
      name: m.name,
      time: m.time,
      dishName: m.dishName,
      ingredients: (m.ingredients || []).map((i) => ({
        slug: i.slug,
        grams: Math.round(Number(i.grams) || 0),
      })),
    })),
  };
}

/**
 * Generate all 7 days in parallel. Returns array of DayPlan (ordered day 1..7).
 */
export async function generateAllDays(
  inputs: DayGenerationInput[],
  apiKey: string
): Promise<DayPlan[]> {
  const results = await Promise.all(inputs.map((inp) => generateDay(inp, apiKey)));
  results.sort((a, b) => a.day - b.day);
  return results;
}
