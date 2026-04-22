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
  onMAOI: boolean;
  onStatin: boolean;
  onLithium: boolean;
  onLevothyroxine: boolean;
  onTetracycline: boolean;
  onBisphosphonate: boolean;
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
  const maois = ["phenelzine", "nardil", "tranylcypromine", "parnate", "isocarboxazid", "marplan", "selegiline", "emsam", "rasagiline", "azilect"];
  const statins = ["atorvastatin", "lipitor", "simvastatin", "zocor", "rosuvastatin", "crestor", "pravastatin", "pravachol", "lovastatin", "mevacor", "fluvastatin", "lescol", "pitavastatin", "livalo"];
  const lithium = ["lithium", "eskalith", "lithobid"];
  const levothyroxine = ["levothyroxine", "synthroid", "levoxyl", "tirosint", "unithroid"];
  const tetracyclines = ["tetracycline", "doxycycline", "minocycline", "demeclocycline"];
  const bisphosphonates = ["alendronate", "fosamax", "risedronate", "actonel", "ibandronate", "boniva", "zoledronic acid", "reclast"];

  const hit = (terms: string[]) => terms.some((t) => combined.includes(t));

  return {
    hasHypertension: hit(hypertensionTerms),
    onACEInhibitor: hit(aceInhibitors) || hit(arbs),
    onStimulantADHD: hit(stimulants),
    onGLP1: hit(glp1),
    onBloodThinner: hit(bloodThinners),
    onSGLT2: hit(sglt2),
    onMAOI: hit(maois),
    onStatin: hit(statins),
    onLithium: hit(lithium),
    onLevothyroxine: hit(levothyroxine),
    onTetracycline: hit(tetracyclines),
    onBisphosphonate: hit(bisphosphonates),
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
    tokens.push("bacon", "salami", "ham", "hot dog", "sausage", "pickle", "soy sauce");
  }
  if (flags.hasHighCholesterol) {
    tokens.push("butter_salted", "bacon", "sausage", "heavy_cream");
  }
  return tokens;
}

/**
 * HARD-avoid tokens (added to the allergy/avoid block list).
 * Unlike softAvoid, these items are excluded entirely.
 * Used for MAOI tyramine-rich foods and other safety-critical conflicts.
 */
export function medicalHardAvoidTokens(flags: MedicalFlags): string[] {
  const tokens: string[] = [];

  if (flags.onMAOI) {
    // Tyramine-rich foods — potentially FATAL interaction with MAOIs.
    // Strict zero-instance safety rule.
    tokens.push(
      // Aged cheeses by name
      "aged cheese", "parmesan", "cheddar", "aged cheddar", "blue cheese",
      "gorgonzola", "roquefort", "provolone", "swiss", "gruyere", "feta aged",
      // Cured and aged meats
      "bacon", "salami", "pepperoni", "prosciutto", "aged ham", "sausage",
      "soppressata", "chorizo",
      // Fermented foods
      "soy sauce", "miso", "tempeh", "tofu fermented", "kimchi", "sauerkraut",
      // Alcohol
      "draft beer", "red wine", "aged wine", "vermouth",
    );
  }

  if (flags.onStatin) {
    // Grapefruit and related citrus inhibit CYP3A4, driving statin levels
    // to potentially toxic concentrations. Zero-instance rule.
    tokens.push(
      "grapefruit", "grapefruit juice", "seville orange", "pomelo", "tangelo"
    );
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

  if (flags.onMAOI) {
    tips.push({
      title: "MAOI Medication & Tyramine — CRITICAL",
      body:
        "Your medication can have a FATAL interaction with tyramine-rich foods — a hypertensive crisis is a real risk. This plan " +
        "excludes all aged cheeses (parmesan, aged cheddar, blue cheese, gorgonzola, roquefort), cured/aged meats (salami, " +
        "prosciutto, pepperoni, soppressata, aged ham), fermented foods (soy sauce, miso, tempeh, kimchi, sauerkraut), draft beer, " +
        "aged/red wine, and vermouth. Also avoid overripe bananas, broad beans, and smoked/pickled fish. When eating out, tell your " +
        "server about your medication so they can flag aged-cheese dishes. This is the single most important dietary rule for you.",
    });
  }

  if (flags.onStatin) {
    tips.push({
      title: "Statins & Grapefruit",
      body:
        "Grapefruit, grapefruit juice, pomelo, tangelo, and Seville oranges interact with statins by inhibiting the enzyme that " +
        "clears them from your system — levels can rise to toxic concentrations. Your plan excludes these. Regular oranges, " +
        "lemons, limes, and other citrus are fine.",
    });
  }

  if (flags.onLithium) {
    tips.push({
      title: "Lithium & Sodium Consistency",
      body:
        "Lithium levels in the blood rise when you drop sodium intake sharply (and fall when sodium spikes). Try to keep daily " +
        "sodium roughly consistent — big swings can cause lithium toxicity or reduced effectiveness. Stay well-hydrated, and " +
        "tell your doctor before starting any low-sodium diet.",
    });
  }

  if (flags.onLevothyroxine) {
    tips.push({
      title: "Levothyroxine & Timing",
      body:
        "Take your medication on an empty stomach 30-60 minutes before breakfast with water only. Avoid soy products, high-calcium " +
        "foods, iron supplements, and coffee within 30 minutes of dosing — they reduce absorption by 20-40%. Be consistent with " +
        "timing day-to-day.",
    });
  }

  if (flags.onTetracycline) {
    tips.push({
      title: "Antibiotic & Dairy Timing",
      body:
        "Tetracycline-class antibiotics bind to calcium and iron, dramatically reducing absorption. Avoid dairy (milk, cheese, " +
        "yogurt), calcium supplements, iron supplements, and antacids within 2 hours of taking the medication. Fine outside that " +
        "window.",
    });
  }

  if (flags.onBisphosphonate) {
    tips.push({
      title: "Bisphosphonate Timing",
      body:
        "Take on an empty stomach with 6-8 oz of plain water first thing in the morning. Stay upright for at least 30 minutes " +
        "(60 for some versions). Avoid food, other medications, calcium, and mineral water during that window — absorption is " +
        "very sensitive.",
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
