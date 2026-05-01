/**
 * GET /api/nutrition/v2/client/:client_id/copy-prompt[?kcal=N]
 *
 * Assembles the full prompt the coach pastes into Claude.ai. Called once,
 * after the coach has locked the daily kcal target via the MacroTargetEditor.
 * The locked kcal value comes in via `?kcal=N`; if missing, falls back to
 * the auto-suggested value (calculator output - 400, floored at 1200).
 *
 * Sections (in order):
 *   1. Directive — what to build, what file format
 *   2. Optional reference PDFs — design templates the coach can attach
 *      to their Claude.ai chat for visual uniformity
 *   3. Inline design spec — explicit structural contract that produces
 *      a uniform plan even if the reference attachments aren't supplied
 *   4. Client profile — intake fields (allergies + medical_supervision
 *      surfaced prominently)
 *   5. Locked daily macro targets
 *   6. Output formatting rules — real-food language, banned terms,
 *      grocery list, variance disclosure
 *   7. Pre-submit self-check loop — Claude scans its own draft for
 *      avoid-list contamination + macro drift before emitting
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { parseMealCount } from "@/lib/nutrition/parsers";
import { loadIntakeAndComputeRawTargets } from "@/lib/nutrition/intake-targets";
import {
  adjustMacros,
  KCAL_DOWNWARD_ADJUSTMENT,
} from "@/lib/nutrition/macro-adjust";

export const runtime = "nodejs";
export const maxDuration = 10;

const REFERENCE_PDF_URLS = [
  {
    label: "Reference plan A — Gavin Moran",
    url: "https://bostjayrguulwaltnbgt.supabase.co/storage/v1/object/public/nutrition-plan-references/Gavin_Moran_7Day_Meal_Plan.pdf",
  },
  {
    label: "Reference plan B — Justin Reasoner",
    url: "https://bostjayrguulwaltnbgt.supabase.co/storage/v1/object/public/nutrition-plan-references/Justin_Reasoner_7Day_Meal_Plan.pdf",
  },
];

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ client_id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { client_id: rawId } = await ctx.params;
  const clientId = parseInt(rawId, 10);
  if (!Number.isFinite(clientId)) {
    return NextResponse.json({ error: "invalid client_id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const result = await loadIntakeAndComputeRawTargets(db, clientId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const i = result.intake;

  // Coach-locked kcal override comes in via ?kcal=N. Falls back to the
  // calc - 400 default when absent.
  const kcalRaw = req.nextUrl.searchParams.get("kcal");
  let overrideKcal: number | undefined;
  if (kcalRaw != null) {
    const parsed = parseInt(kcalRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 500 || parsed > 6000) {
      return NextResponse.json(
        { error: "kcal override must be an integer between 500 and 6000" },
        { status: 400 },
      );
    }
    overrideKcal = parsed;
  }

  const targets = adjustMacros(result.raw, { overrideKcal });
  const mealCountRaw = String(i.meal_count ?? "").trim();
  const mealCount = parseMealCount(mealCountRaw);

  // ============================================================
  // Prompt assembly
  // ============================================================
  const lines: string[] = [];

  // --- 1. Directive ---
  lines.push("# Meal plan request");
  lines.push("");
  lines.push(
    "Build a complete 7-day meal plan for the client described below and deliver it as a polished, printable document. The coach will save your output as a PDF and send it to the client. Honor every restriction (allergies, medical conditions, foods-to-avoid, meal-count preference). Use realistic gram portions on every ingredient. Show per-meal macros and per-day totals.",
  );
  lines.push("");

  // --- 2. Optional reference PDFs (Hybrid Option 3) ---
  lines.push("## Design references (recommended — attach if you can)");
  lines.push(
    "If your Claude plan supports file attachments, download the two reference plans below and attach them to this chat before submitting. They are real plans we've shipped — match their layout, typography hierarchy, and section flow. If you cannot attach files, the inline design spec below is sufficient.",
  );
  lines.push("");
  for (const ref of REFERENCE_PDF_URLS) {
    lines.push(`- ${ref.label}: ${ref.url}`);
  }
  lines.push("");

  // --- 3. Inline design spec (explicit structure contract) ---
  lines.push("## Required structure");
  lines.push("Produce the plan with these sections in this order:");
  lines.push("");
  lines.push(
    "1. **Cover** — client first name, age, current weight, height, fitness goal, generated date, daily macro targets (kcal / P / C / F).",
  );
  lines.push(
    "2. **Daily breakdown** — one section per day, Day 1 through Day 7. Each day shows every meal with: meal name, ingredients (with grams), per-meal macros (kcal / P / C / F), and a daily total at the bottom.",
  );
  lines.push(
    "3. **Aggregated grocery list** — a single list at the end covering all 7 days, sorted into categories: Proteins / Produce / Grains & Starches / Dairy / Fats & Oils / Pantry & Spices. Show total weight or count needed for the week.",
  );
  lines.push(
    "4. **Variance disclosure** — at the very end, state the daily kcal range across the 7 days (e.g. \"Daily kcal range: 2,420 – 2,510\") and confirm each macro stays within ±5% of the target. If any day falls outside ±5%, fix it before emitting.",
  );
  lines.push("");

  // --- 4. Client profile ---
  lines.push("## Client");
  if (i.first_name || i.last_name)
    lines.push(`- Name: ${[i.first_name, i.last_name].filter(Boolean).join(" ")}`);
  if (result.parsed.age) lines.push(`- Age: ${result.parsed.age}`);
  lines.push(`- Sex: ${result.parsed.sex}`);
  if (i.height) lines.push(`- Height: ${i.height}`);
  if (i.current_weight) lines.push(`- Current weight: ${i.current_weight}`);
  if (i.goal_weight) lines.push(`- Goal weight: ${i.goal_weight}`);
  if (i.fitness_goal) lines.push(`- Fitness goal: ${i.fitness_goal}`);
  if (i.activity_level) lines.push(`- Activity level: ${i.activity_level}`);
  if (i.foods_enjoy) lines.push(`- Foods enjoyed: ${i.foods_enjoy}`);
  if (i.foods_avoid)
    lines.push(`- Foods to AVOID (do not include any of these): ${i.foods_avoid}`);
  if (i.allergies)
    lines.push(`- ⚠ Allergies / medical conditions: ${i.allergies}`);
  if (i.medications) lines.push(`- Medications: ${i.medications}`);
  if (i.supplements) lines.push(`- Supplements: ${i.supplements}`);
  // Medical-supervision flag — safety-critical. Surface prominently when Yes.
  if (i.medical_supervision_yn) {
    const yn = String(i.medical_supervision_yn).trim();
    if (yn.toLowerCase() === "yes") {
      lines.push(
        `- ⚠ Under medical supervision: YES — client is on a prescribed diet from a healthcare provider`,
      );
      if (i.medical_supervision_detail) {
        lines.push(
          `- Provider-prescribed diet detail: ${i.medical_supervision_detail}`,
        );
      } else {
        lines.push(
          `- (Client did not provide detail — coach should follow up before delivery.)`,
        );
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

  // --- 5. Locked daily macro targets ---
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

  // --- 6. Language / formatting rules ---
  lines.push("## Language and formatting rules");
  lines.push(
    "- Use real food language. Name ingredients directly (\"chicken breast,\" \"sweet potato,\" \"olive oil\"). Do NOT use the words: low-carb, high-protein, macro-friendly, lean, clean, healthy, wellness, power, smart, light. Plain ingredient names only.",
  );
  lines.push(
    "- Every ingredient gets a gram weight. No \"to taste\" / \"a handful\" / \"a serving.\" Numbers in grams.",
  );
  lines.push(
    "- Per-meal macros and per-day totals are required. Show the math.",
  );
  lines.push(
    "- Output as a single, well-formatted document. Don't split across multiple chat messages.",
  );
  lines.push("");

  // --- 7. Pre-submit self-check loop ---
  lines.push("## Before you emit the plan — self-check");
  lines.push(
    "Scan your draft for these issues. If you find any, fix and emit only the corrected version (do not show drafts):",
  );
  lines.push(
    "1. **Avoid-list contamination** — any ingredient the client said to avoid (foods_avoid, allergies, medical-supervision restrictions) appears anywhere in the plan.",
  );
  lines.push(
    "2. **Macro drift** — any single day where kcal, protein, carbs, or fat drifts more than 10% from the target.",
  );
  lines.push(
    "3. **Banned words** — any of the forbidden words in section 6 sneaking into a meal name or description.",
  );
  lines.push(
    "4. **Missing structure** — any of the four required sections (cover / daily breakdown / grocery list / variance disclosure) absent.",
  );
  lines.push("");
  lines.push(
    "Once everything passes, emit the final plan. The coach will save it as a PDF and deliver to the client.",
  );

  const prompt = lines.join("\n");

  return NextResponse.json({
    client_id: clientId,
    client_name: result.clientName,
    prompt,
    targets: {
      calories: targets.calories,
      proteinG: targets.proteinG,
      carbsG: targets.carbsG,
      fatG: targets.fatG,
      sodiumCapMg: targets.sodiumCapMg,
      source: targets.source,
      rawCalculatorKcal: targets.rawCalculatorKcal,
      flooredAt1200: targets.flooredAt1200,
    },
    reference_pdfs: REFERENCE_PDF_URLS,
    meta: {
      character_count: prompt.length,
      meal_count_parsed: mealCount,
      kcal_adjustment_applied: KCAL_DOWNWARD_ADJUSTMENT,
    },
  });
}
