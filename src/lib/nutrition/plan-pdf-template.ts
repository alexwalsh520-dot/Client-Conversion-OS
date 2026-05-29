// Locked HTML/CSS shell for the auto-generated 7-day meal plan PDF.
//
// Design philosophy: the LLM produces ONLY the content (sections,
// meals, ingredients, narrative). The visual shell — typography,
// spacing, table styling, page margins, print rules — is locked here
// in CCOS code. This way the LLM can have a bad day without producing
// an off-brand or broken PDF.
//
// The CSS is hand-tuned to mirror the existing Jake Ryan / Justin
// Reasoner reference plans the coach attaches to Claude.ai today:
// white background, system sans-serif, restrained section dividers,
// numbers-forward macro tables, prose-style narrative blocks.
//
// Print sizing: US Letter (8.5" × 11"), 0.6" margins. Headless
// Chromium renders the HTML at this size and writes a real PDF.

/**
 * Wraps an LLM-produced HTML body in the locked outer shell.
 * The body is expected to be a fragment (no <html>/<head>/<body>
 * tags), composed of <section class="...">...</section> blocks
 * following the class contract documented in the auto-pipeline
 * prompt (see plan-prompt-auto.ts).
 */
export function wrapAsFullHtml(
  innerBodyHtml: string,
  clientFirstName: string,
): string {
  const safeTitle = clientFirstName.replace(/[<>&"']/g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${safeTitle} - 7 Day Meal Plan</title>
<style>${LOCKED_CSS}</style>
</head>
<body>
${innerBodyHtml}
</body>
</html>`;
}

/**
 * CSS lives as a string constant so it ships in the rendered HTML
 * (no external stylesheet → no network fetch during render → faster +
 * deterministic). All values explicit; no @import, no web fonts, no
 * remote assets. System font stack only.
 */
const LOCKED_CSS = `
/* ----- Page setup (print) ----- */
@page {
  size: letter;
  margin: 0.6in 0.55in;
}

/* ----- Reset + base ----- */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.55;
  color: #1c1c20;
  background: #ffffff;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* ----- Header (cover) ----- */
.cover {
  margin-bottom: 22pt;
}
.cover h1 {
  font-size: 22pt;
  font-weight: 700;
  margin: 0 0 4pt;
  letter-spacing: -0.02em;
  color: #0d0d12;
}
.cover .subtitle {
  font-size: 11pt;
  color: #5e5e68;
  margin: 0 0 16pt;
}

/* ----- Info table (Client, Goal, Meal structure, etc.) ----- */
.info-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 22pt;
}
.info-table tr {
  border-top: 1px solid #e5e5ea;
}
.info-table tr:last-child {
  border-bottom: 1px solid #e5e5ea;
}
.info-table th {
  text-align: left;
  font-weight: 600;
  color: #3a3a44;
  vertical-align: top;
  padding: 8pt 14pt 8pt 0;
  width: 28%;
  font-size: 10.5pt;
}
.info-table td {
  vertical-align: top;
  padding: 8pt 0;
  color: #1c1c20;
  font-size: 10.5pt;
}

/* ----- Section heading ----- */
section.plan-section {
  margin-top: 22pt;
  page-break-inside: avoid;
}
section.plan-section h2 {
  font-size: 14pt;
  font-weight: 700;
  margin: 0 0 10pt;
  color: #0d0d12;
  letter-spacing: -0.01em;
}
section.plan-section h3 {
  font-size: 12pt;
  font-weight: 700;
  margin: 14pt 0 6pt;
  color: #0d0d12;
}
section.plan-section p {
  margin: 0 0 8pt;
}

/* ----- Macro targets table ----- */
.macro-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 8pt;
}
.macro-table th,
.macro-table td {
  text-align: left;
  padding: 8pt 12pt 8pt 0;
  font-size: 10.5pt;
}
.macro-table th {
  font-weight: 600;
  color: #5e5e68;
  border-bottom: 1px solid #d8d8de;
  text-transform: uppercase;
  font-size: 9pt;
  letter-spacing: 0.04em;
}
.macro-table td {
  font-weight: 600;
  color: #0d0d12;
  font-size: 13pt;
}

/* ----- Day breakdown ----- */
.day-block {
  margin-bottom: 16pt;
  page-break-inside: avoid;
}
.day-block h3 {
  margin: 0 0 8pt;
  font-size: 12pt;
  font-weight: 700;
  color: #0d0d12;
  border-bottom: 1.5px solid #0d0d12;
  padding-bottom: 4pt;
}
.meal-block {
  margin: 8pt 0 12pt;
  padding-left: 0;
}
.meal-block h4 {
  margin: 0 0 4pt;
  font-size: 11pt;
  font-weight: 700;
  color: #1c1c20;
}
.meal-block ul.ingredients {
  list-style: none;
  margin: 0 0 6pt;
  padding: 0;
}
.meal-block ul.ingredients li {
  padding: 1pt 0;
  font-size: 10.5pt;
  color: #1c1c20;
}
.meal-block .meal-macros {
  font-size: 9.5pt;
  color: #5e5e68;
  margin-top: 4pt;
  font-style: italic;
}
.daily-total {
  margin-top: 10pt;
  padding: 8pt 10pt;
  background: #f5f5f7;
  border-radius: 4pt;
  font-size: 10pt;
  font-weight: 600;
  color: #0d0d12;
}

/* ----- Grocery list ----- */
.grocery-categories {
  display: block;
}
.grocery-category {
  margin-bottom: 10pt;
  page-break-inside: avoid;
}
.grocery-category h4 {
  font-size: 11pt;
  font-weight: 700;
  margin: 0 0 4pt;
  color: #1c1c20;
}
.grocery-category ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.grocery-category li {
  font-size: 10.5pt;
  padding: 1pt 0;
}

/* ----- Substitutions ----- */
.substitutions ul {
  list-style: disc;
  margin: 0 0 8pt 16pt;
  padding: 0;
}
.substitutions li {
  margin-bottom: 4pt;
  font-size: 10.5pt;
}

/* ----- Variance / footer ----- */
.variance {
  margin-top: 18pt;
  padding-top: 10pt;
  border-top: 1px solid #d8d8de;
  font-size: 9.5pt;
  color: #5e5e68;
}

/* ----- Generic helpers used by the LLM output ----- */
strong { font-weight: 700; color: #0d0d12; }
em { font-style: italic; }
ul { padding-left: 18pt; margin: 0 0 8pt; }
ol { padding-left: 18pt; margin: 0 0 8pt; }
li { margin-bottom: 2pt; }

/* Page break hints for the LLM output */
.page-break-before { page-break-before: always; }
.page-break-after { page-break-after: always; }
`;

/**
 * Sample fully-composed body HTML used for renderer smoke-testing.
 * Mirrors the structure the LLM is asked to produce in plan-prompt-auto.ts.
 * Lets us verify the CSS renders correctly without burning an LLM call.
 *
 * Edit this when iterating on the visual design — DO NOT use it as the
 * actual content source for shipped plans.
 */
export function buildSampleBodyForTesting(): string {
  return `
<div class="cover">
  <h1>7-Day Meal Plan · Jake Ryan</h1>
  <p class="subtitle">Bulk for muscle gain · 4 meals/day</p>

  <table class="info-table">
    <tr><th>Client</th><td>Jake Ryan · Age 25 · 6'3", 200 lb</td></tr>
    <tr><th>Goal</th><td>Reach 215 lb by adding muscle. Body fat is not a major concern, but the surplus stays modest so the gains come on as muscle.</td></tr>
    <tr><th>Meal structure</th><td>4 meals/day · Breakfast ~7:00 AM · Lunch ~12:00 PM (packable for work) · Afternoon snack ~3:30 PM · Dinner ~7:00 PM</td></tr>
    <tr><th>Supplements / Meds</th><td>None</td></tr>
    <tr><th>Avoiding</th><td>Heavy condiments and sauces (ketchup, mayo, mustard, BBQ, ranch). Alfredo and salty sauces (tamari, soy) are fine.</td></tr>
    <tr><th>Sleep / Hydration</th><td>7 hrs · ~64 oz water now (push toward 100 oz to support the bulk)</td></tr>
    <tr><th>Generated</th><td>May 25, 2026 · Coach: Shaun, CCOS Nutrition</td></tr>
  </table>
</div>

<section class="plan-section">
  <h2>Daily macro targets</h2>
  <table class="macro-table">
    <tr>
      <th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Sodium (cap)</th>
    </tr>
    <tr>
      <td>2900 kcal</td><td>200 g</td><td>388 g</td><td>61 g</td><td>≤ 2300 mg</td>
    </tr>
  </table>
</section>

<section class="plan-section">
  <h2>Strategy & Approach</h2>
  <p>2900 cals, 200g protein, 388g carbs, 61g fat. That's the target, and it's a small surplus, a bit more than you burn, because the goal is to add muscle and bring you up to 215 lb. The coach set the calories just above the basic suggestion on purpose, only about 85 cals over, which makes this a slow bulk, not a dirty one.</p>
  <p>The plan is built straight from the foods you said you love. Bacon and eggs are on the menu most mornings, just with the portion dialed in so the sodium stays in line. Seafood is a major feature: salmon, shrimp, scallops, tuna, and cod each show up across the week.</p>
</section>

<section class="plan-section">
  <h2>Daily breakdown</h2>

  <div class="day-block">
    <h3>Day 1 — Monday</h3>

    <div class="meal-block">
      <h4>Breakfast · ~7:00 AM</h4>
      <ul class="ingredients">
        <li>Eggs, 3 large (150 g)</li>
        <li>Bacon, 3 strips cooked (24 g)</li>
        <li>Toasted sourdough bread, 2 slices (80 g)</li>
        <li>Butter, 8 g</li>
      </ul>
      <p class="meal-macros">~720 kcal · 36 g P · 70 g C · 32 g F</p>
    </div>

    <div class="meal-block">
      <h4>Lunch · ~12:00 PM (packable)</h4>
      <ul class="ingredients">
        <li>Grilled chicken breast, 180 g</li>
        <li>White rice, cooked, 220 g</li>
        <li>Steamed broccoli, 150 g</li>
        <li>Olive oil, 8 g</li>
      </ul>
      <p class="meal-macros">~640 kcal · 52 g P · 70 g C · 14 g F</p>
    </div>

    <div class="meal-block">
      <h4>Afternoon snack · ~3:30 PM</h4>
      <ul class="ingredients">
        <li>Greek yogurt, plain 5%, 200 g</li>
        <li>Banana, 1 medium (120 g)</li>
        <li>Almonds, 20 g</li>
      </ul>
      <p class="meal-macros">~410 kcal · 22 g P · 38 g C · 17 g F</p>
    </div>

    <div class="meal-block">
      <h4>Dinner · ~7:00 PM</h4>
      <ul class="ingredients">
        <li>Salmon fillet, 200 g</li>
        <li>Pasta (penne), cooked, 200 g</li>
        <li>Alfredo sauce (light), 60 g</li>
        <li>Side salad with olive oil, 100 g greens + 5 g oil</li>
      </ul>
      <p class="meal-macros">~1130 kcal · 90 g P · 210 g C · 0 g F (extra fat folded into the sauce)</p>
    </div>

    <div class="daily-total">Day 1 total — 2900 kcal · 200 g P · 388 g C · 61 g F</div>
  </div>

  <div class="day-block">
    <h3>Day 2 — Tuesday</h3>
    <div class="meal-block">
      <h4>Breakfast · ~7:00 AM</h4>
      <ul class="ingredients"><li>(Sample day, abbreviated for testing — real LLM output fills this in)</li></ul>
    </div>
  </div>
</section>

<section class="plan-section">
  <h2>Aggregated grocery list</h2>
  <div class="grocery-categories">
    <div class="grocery-category">
      <h4>Proteins</h4>
      <ul>
        <li>Chicken breast — 1.4 kg</li>
        <li>Salmon fillets — 900 g</li>
        <li>Bacon — 200 g</li>
      </ul>
    </div>
    <div class="grocery-category">
      <h4>Produce</h4>
      <ul>
        <li>Broccoli — 1 kg</li>
        <li>Bananas — 7 medium</li>
      </ul>
    </div>
  </div>
</section>

<section class="plan-section substitutions">
  <h2>Practical substitutions</h2>
  <ul>
    <li>If you're tired of chicken on Day 4 lunch, swap to ground turkey at the same weight.</li>
    <li>If you can't find Greek yogurt, use cottage cheese, same protein.</li>
  </ul>
</section>

<section class="plan-section variance">
  <h2>Variance</h2>
  <p>Daily kcal range: 2,870 to 2,930. Every macro stays within plus or minus 5 percent of target.</p>
</section>
`;
}
