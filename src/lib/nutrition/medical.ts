/**
 * Medical conditions + medications handler.
 *
 * Detects flags from the intake form's allergies/medical and medications
 * free-text fields, then exposes:
 *  - Ingredient blocklist/soft-avoid lists to feed into the ingredient picker
 *  - Tips to inject into the PDF tips page
 *  - Caps on problematic ingredients (e.g., high-sodium items for HBP)
 */

import type { IngredientRow } from "./ingredient-filter";

export interface MedicalFlags {
  hasHypertension: boolean;
  onACEInhibitor: boolean;
  onStimulantADHD: boolean;
  onGLP1: boolean;
  onBloodThinner: boolean;
  onSGLT2: boolean;
  hasDiabetes: boolean;
  hasHighCholesterol: boolean;
  hasKidneyIssues: boolean;
  hasCeliacOrGluten: boolean;
  hasLactoseIntolerance: boolean;
  medicationsRaw: string;
  conditionsRaw: string;
}

/**
 * Extract medical flags from the intake free-text fields.
 * Matches on the allergies/medical field AND the medications field, because
 * clients often mention "High Blood pressure" in the allergies slot since
 * the form doesn't have a dedicated conditions field.
 */
export function detectMedicalFlags(
  allergiesMedical: string,
  medications: string
): MedicalFlags {
  const combined = `${allergiesMedical || ""} ${medications || ""}`.toLowerCase();

  const hypertensionTerms = [
    "high blood pressure", "hypertension", "hbp",
    "lisinopril", "losartan", "amlodipine", "hydrochlorothiazide", "hctz",
    "enalapril", "ramipril", "valsartan", "olmesartan", "benazepril",
    "metoprolol", "atenolol", "carvedilol", "bisoprolol",
  ];
  const aceInhibitors = [
    "lisinopril", "enalapril", "ramipril", "benazepril", "captopril",
    "quinapril", "fosinopril", "perindopril",
  ];
  const arbs = ["losartan", "valsartan", "olmesartan", "irbesartan", "telmisartan", "candesartan"];
  const stimulants = [
    "methylphenidate", "ritalin", "concerta", "focalin",
    "adderall", "vyvanse", "dexedrine", "dextroamphetamine", "lisdexamfetamine",
    "strattera", "atomoxetine",
  ];
  const glp1 = ["ozempic", "wegovy", "mounjaro", "zepbound", "rybelsus", "saxenda", "semaglutide", "tirzepatide", "liraglutide"];
  const diabetesTerms = ["diabetes", "type 1", "type 2", "t1d", "t2d", "insulin", "metformin", "pre-diabetes", "prediabetes"];
  const cholesterolTerms = ["high cholesterol", "hyperlipidemia", "statin", "atorvastatin", "rosuvastatin", "simvastatin", "crestor", "lipitor"];
  const kidneyTerms = ["kidney disease", "ckd", "renal", "dialysis", "kidney failure"];
  const celiacTerms = ["celiac", "coeliac", "gluten intolerance", "gluten free", "gluten-free", "gluten sensitivity"];
  const lactoseTerms = ["lactose intolerance", "lactose intolerant", "dairy free", "dairy-free", "lactose"];
  const bloodThinners = ["warfarin", "coumadin", "eliquis", "apixaban", "xarelto", "rivaroxaban", "pradaxa", "dabigatran"];
  const sglt2 = ["jardiance", "empagliflozin", "farxiga", "dapagliflozin", "invokana", "canagliflozin", "steglatro"];

  const hit = (terms: string[]) => terms.some((t) => combined.includes(t));

  return {
    hasHypertension: hit(hypertensionTerms),
    onACEInhibitor: hit(aceInhibitors) || hit(arbs),
    onStimulantADHD: hit(stimulants),
    onGLP1: hit(glp1),
    onBloodThinner: hit(bloodThinners),
    onSGLT2: hit(sglt2),
    hasDiabetes: hit(diabetesTerms),
    hasHighCholesterol: hit(cholesterolTerms),
    hasKidneyIssues: hit(kidneyTerms),
    hasCeliacOrGluten: hit(celiacTerms),
    hasLactoseIntolerance: hit(lactoseTerms),
    medicationsRaw: (medications || "").trim(),
    conditionsRaw: (allergiesMedical || "").trim(),
  };
}

/**
 * Given detected flags, return ingredient slug substrings (matched via
 * `ingredient-filter`'s normal keyword logic) that should be soft-avoided.
 * NOTE: these are ADVISORY — they reduce frequency rather than hard-block.
 * Hard allergies still go through parseBlockedFoods.
 */
export function medicalSoftAvoidTokens(flags: MedicalFlags): string[] {
  const tokens: string[] = [];
  if (flags.hasHypertension) {
    // High-sodium items — soft-avoid so they don't appear daily.
    // Hard-avoid only for the very worst (salted butter, bacon).
    tokens.push("bacon", "salami", "ham", "hot dog", "sausage", "pickle", "soy sauce");
  }
  if (flags.hasHighCholesterol) {
    tokens.push("butter_salted", "bacon", "sausage", "heavy_cream");
  }
  return tokens;
}

/**
 * Per-ingredient frequency caps across the 7-day plan for medical-sensitive items.
 * Keyed by slug-substring match; value = max day-appearances across the week.
 */
export function medicalIngredientCaps(flags: MedicalFlags): Record<string, number> {
  const caps: Record<string, number> = {};
  if (flags.hasHypertension) {
    // Cap appearances of the heaviest sodium contributors for hypertensive clients.
    // Mozzarella/parmesan dominated Brandon's plan (13+ appearances).
    caps["cheese_mozzarella"] = 3;
    caps["cheese_cheddar"] = 3;
    caps["cheese_parmesan"] = 2;
    caps["cheese_feta"] = 2;
    caps["marinara"] = 2;
    caps["soy_sauce"] = 2;
    caps["sourdough"] = 3;
    caps["tortilla_flour"] = 4;
    caps["ranch_dressing"] = 2;
    caps["italian_dressing"] = 2;
    caps["butter"] = 5; // allow unsalted variants more than this via alternate swap; salted should be hard-swapped
  }
  if (flags.hasHighCholesterol) {
    caps["butter"] = 3;
    caps["cheese"] = 3;
    caps["egg_yolk"] = 4;
  }
  return caps;
}

/**
 * Hard swaps applied AFTER plan generation. Maps source slug → target slug when
 * a condition makes the source a clear issue (e.g., salted butter on HBP).
 * Used by the route to rewrite ingredient slugs in-place before PDF render.
 */
export function medicalHardSwaps(flags: MedicalFlags, byslug: Map<string, IngredientRow>): Record<string, string> {
  const swaps: Record<string, string> = {};
  if (flags.hasHypertension) {
    // Swap salted butter → unsalted butter if it exists in the DB
    if (byslug.has("butter_salted") && byslug.has("butter_unsalted")) {
      swaps["butter_salted"] = "butter_unsalted";
    } else if (byslug.has("butter") && byslug.has("olive_oil")) {
      // Fall back to olive oil if no unsalted variant is in the DB
      // Note: only swap if fat-gram density is similar enough (>80 fat/100g both)
      const b = byslug.get("butter")!;
      const o = byslug.get("olive_oil")!;
      if (Number(b.fat_g_per_100g) > 70 && Number(o.fat_g_per_100g) > 70) {
        swaps["butter"] = "olive_oil";
      }
    }
  }
  return swaps;
}

/**
 * Build Tip objects to inject into the tips page based on detected flags.
 * Returns tips in recommended order; caller slots them into the tips array
 * just before the final "Be Consistent" entry.
 */
export interface MedicalTip {
  title: string;
  body: string;
}

export function medicalTips(flags: MedicalFlags): MedicalTip[] {
  const tips: MedicalTip[] = [];

  if (flags.hasHypertension) {
    tips.push({
      title: "Sodium Management (High Blood Pressure)",
      body:
        "With hypertension, keep sodium under 2,000 mg/day — ideally closer to 1,500 mg (American Heart Association). " +
        "Watch for hidden sodium in bread, cheese, deli meats, sauces (marinara, soy sauce, dressings), and canned goods. " +
        "Use unsalted butter and add salt only to the finished plate, never during cooking. Read the label on anything packaged.",
    });
  }

  if (flags.onACEInhibitor) {
    tips.push({
      title: "ACE Inhibitor / ARB Considerations",
      body:
        "Your medication can raise potassium levels. Your plan already includes high-potassium foods (banana, potato, salmon, avocado) " +
        "at normal portions, which is fine. Avoid potassium supplements and salt substitutes containing potassium chloride " +
        "(often labeled 'No Salt' or 'Nu-Salt') unless your doctor has specifically approved them. Have your potassium level checked " +
        "at your next bloodwork.",
    });
  }

  if (flags.hasDiabetes) {
    tips.push({
      title: "Blood Sugar Management",
      body:
        "Pair carbs with protein and fat at every meal — this blunts the blood sugar spike. Simple starches alone (plain rice, " +
        "bread, cereal) hit hardest; combine them with chicken, eggs, Greek yogurt, or nut butter. Check your glucose response " +
        "to higher-carb meals (breakfast oats, post-workout rice) and adjust portions if you see sharp peaks.",
    });
  }

  if (flags.hasHighCholesterol) {
    tips.push({
      title: "Cholesterol-Aware Eating",
      body:
        "Favor unsaturated fats (olive oil, avocado, salmon) over saturated (butter, cheese, fatty cuts of beef). " +
        "Soluble fiber from oats, beans, apples, and berries actively lowers LDL. Limit added butter and full-fat cheese " +
        "to a few appearances per week; use olive oil for cooking.",
    });
  }

  if (flags.hasKidneyIssues) {
    tips.push({
      title: "Kidney Health — Talk To Your Doctor",
      body:
        "This plan is built for general health and may not match the protein, potassium, phosphorus, or sodium restrictions " +
        "a renal dietitian would set. Please review this plan with your doctor or a renal RD before following it. Protein " +
        "at 1.0-2.2 g/kg may be too high depending on your kidney function stage.",
    });
  }

  if (flags.onGLP1) {
    tips.push({
      title: "GLP-1 Medication & Appetite",
      body:
        "Your medication suppresses appetite significantly. You may not feel hungry at mealtimes — eat anyway, in smaller " +
        "portions if needed, and prioritize protein (aim for at least 25-30g per meal) to protect muscle. Slow, gentle meals " +
        "reduce nausea. Hydration is especially important — under-hydration worsens side effects.",
    });
  }

  if (flags.onBloodThinner) {
    tips.push({
      title: "Blood Thinners & Vitamin K",
      body:
        "Your medication is affected by vitamin K, which is highest in leafy greens (kale, spinach, broccoli). You don't need " +
        "to avoid them — consistency matters more than quantity. Keep your weekly intake of greens roughly the same from week " +
        "to week. Sudden large increases or decreases can shift how your medication works. Tell your doctor before any big " +
        "dietary change.",
    });
  }

  if (flags.onSGLT2) {
    tips.push({
      title: "SGLT2 Inhibitors & Hydration",
      body:
        "Your medication increases fluid loss. Drink water consistently throughout the day — aim for 3 L minimum, more on " +
        "training days and in warm weather. Watch for signs of dehydration (dry mouth, dizziness, dark urine). Don't wait " +
        "until you're thirsty.",
    });
  }

  if (flags.hasCeliacOrGluten) {
    tips.push({
      title: "Gluten-Free Living",
      body:
        "Your plan excludes wheat, barley, rye, and common gluten sources. Safe substitutes are rice, quinoa, corn tortillas, " +
        "gluten-free bread, and certified gluten-free oats (regular oats are often cross-contaminated). Always read labels — " +
        "soy sauce, marinades, and processed meats frequently contain hidden gluten.",
    });
  }

  if (flags.hasLactoseIntolerance) {
    tips.push({
      title: "Dairy-Free Substitutes",
      body:
        "Your plan excludes dairy. Good substitutes: oat milk or almond milk (unless nut-allergic), coconut milk for richer " +
        "recipes, and nutritional yeast as a savory replacement for parmesan. Hard-aged cheeses and Greek yogurt are low in " +
        "lactose if your tolerance allows small amounts — discuss with your doctor.",
    });
  }

  return tips;
}
