// Prompt builder for the auto meal-plan pipeline.
//
// Mirrors src/app/api/nutrition/v2/client/[client_id]/copy-prompt/route.ts
// in structure (same client profile, same intake fields, same macro
// targets, same onboarding notes, same section list) but differs in
// two ways:
//
//   1. Output instruction: the LLM must produce HTML matching the
//      locked CCOS template's class contract, NOT a free-form
//      printable document. The template wraps the output server-side
//      and Chromium renders to PDF.
//
//   2. Reference PDFs are attached to the API call as document blocks
//      (not linked as URLs the user is supposed to drag in). Drops
//      the "if your Claude plan supports file attachments" branch.
//
// Coach handling: looks up the client's coach via the alias map
// (Farrukh → Mark, Shiraad → Shaun) so the printed PDF reads with
// the on-plan name the coaches use with clients. Drops the manual
// "Sex: M/F" guess MAS does today — sex doesn't affect output once
// macros are locked upstream.

import type { IntakeTargetsResult } from "./intake-targets";
import type { AdjustedTargets } from "./macro-adjust";
import { KCAL_DOWNWARD_ADJUSTMENT } from "./macro-adjust";
import { coachAlias } from "./coach-resolver";

/**
 * Reference plan URLs already in CCOS Supabase storage. These are
 * publicly readable in the `nutrition-plan-references` bucket and are
 * attached to the Anthropic API call as document source blocks. Same
 * URLs the manual copy-prompt currently lists for the coach to drag
 * into Claude.ai.
 */
export const REFERENCE_PLAN_URLS = [
  "https://bostjayrguulwaltnbgt.supabase.co/storage/v1/object/public/nutrition-plan-references/Gavin_Moran_7Day_Meal_Plan.pdf",
  "https://bostjayrguulwaltnbgt.supabase.co/storage/v1/object/public/nutrition-plan-references/Justin_Reasoner_7Day_Meal_Plan.pdf",
];

interface BuildPromptArgs {
  /** Already-gathered intake + parsed client data. */
  intake: Extract<IntakeTargetsResult, { ok: true }>;
  /** Already-adjusted macro targets (post override / floor). */
  targets: AdjustedTargets;
  /** Coach's INTERNAL CCOS name (alias swap happens here). May be null. */
  coachInternalName: string | null;
  /** Today's date (PKT) as "Mon DD, YYYY" — printed on the PDF cover. */
  generatedDateLabel: string;
}

export function buildAutoPlanPrompt(args: BuildPromptArgs): string {
  const { intake, targets, coachInternalName, generatedDateLabel } = args;
  const i = intake.intake;
  const onPlanCoach = coachAlias(coachInternalName);

  // Parse meal count if present (e.g. "4 (Bigger meals)" → 4)
  const mealCountRaw = String(i.meal_count ?? "");
  const mealCountMatch = mealCountRaw.match(/(\d+)/);
  const mealCount = mealCountMatch ? parseInt(mealCountMatch[1], 10) : null;

  const firstName =
    String(i.first_name ?? "").trim() ||
    (intake.clientName ?? "").trim().split(/\s+/)[0] ||
    "Client";
  const fullName =
    [i.first_name, i.last_name].filter(Boolean).join(" ").trim() ||
    intake.clientName ||
    "Client";

  const lines: string[] = [];

  // ---- Directive ----
  lines.push(
    "Build a complete 7-day meal plan for the client described below. Output the plan as raw HTML following the EXACT structure documented in the OUTPUT SECTION at the end of this prompt. Honor every restriction (allergies, medical conditions, foods-to-avoid, meal-count preference). Use realistic gram portions on every ingredient. Show per-meal macros and per-day totals.",
  );
  lines.push("");
  lines.push(
    "Two reference plans are attached to this message as PDFs. They are real plans we've shipped — match their content depth, narrative tone, and section flow. Do NOT match their styling (styling is applied by the CCOS template, not by you).",
  );
  lines.push("");

  // ---- Required sections (same as manual copy-prompt) ----
  lines.push("## Required sections (in this order)");
  lines.push("");
  lines.push("### Tone");
  lines.push(
    "Write client-facing — second person (\"your meals,\" \"you'll have\"). Encouraging but not preachy. Plain ingredient names, no coach-jargon addressed to a third party.",
  );
  lines.push("");
  lines.push("### Sections");
  lines.push(
    "1. **Cover** (mandatory) — client first name, age, current weight, height, fitness goal, generated date, daily macro targets table.",
  );
  lines.push(
    "2. **Strategy & Approach** (mandatory) — two or three paragraphs explaining: (a) why these specific macros for this client given their goal and bodyweight; (b) why this meal-count and meal-timing structure works around their existing schedule; (c) the overall game-plan in plain language.",
  );
  lines.push(
    "3. **Lifestyle Notes** (conditional) — include sub-sections for each that applies:",
  );
  lines.push(
    "   - Medication: only if client listed medications. Call out anything that affects appetite/timing.",
  );
  lines.push(
    "   - Hydration: only if water intake is reported. Quote their current intake and set a target.",
  );
  lines.push(
    "   - Sleep: only if sleep hours are reported. Tie it to plan execution.",
  );
  lines.push(
    "   - Sodium strategy: only if hypertension, kidney issues, diuretics, or stimulants.",
  );
  lines.push(
    "4. **Daily Breakdown** (mandatory) — one block per day, Day 1 through Day 7. Each day shows: a daily-totals comparison strip (Calories/Protein/Carbs/Fat actual vs target), then every meal with its name, time, ingredients table (Ingredient | Amount | kcal | P (g) | C (g) | F (g)), and a meal subtotal row.",
  );
  lines.push(
    "5. **Practical Execution** (mandatory) — 6 to 10 short sub-sections (single h3 + paragraph each) covering: hitting protein target, hitting carbs target, managing high-sodium foods if applicable, packable lunch logistics if work-eater, rebuilding skipped meals if relevant, batch cooking, tracking progress, when the plan gets boring. Adapt the headings to this specific client's situation.",
  );
  lines.push(
    "6. **Practical Substitutions** (mandatory) — 6 to 9 question-and-answer pairs giving the client swap options: Tired of the protein at a meal? Want a different carb? Want a different vegetable? Snack swap? Dinner style swap? Condiments and sauces? Bigger or smaller meal? Cooking tips? Flavor adds? Honor their foods-to-avoid in the suggestions.",
  );
  lines.push(
    "7. **7-Day Shopping List** (mandatory) — categorized totals across all 7 days. Categories: Proteins, Dairy, Grains & Starches, Fruit, Vegetables, Fats Nuts & Pantry. Each item: name, total grams, optional notes (e.g. raw-weight equivalent).",
  );
  lines.push(
    "8. **Variance Disclosure** (mandatory) — per-day table showing each macro's drift from target as a percentage, plus a max-drift column. End with a final row showing the target. Every day must stay within plus or minus 5 percent of every macro target; if a day falls outside, FIX the plan before emitting.",
  );
  lines.push("");

  // ---- Client profile ----
  lines.push("## Client");
  lines.push(`- Name: ${fullName}`);
  if (intake.parsed.age) lines.push(`- Age: ${intake.parsed.age}`);
  if (i.height) lines.push(`- Height: ${i.height}`);
  if (i.current_weight) lines.push(`- Current weight: ${i.current_weight}`);
  if (i.goal_weight) lines.push(`- Goal weight: ${i.goal_weight}`);
  if (i.fitness_goal) lines.push(`- Fitness goal: ${i.fitness_goal}`);
  if (i.activity_level) lines.push(`- Activity level: ${i.activity_level}`);
  if (i.foods_enjoy) lines.push(`- Foods enjoyed: ${i.foods_enjoy}`);
  if (i.foods_avoid)
    lines.push(`- Foods to AVOID (do not include any of these): ${i.foods_avoid}`);
  if (i.allergies) lines.push(`- ⚠ Allergies / medical conditions: ${i.allergies}`);
  if (i.medications) lines.push(`- Medications: ${i.medications}`);
  if (i.supplements) lines.push(`- Supplements: ${i.supplements}`);
  if (i.medical_supervision_yn) {
    const yn = String(i.medical_supervision_yn).trim();
    if (yn.toLowerCase() === "yes") {
      lines.push(
        "- ⚠ Under medical supervision: YES — client is on a prescribed diet from a healthcare provider",
      );
      if (i.medical_supervision_detail) {
        lines.push(`- Provider-prescribed diet detail: ${i.medical_supervision_detail}`);
      }
    } else {
      lines.push(`- Under medical supervision: ${yn || "no"}`);
    }
  }
  if (i.protein_preferences)
    lines.push(`- Protein preferences: ${i.protein_preferences}`);
  if (mealCountRaw) {
    const mealNote = mealCount
      ? ` (parsed as ${mealCount} meals/day — split the day's macros across this many meals)`
      : "";
    lines.push(`- Preferred meal count: ${mealCountRaw}${mealNote}`);
  }
  if (i.can_cook) lines.push(`- Cooking ability: ${i.can_cook}`);
  if (i.daily_meals_description)
    lines.push(`- Typical daily meals: ${i.daily_meals_description}`);
  if (i.daily_meals_description_2)
    lines.push(`- Daily meals (cont.): ${i.daily_meals_description_2}`);
  if (i.water_intake) lines.push(`- Water intake: ${i.water_intake}`);
  if (i.sleep_hours) lines.push(`- Sleep hours: ${i.sleep_hours}`);
  lines.push("");

  // ---- Coach onboarding notes ----
  if (intake.onboardingNotes && intake.onboardingNotes.trim().length > 0) {
    lines.push("## Coach onboarding notes");
    lines.push(intake.onboardingNotes.trim());
    lines.push("");
  }

  // ---- Macro targets ----
  lines.push("## Daily macro targets");
  lines.push(`- kcal: **${targets.calories}**`);
  lines.push(`- Protein: **${targets.proteinG} g**`);
  lines.push(`- Carbs: **${targets.carbsG} g**`);
  lines.push(`- Fat: **${targets.fatG} g**`);
  lines.push(`- Sodium cap: ≤ ${targets.sodiumCapMg} mg/day`);
  if (targets.source === "auto") {
    lines.push(
      `- (kcal target reflects a ${KCAL_DOWNWARD_ADJUSTMENT}-kcal downward adjustment from the calculator's TDEE-based output of ${targets.rawCalculatorKcal} — calibrated for our population.)`,
    );
  } else {
    lines.push(
      `- (kcal target was set by the coach. Calculator's auto-suggestion would have been ${Math.max(1200, targets.rawCalculatorKcal - KCAL_DOWNWARD_ADJUSTMENT)}.)`,
    );
  }
  if (targets.notes && targets.notes.length > 0) {
    lines.push(`- Notes: ${targets.notes.join("; ")}`);
  }
  lines.push("");

  // ---- Language + formatting rules ----
  lines.push("## Language and formatting rules");
  lines.push(
    "- Use real food language. Name ingredients directly. Do NOT use the words: low-carb, high-protein, macro-friendly, lean, clean, healthy, wellness, power, smart, light.",
  );
  lines.push(
    "- Every ingredient gets a gram weight. No \"to taste\" / \"a handful\" / \"a serving.\" Numbers in grams.",
  );
  lines.push(
    "- Per-meal macros and per-day totals are required. Show the math.",
  );
  lines.push(
    "- NEVER use em-dashes (—, U+2014) or en-dashes (–, U+2013) anywhere in your output. Use commas, periods, parentheses, or restructure.",
  );
  lines.push(
    "- Every day must stay within plus or minus 5 percent of every macro target (kcal, protein, carbs, fat). If any day falls outside, fix the plan before emitting.",
  );
  lines.push("");

  // ---- Output contract (HTML structure) ----
  lines.push("## OUTPUT: HTML structure (strict)");
  lines.push("");
  lines.push(
    "Output ONLY the HTML body fragment described below — no <html>, <head>, <body>, no <style>, no <script>, no markdown code fences, no preamble, no commentary. The CCOS server wraps your output in a locked CSS shell before rendering to PDF. The class names below are load-bearing — match them exactly.",
  );
  lines.push("");
  lines.push(htmlTemplateContract({
    clientFirstName: firstName,
    onPlanCoach,
    generatedDateLabel,
    targets,
  }));
  lines.push("");
  lines.push(
    `Replace the placeholders with the client's real data. Fill in all 7 days of meals with realistic ingredients and per-meal macros. The Strategy & Approach, Lifestyle Notes, Practical Execution, Practical Substitutions sections should contain real prose tailored to this client.`,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// HTML output contract — the skeleton the LLM must follow
// ---------------------------------------------------------------------------

function htmlTemplateContract(args: {
  clientFirstName: string;
  onPlanCoach: string;
  generatedDateLabel: string;
  targets: AdjustedTargets;
}): string {
  const { clientFirstName, onPlanCoach, generatedDateLabel, targets } = args;
  return `
\`\`\`
<!-- COVER PAGE: dark background, editorial serif. The class structure
     below is load-bearing — do not change class names or nesting. -->
<div class="cover">
  <div class="cover-top">
    <div class="brand">CCOS Nutrition</div>
    <div class="meta">
      <div>Generated ${generatedDateLabel}</div>
      <div>Coach: ${onPlanCoach}</div>
    </div>
  </div>

  <div class="cover-headline">
    <div class="eyebrow">Personalized Nutrition Protocol</div>
    <h1>7-Day<br/><span class="accent">Meal Plan</span></h1>
    <div class="cover-subtitle">[Goal phrase] · [N] meals/day · [One-line plan ethos, e.g. "Anchored in foods you already love."]</div>
  </div>

  <div class="client-strip">
    <div class="client-name">${clientFirstName} [LAST NAME]</div>
    <div class="client-meta">
      <span class="label">Age</span><span class="val">[N]</span>
      <span class="label">Ht</span><span class="val">[H]</span>
      <span class="label">Wt</span><span class="val">[W] lbs</span>
    </div>
  </div>

  <div class="kpi-strip">
    <div class="kpi"><div class="label">Calories</div><div class="val accent">${targets.calories}<span class="unit"></span></div></div>
    <div class="kpi"><div class="label">Protein</div><div class="val">${targets.proteinG}<span class="unit">g</span></div></div>
    <div class="kpi"><div class="label">Carbs</div><div class="val">${targets.carbsG}<span class="unit">g</span></div></div>
    <div class="kpi"><div class="label">Fat</div><div class="val">${targets.fatG}<span class="unit">g</span></div></div>
    <div class="kpi"><div class="label">Sodium cap</div><div class="val">${targets.sodiumCapMg}<span class="unit">mg</span></div></div>
  </div>

  <div class="cover-footer">
    <span>[2-4 word plan descriptor, e.g. "Slow bulk · ~0.5 lb/week"]</span>
    <span>Prepared exclusively for ${clientFirstName} [LAST NAME]</span>
  </div>
</div>

<!-- DAILY MACRO TARGETS - second page, light cream background -->
<section class="plan-section">
  <div class="section-eyebrow">Daily macro targets</div>
  <table class="macro-table">
    <tr><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Sodium (cap)</th></tr>
    <tr><td>${targets.calories} kcal</td><td>${targets.proteinG} g</td><td>${targets.carbsG} g</td><td>${targets.fatG} g</td><td>≤ ${targets.sodiumCapMg} mg</td></tr>
  </table>
</section>

<!-- STRATEGY (use section-eyebrow + large h2 headline + 2-3 paragraphs) -->
<section class="plan-section">
  <div class="section-eyebrow">Strategy & Approach</div>
  <h2>[Headline phrase about the plan and why it works]</h2>
  <p>[Paragraph 1]</p>
  <p>[Paragraph 2]</p>
  <p>[Optional paragraph 3]</p>
</section>

<!-- LIFESTYLE NOTES (conditional — include only sub-sections that apply) -->
<section class="plan-section lifestyle-notes">
  <div class="section-eyebrow">Lifestyle Notes</div>
  <h2>[Headline phrase like "Habits that make the plan work"]</h2>
  <h3>Hydration</h3>
  <p>[Paragraph]</p>
  <h3>Sleep</h3>
  <p>[Paragraph]</p>
</section>

<!-- DAILY BREAKDOWN with redesigned day-header structure -->
<section class="plan-section">
  <div class="section-eyebrow">Daily Breakdown</div>
  <h2>Seven days, in detail</h2>
  <p>[1 paragraph intro: weighing convention, what each day shows.]</p>

  <!-- Repeat the day-block 7 times -->
  <div class="day-block">
    <div class="day-header">
      <h3><span class="day-num">1</span></h3>
      <div>
        <span class="day-of-week">Monday</span>
        <span class="day-theme">[Short day theme e.g. "Spaghetti night"]</span>
      </div>
    </div>
    <table class="daily-totals-strip">
      <tr><th></th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th></tr>
      <tr><td>Daily total</td><td>[N]</td><td>[N] g</td><td>[N] g</td><td>[N] g</td></tr>
      <tr><td>vs. target</td><td>${targets.calories}</td><td>${targets.proteinG} g</td><td>${targets.carbsG} g</td><td>${targets.fatG} g</td></tr>
    </table>

    <!-- One meal-block per meal, in time order -->
    <div class="meal-block">
      <h4>Breakfast (~7:00 AM): [Meal Name]</h4>
      <table class="ingredients-table">
        <thead><tr><th>Ingredient</th><th>Amount</th><th>kcal</th><th>P (g)</th><th>C (g)</th><th>F (g)</th></tr></thead>
        <tbody>
          <tr><td>[Ingredient]</td><td>[N] g</td><td>[N]</td><td>[N]</td><td>[N]</td><td>[N]</td></tr>
          <tr class="meal-subtotal"><td>Meal subtotal</td><td></td><td>[N]</td><td>[N]</td><td>[N]</td><td>[N]</td></tr>
        </tbody>
      </table>
    </div>
    <!-- repeat meal-block for each meal -->
  </div>
  <!-- repeat day-block for Day 2-7 -->
</section>

<!-- PRACTICAL EXECUTION (forced page break before this section via CSS) -->
<section class="plan-section execution">
  <div class="section-eyebrow">Practical Execution</div>
  <h2>Making it work in real life</h2>
  <h3>[Sub-section title 1]</h3>
  <p>[Paragraph]</p>
  <h3>[Sub-section title 2]</h3>
  <p>[Paragraph]</p>
  <!-- repeat 5-10 times -->
</section>

<!-- PRACTICAL SUBSTITUTIONS -->
<section class="plan-section substitutions">
  <div class="section-eyebrow">Practical Substitutions</div>
  <h2>Swaps so you can flex</h2>
  <p>[1 line intro: same-weight swaps stay macro-equivalent, etc.]</p>
  <div class="sub-q">[Question]</div>
  <div class="sub-a">[Answer]</div>
  <!-- repeat 5-8 times -->
</section>

<!-- SHOPPING LIST (forced page break via CSS) -->
<section class="plan-section shopping-list">
  <div class="section-eyebrow">7-Day Shopping List</div>
  <h2>Everything, in one trip</h2>
  <p>[1 line intro about total grams across all 7 days.]</p>
  <div class="category-block">
    <h4>Proteins</h4>
    <table class="shopping-table">
      <tbody>
        <tr><td>[Item]</td><td>[N] g</td><td>[Optional raw weight note]</td></tr>
      </tbody>
    </table>
  </div>
  <!-- repeat category-block for Dairy, Grains & Starches, Fruit, Vegetables, Fats Nuts & Pantry -->
</section>

<!-- VARIANCE -->
<section class="plan-section">
  <div class="section-eyebrow">Variance Disclosure</div>
  <h2>How honest the math is</h2>
  <table class="variance-table">
    <thead><tr><th>Day</th><th>kcal</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Max drift</th></tr></thead>
    <tbody>
      <tr><td>Day 1</td><td>[N] ([+/-N%])</td><td>[N] g ([+/-N%])</td><td>[N] g ([+/-N%])</td><td>[N] g ([+/-N%])</td><td>[N%]</td></tr>
      <!-- repeat for Day 2-7 -->
      <tr class="target-row"><td>Target</td><td>${targets.calories}</td><td>${targets.proteinG} g</td><td>${targets.carbsG} g</td><td>${targets.fatG} g</td><td>+/- 5%</td></tr>
    </tbody>
  </table>
  <p>[1-2 lines summarizing range + max drift.]</p>
</section>

<div class="plan-attribution">
  Plan generated for ${clientFirstName} [LAST NAME]. Macros calculated from USDA reference values; individual product labels may vary by 5 to 10 percent. Coach: ${onPlanCoach}, CCOS Nutrition. Generated ${generatedDateLabel}.
</div>
\`\`\``;
}
