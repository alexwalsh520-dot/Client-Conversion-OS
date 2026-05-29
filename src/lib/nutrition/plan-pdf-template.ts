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
// detailed per-meal ingredient tables (kcal/P/C/F columns), daily
// total comparison strips, multi-section Practical Execution and
// Practical Substitutions narratives, 7-day categorized shopping list,
// per-day variance disclosure table.
//
// Print sizing: US Letter (8.5" × 11"), 0.55"/0.6" margins. Headless
// Chromium renders the HTML at this size + adds a footer with page
// numbers via puppeteer's displayHeaderFooter.

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
 * Footer HTML template passed to puppeteer's `page.pdf` via
 * `footerTemplate`. Chromium swaps `<span class="pageNumber">` and
 * `<span class="totalPages">` for the current values.
 *
 * IMPORTANT: the footer template runs OUTSIDE the main page's CSS,
 * so styles must be inline. Default font is huge; explicit 9pt.
 */
export function buildFooterTemplate(clientFullName: string): string {
  const safeName = escapeForFooter(clientFullName);
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 9pt; color: #5e5e68; width: 100%; padding: 0 0.55in; display: flex; justify-content: space-between; -webkit-print-color-adjust: exact;">
  <span>${safeName} &nbsp;|&nbsp; 7-Day Meal Plan</span>
  <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;
}

function escapeForFooter(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === "&" ? "&amp;" :
    c === '"' ? "&quot;" : "&#39;",
  );
}

/**
 * CSS lives as a string constant so it ships in the rendered HTML.
 * No @import, no web fonts, no remote assets. System font stack only.
 */
const LOCKED_CSS = `
/* ----- Page setup (print) ----- */
@page {
  size: letter;
  /* Bottom margin reserves space for the puppeteer-injected footer */
  margin: 0.55in 0.55in 0.7in 0.55in;
}

/* ----- Reset + base ----- */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.5;
  color: #1c1c20;
  background: #ffffff;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* ----- Cover header ----- */
.cover { margin-bottom: 18pt; }
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

/* ----- Info table (Client/Goal/Meal structure/etc.) ----- */
.info-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20pt;
}
.info-table tr { border-top: 1px solid #e5e5ea; }
.info-table tr:last-child { border-bottom: 1px solid #e5e5ea; }
.info-table th {
  text-align: left;
  font-weight: 600;
  color: #3a3a44;
  vertical-align: top;
  padding: 8pt 14pt 8pt 0;
  width: 26%;
  font-size: 10.5pt;
}
.info-table td {
  vertical-align: top;
  padding: 8pt 0;
  color: #1c1c20;
  font-size: 10.5pt;
  line-height: 1.55;
}

/* ----- Section ----- */
section.plan-section {
  margin-top: 18pt;
  page-break-inside: auto;
}
section.plan-section.page-break {
  page-break-before: always;
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
section.plan-section h4 {
  font-size: 10.5pt;
  font-weight: 700;
  margin: 8pt 0 4pt;
  color: #1c1c20;
}
section.plan-section p { margin: 0 0 8pt; }
section.plan-section p:last-child { margin-bottom: 0; }

/* ----- Daily macro targets table (top of doc) ----- */
.macro-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 4pt;
  border: 1px solid #d8d8de;
}
.macro-table th,
.macro-table td {
  text-align: left;
  padding: 8pt 12pt;
  font-size: 10.5pt;
}
.macro-table th {
  font-weight: 600;
  color: #3a3a44;
  background: #f5f5f7;
  text-transform: uppercase;
  font-size: 9pt;
  letter-spacing: 0.04em;
  border-bottom: 1px solid #d8d8de;
}
.macro-table td {
  font-weight: 600;
  color: #0d0d12;
  font-size: 12pt;
}

/* ----- Day block ----- */
.day-block {
  margin-top: 14pt;
  margin-bottom: 14pt;
  page-break-inside: avoid;
}
.day-block .day-header {
  border-bottom: 1.5px solid #0d0d12;
  padding-bottom: 4pt;
  margin-bottom: 8pt;
}
.day-block .day-header h3 {
  margin: 0;
  font-size: 12pt;
  font-weight: 700;
  color: #0d0d12;
}
.day-block .day-header .day-theme {
  font-style: italic;
  color: #5e5e68;
  font-size: 10.5pt;
  margin-top: 2pt;
}

/* Daily-totals strip just under the day header */
.daily-totals-strip {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 10pt;
  font-size: 9.5pt;
}
.daily-totals-strip th,
.daily-totals-strip td {
  text-align: left;
  padding: 5pt 10pt 5pt 0;
}
.daily-totals-strip th {
  font-weight: 600;
  color: #5e5e68;
  text-transform: uppercase;
  font-size: 8.5pt;
  letter-spacing: 0.04em;
}
.daily-totals-strip td {
  color: #1c1c20;
  font-weight: 600;
}

/* Per-meal block within a day */
.meal-block {
  margin: 8pt 0 12pt;
  page-break-inside: avoid;
}
.meal-block h4 {
  margin: 0 0 4pt;
  font-size: 10.5pt;
  font-weight: 700;
  color: #1c1c20;
}

/* Per-meal ingredient table (6 cols: Ingredient | Amount | kcal | P | C | F) */
table.ingredients-table {
  width: 100%;
  border-collapse: collapse;
  margin: 4pt 0 0;
  font-size: 9.5pt;
}
table.ingredients-table th {
  text-align: left;
  font-weight: 600;
  color: #5e5e68;
  background: #fafafc;
  border-bottom: 1px solid #d8d8de;
  padding: 5pt 8pt;
  font-size: 8.5pt;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
table.ingredients-table td {
  padding: 4pt 8pt;
  border-bottom: 1px solid #f0f0f3;
  color: #1c1c20;
}
table.ingredients-table tr.meal-subtotal td {
  font-weight: 700;
  background: #f5f5f7;
  border-top: 1px solid #d8d8de;
  border-bottom: 1px solid #d8d8de;
  padding: 6pt 8pt;
}
/* Right-align numeric columns (2nd onward) */
table.ingredients-table th:not(:first-child),
table.ingredients-table td:not(:first-child) {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ----- Lifestyle notes block ----- */
.lifestyle-notes h3 {
  margin-top: 12pt;
}

/* ----- Practical Execution / Substitutions ----- */
.execution h3,
.substitutions h3 {
  margin-top: 12pt;
}
.substitutions .sub-q {
  font-weight: 700;
  color: #0d0d12;
  margin-top: 10pt;
}
.substitutions .sub-a {
  margin: 2pt 0 8pt;
  padding-left: 12pt;
}

/* ----- 7-day shopping list ----- */
.shopping-list .category-block {
  margin-bottom: 14pt;
  page-break-inside: avoid;
}
.shopping-list h3 {
  margin-top: 12pt;
}
.shopping-list h4 {
  font-size: 11pt;
  font-weight: 700;
  margin: 10pt 0 4pt;
  color: #0d0d12;
}
table.shopping-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9.5pt;
}
table.shopping-table th {
  text-align: left;
  font-weight: 600;
  color: #5e5e68;
  background: #fafafc;
  border-bottom: 1px solid #d8d8de;
  padding: 5pt 8pt;
  font-size: 8.5pt;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
table.shopping-table td {
  padding: 4pt 8pt;
  border-bottom: 1px solid #f0f0f3;
}
table.shopping-table td:nth-child(2),
table.shopping-table th:nth-child(2) {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  width: 18%;
}
table.shopping-table td:nth-child(3),
table.shopping-table th:nth-child(3) {
  color: #5e5e68;
  width: 35%;
}

/* ----- Variance disclosure table ----- */
table.variance-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9.5pt;
  margin-bottom: 10pt;
}
table.variance-table th {
  text-align: left;
  font-weight: 600;
  color: #5e5e68;
  background: #fafafc;
  border-bottom: 1px solid #d8d8de;
  padding: 5pt 8pt;
  font-size: 8.5pt;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
table.variance-table td {
  padding: 5pt 8pt;
  border-bottom: 1px solid #f0f0f3;
  font-variant-numeric: tabular-nums;
}
table.variance-table th:not(:first-child),
table.variance-table td:not(:first-child) {
  text-align: right;
  white-space: nowrap;
}
table.variance-table tr.target-row td {
  font-weight: 700;
  background: #f5f5f7;
  border-top: 1px solid #d8d8de;
}

/* ----- Trailing attribution / plan-id footer ----- */
.plan-attribution {
  margin-top: 22pt;
  padding-top: 10pt;
  border-top: 1px solid #d8d8de;
  font-size: 9pt;
  color: #5e5e68;
}

/* Generic helpers */
strong { font-weight: 700; color: #0d0d12; }
em { font-style: italic; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
li { margin-bottom: 2pt; }

/* Page break hints for the LLM */
.page-break-before { page-break-before: always; }
.page-break-after { page-break-after: always; }
.avoid-break { page-break-inside: avoid; }
`;

// ---------------------------------------------------------------------------
// Sample body for renderer testing
// ---------------------------------------------------------------------------

/**
 * Comprehensive sample body for renderer smoke-testing. Mirrors the
 * full Jake Ryan structure: cover, info table, macros, strategy &
 * approach, lifestyle notes, full 7 days with ingredient tables,
 * practical execution sections, practical substitutions, shopping
 * list, variance disclosure, attribution footer.
 *
 * NOT used for shipped plans — that content comes from the LLM. This
 * exists so we can preview the template without burning an LLM call.
 */
export function buildSampleBodyForTesting(): string {
  return [
    SAMPLE_COVER,
    SAMPLE_MACROS,
    SAMPLE_STRATEGY,
    SAMPLE_LIFESTYLE,
    SAMPLE_DAILY_BREAKDOWN,
    SAMPLE_EXECUTION,
    SAMPLE_SUBSTITUTIONS,
    SAMPLE_SHOPPING_LIST,
    SAMPLE_VARIANCE,
    SAMPLE_ATTRIBUTION,
  ].join("\n");
}

const SAMPLE_COVER = `
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
</div>`;

const SAMPLE_MACROS = `
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
</section>`;

const SAMPLE_STRATEGY = `
<section class="plan-section">
  <h2>Strategy & Approach</h2>
  <p>2900 cals, 200g protein, 388g carbs, 61g fat. That's the target, and it's a small surplus, a bit more than you burn, because the goal is to add muscle and bring you up to 215 lb. The coach set the calories just above the basic suggestion on purpose, only about 85 cals over, which makes this a slow bulk, not a dirty one.</p>
  <p>The plan is built straight from the foods you said you love. Bacon and eggs are on the menu most mornings, just with the portion dialed in so the sodium stays in line. Seafood is a major feature: salmon, shrimp, scallops, tuna, and cod each show up across the week. Italian and pasta nights are anchored by spaghetti with meat sauce and garlic bread, fettuccine Alfredo with shrimp, and chicken Alfredo.</p>
  <p>The four meals are built to fix the biggest gap in your current pattern. You said you often skip dinner and sometimes default to two PB and honey sandwiches, which on a bulk is actually leaving a ton of calories on the table.</p>
</section>`;

const SAMPLE_LIFESTYLE = `
<section class="plan-section lifestyle-notes">
  <h2>Lifestyle Notes</h2>
  <h3>Hydration</h3>
  <p>You're at about half a gallon (64 oz) a day, which is decent, but on a bulk like this it needs to come up. The target is 100 oz over the next couple of weeks, building one bottle at a time. The high protein also puts your kidneys to work, so good water keeps everything running.</p>
  <h3>Sleep</h3>
  <p>7 hours is a solid number, hold it where it is. Sleep matters a lot on a bulk because the actual muscle growth happens overnight, not in the gym. Good sleep also keeps your hunger and energy steady, which is important when you're trying to put away 2900 calories most days.</p>
</section>`;

const SAMPLE_DAILY_BREAKDOWN = `
<section class="plan-section">
  <h2>Daily Breakdown</h2>
  <p>Each day below starts with a daily-total comparison strip so you can see how the day adds up against your targets. Every meal then lists ingredients with gram weights, per-ingredient macros, and a subtotal. Cooked weights are listed for all meats, seafood, pasta, and rice.</p>

  ${[1,2,3,4,5,6,7].map((n) => sampleDayBlock(n)).join("\n")}
</section>`;

function sampleDayBlock(dayNum: number): string {
  const dayName = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][dayNum - 1];
  const theme = ["Spaghetti night","Salmon and rice","Shrimp Alfredo night","Steak and pasta","Scallops and pasta","Salmon and rice","Chicken pasta night"][dayNum - 1];
  return `
<div class="day-block">
  <div class="day-header">
    <h3>Day ${dayNum}, ${dayName}</h3>
    <div class="day-theme">${theme}</div>
  </div>
  <table class="daily-totals-strip">
    <tr><th></th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th></tr>
    <tr><td>Daily total</td><td>2891</td><td>199 g</td><td>379 g</td><td>61.7 g</td></tr>
    <tr><td>vs. target</td><td>2900</td><td>200 g</td><td>388 g</td><td>61 g</td></tr>
  </table>

  <div class="meal-block">
    <h4>Breakfast (~7:00 AM): Bacon, Eggs, and Sourdough Toast</h4>
    <table class="ingredients-table">
      <thead><tr><th>Ingredient</th><th>Amount</th><th>kcal</th><th>P (g)</th><th>C (g)</th><th>F (g)</th></tr></thead>
      <tbody>
        <tr><td>Whole eggs</td><td>120 g</td><td>172</td><td>15.1</td><td>0.8</td><td>11.4</td></tr>
        <tr><td>Bacon, cooked</td><td>18 g</td><td>97</td><td>6.7</td><td>0.3</td><td>7.6</td></tr>
        <tr><td>Sourdough bread</td><td>90 g</td><td>234</td><td>8.1</td><td>45.0</td><td>1.4</td></tr>
        <tr><td>Unsalted butter</td><td>6 g</td><td>43</td><td>0.1</td><td>0.0</td><td>4.9</td></tr>
        <tr><td>Banana</td><td>100 g</td><td>89</td><td>1.1</td><td>22.8</td><td>0.3</td></tr>
        <tr><td>Skim milk</td><td>250 g</td><td>85</td><td>8.5</td><td>12.2</td><td>0.2</td></tr>
        <tr class="meal-subtotal"><td>Meal subtotal</td><td></td><td>720</td><td>39.5</td><td>81.1</td><td>25.7</td></tr>
      </tbody>
    </table>
  </div>

  <div class="meal-block">
    <h4>Lunch (~12:00 PM, packable for work): Chicken and Rice with Vegetables</h4>
    <table class="ingredients-table">
      <thead><tr><th>Ingredient</th><th>Amount</th><th>kcal</th><th>P (g)</th><th>C (g)</th><th>F (g)</th></tr></thead>
      <tbody>
        <tr><td>Chicken breast, cooked</td><td>170 g</td><td>280</td><td>52.7</td><td>0.0</td><td>6.1</td></tr>
        <tr><td>White rice, cooked</td><td>340 g</td><td>442</td><td>9.2</td><td>95.2</td><td>1.0</td></tr>
        <tr><td>Broccoli, cooked</td><td>150 g</td><td>52</td><td>3.6</td><td>10.8</td><td>0.6</td></tr>
        <tr><td>Olive oil</td><td>2 g</td><td>18</td><td>0.0</td><td>0.0</td><td>2.0</td></tr>
        <tr><td>Tamari (salty sauce)</td><td>4 g</td><td>2</td><td>0.4</td><td>0.2</td><td>0.0</td></tr>
        <tr class="meal-subtotal"><td>Meal subtotal</td><td></td><td>794</td><td>65.9</td><td>106.2</td><td>9.7</td></tr>
      </tbody>
    </table>
  </div>

  <div class="meal-block">
    <h4>Afternoon Snack (~3:30 PM): Greek Yogurt Bowl with Berries and Pretzels</h4>
    <table class="ingredients-table">
      <thead><tr><th>Ingredient</th><th>Amount</th><th>kcal</th><th>P (g)</th><th>C (g)</th><th>F (g)</th></tr></thead>
      <tbody>
        <tr><td>Greek yogurt (nonfat)</td><td>250 g</td><td>148</td><td>25.5</td><td>9.0</td><td>1.0</td></tr>
        <tr><td>Mixed berries</td><td>100 g</td><td>50</td><td>0.8</td><td>12.0</td><td>0.3</td></tr>
        <tr><td>Honey</td><td>22 g</td><td>67</td><td>0.1</td><td>18.1</td><td>0.0</td></tr>
        <tr><td>Pretzels</td><td>20 g</td><td>76</td><td>1.8</td><td>16.0</td><td>0.6</td></tr>
        <tr><td>Almonds</td><td>8 g</td><td>46</td><td>1.7</td><td>1.7</td><td>4.0</td></tr>
        <tr class="meal-subtotal"><td>Meal subtotal</td><td></td><td>387</td><td>29.9</td><td>56.9</td><td>5.9</td></tr>
      </tbody>
    </table>
  </div>

  <div class="meal-block">
    <h4>Dinner (~7:00 PM): Spaghetti with Meat Sauce and Garlic Bread</h4>
    <table class="ingredients-table">
      <thead><tr><th>Ingredient</th><th>Amount</th><th>kcal</th><th>P (g)</th><th>C (g)</th><th>F (g)</th></tr></thead>
      <tbody>
        <tr><td>Spaghetti, cooked</td><td>340 g</td><td>537</td><td>19.7</td><td>104.4</td><td>3.4</td></tr>
        <tr><td>Ground beef (93/7), cooked</td><td>135 g</td><td>235</td><td>35.1</td><td>0.0</td><td>9.5</td></tr>
        <tr><td>Marinara sauce</td><td>60 g</td><td>32</td><td>1.0</td><td>5.4</td><td>0.8</td></tr>
        <tr><td>Parmesan cheese</td><td>4 g</td><td>17</td><td>1.5</td><td>0.2</td><td>1.1</td></tr>
        <tr><td>Garlic bread (butter spread)</td><td>40 g</td><td>140</td><td>3.4</td><td>20.0</td><td>5.2</td></tr>
        <tr><td>Spinach, cooked</td><td>80 g</td><td>18</td><td>2.4</td><td>3.0</td><td>0.2</td></tr>
        <tr class="meal-subtotal"><td>Meal subtotal</td><td></td><td>989</td><td>63.5</td><td>135.0</td><td>20.3</td></tr>
      </tbody>
    </table>
  </div>
</div>`;
}

const SAMPLE_EXECUTION = `
<section class="plan-section execution page-break">
  <h2>Practical Execution</h2>

  <h3>Hitting 200g of protein</h3>
  <p>200g a day, a gram per pound, is the number that turns the calorie surplus into actual muscle. It's spread across all four meals at about 50g each. Eggs and bacon cover breakfast, your packable lunch has 150 to 200g of chicken, fish, or shrimp, the afternoon snack pulls 20 to 30g from yogurt or cottage cheese, and dinner is the big anchor with another 30 to 50g from your pasta dish, salmon, or scallops. Weigh your meats and seafood cooked, not raw.</p>

  <h3>Hitting 388g of carbs</h3>
  <p>388g is the big number on this plan, much higher than what most people see, and it's where the bulk lives. On a high-carb plan like this you're going to be eating pasta, rice, bread, oats, and potatoes in real portions. That's not a mistake, it's the design: the carbs fuel your training, support recovery, and supply the calories you need to put muscle on.</p>

  <h3>Managing the bacon</h3>
  <p>Bacon is in the plan because you love it, but it's the biggest single sodium hit you'll have most days, around 250 to 300mg per 15g cooked. On most days the plan lands you at 3 to 4 strips, not the 5 you mentioned, because at 5 strips the bacon alone is eating about half your daily sodium and leaves no room for anything salty later.</p>

  <h3>Your packable work lunch</h3>
  <p>You said you eat lunch at work, so every lunch is built to pack in a container the night before. Chicken or fish with rice and vegetables is the format. Pack the protein and the carb in one container and the vegetables in another so the veg stays crisp.</p>

  <h3>Cook once, eat all week</h3>
  <p>Since you cook already, batching makes the bulk easy to hit. A session or two a week sets you up: cook a big batch of chicken breast, brown ground beef, cook a pot of rice and another of pasta, and bake a couple of potatoes. All of it holds 4 to 5 days in the fridge.</p>
</section>`;

const SAMPLE_SUBSTITUTIONS = `
<section class="plan-section substitutions">
  <h2>Practical Substitutions</h2>
  <p>Swaps so you can flex without rewriting the plan. Same-weight protein swaps stay macro-equivalent. Stay close to the gram weight listed.</p>

  <div class="sub-q">Tired of the protein at a meal?</div>
  <div class="sub-a">Chicken breast, chicken thigh, 93/7 ground beef, sirloin steak, salmon, shrimp, cod, tilapia, scallops, canned tuna, and eggs all swap one-for-one at the same cooked weight and stay close on macros. Greek yogurt and cottage cheese cover breakfast and snacks.</div>

  <div class="sub-q">Want a different carb?</div>
  <div class="sub-a">Pasta, white or jasmine rice, brown rice, sourdough or white bread, bagels, English muffins, oats, baked potato, and sweet potato all swap in around the same cooked weight for similar carbs. Weigh rice and pasta cooked, since they gain a lot of weight from the dry state.</div>

  <div class="sub-q">Want a different vegetable?</div>
  <div class="sub-a">Broccoli, asparagus, green beans, spinach, bell peppers, zucchini, mushrooms, carrots, and onions all swap one-for-one by weight. They're low calorie and high volume, so pile them on when you want a bigger plate without changing your macros much.</div>

  <div class="sub-q">Condiments and sauces?</div>
  <div class="sub-a">Per your list: no ketchup, mayo, mustard, BBQ sauce, ranch, sriracha, or other thick sweet sauces. Exceptions: Alfredo, tamari and lower-sodium soy, thin vinaigrettes, marinara. Lemon juice, hot pepper, and herbs go a long way on the seafood.</div>
</section>`;

const SAMPLE_SHOPPING_LIST = `
<section class="plan-section shopping-list page-break">
  <h2>7-Day Shopping List</h2>
  <p>Total grams across all 7 days. Buy slightly more than listed to account for trim, packaging, and small portion variation.</p>

  <div class="category-block">
    <h4>Proteins</h4>
    <table class="shopping-table">
      <thead><tr><th>Item</th><th>Total (7 days)</th><th>Notes</th></tr></thead>
      <tbody>
        <tr><td>Whole eggs</td><td>840 g</td><td>about 17 large eggs</td></tr>
        <tr><td>Chicken breast, cooked</td><td>770 g</td><td>~1000g raw</td></tr>
        <tr><td>Shrimp, cooked</td><td>330 g</td><td>~430g raw</td></tr>
        <tr><td>Salmon, cooked</td><td>240 g</td><td>~310g raw</td></tr>
        <tr><td>Bacon, cooked</td><td>77 g</td><td>~155g raw</td></tr>
      </tbody>
    </table>
  </div>

  <div class="category-block">
    <h4>Dairy</h4>
    <table class="shopping-table">
      <thead><tr><th>Item</th><th>Total (7 days)</th><th>Notes</th></tr></thead>
      <tbody>
        <tr><td>Skim milk</td><td>2650 g</td><td></td></tr>
        <tr><td>Greek yogurt (nonfat)</td><td>650 g</td><td></td></tr>
        <tr><td>Cottage cheese (low-fat)</td><td>300 g</td><td></td></tr>
        <tr><td>Protein powder</td><td>75 g</td><td></td></tr>
      </tbody>
    </table>
  </div>

  <div class="category-block">
    <h4>Grains & Starches</h4>
    <table class="shopping-table">
      <thead><tr><th>Item</th><th>Total (7 days)</th><th>Notes</th></tr></thead>
      <tbody>
        <tr><td>Jasmine rice, cooked</td><td>1840 g</td><td>~605g dry</td></tr>
        <tr><td>Pasta, cooked</td><td>1130 g</td><td>~510g dry</td></tr>
        <tr><td>Whole wheat bread</td><td>300 g</td><td>about 9 slices</td></tr>
      </tbody>
    </table>
  </div>

  <div class="category-block">
    <h4>Vegetables</h4>
    <table class="shopping-table">
      <thead><tr><th>Item</th><th>Total (7 days)</th><th>Notes</th></tr></thead>
      <tbody>
        <tr><td>Broccoli, cooked</td><td>530 g</td><td></td></tr>
        <tr><td>Spinach, cooked</td><td>290 g</td><td></td></tr>
        <tr><td>Asparagus, cooked</td><td>250 g</td><td></td></tr>
      </tbody>
    </table>
  </div>
</section>`;

const SAMPLE_VARIANCE = `
<section class="plan-section">
  <h2>Variance Disclosure</h2>
  <table class="variance-table">
    <thead><tr><th>Day</th><th>kcal</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Max drift</th></tr></thead>
    <tbody>
      <tr><td>Day 1</td><td>2891 (-0.3%)</td><td>198.8 g (-0.6%)</td><td>379.2 g (-2.3%)</td><td>61.7 g (+1.1%)</td><td>2.3%</td></tr>
      <tr><td>Day 2</td><td>2859 (-1.4%)</td><td>197.8 g (-1.1%)</td><td>380.9 g (-1.8%)</td><td>59.6 g (-2.3%)</td><td>2.3%</td></tr>
      <tr><td>Day 3</td><td>2873 (-0.9%)</td><td>207.3 g (+3.6%)</td><td>379.9 g (-2.1%)</td><td>61.0 g (+0.0%)</td><td>3.6%</td></tr>
      <tr><td>Day 4</td><td>2862 (-1.3%)</td><td>201.2 g (+0.6%)</td><td>376.5 g (-3.0%)</td><td>60.2 g (-1.2%)</td><td>3.0%</td></tr>
      <tr><td>Day 5</td><td>2917 (+0.6%)</td><td>199.9 g (-0.0%)</td><td>387.8 g (-0.1%)</td><td>61.6 g (+1.0%)</td><td>1.0%</td></tr>
      <tr><td>Day 6</td><td>2977 (+2.7%)</td><td>197.6 g (-1.2%)</td><td>402.0 g (+3.6%)</td><td>63.5 g (+4.1%)</td><td>4.1%</td></tr>
      <tr><td>Day 7</td><td>2871 (-1.0%)</td><td>198.4 g (-0.8%)</td><td>377.6 g (-2.7%)</td><td>61.1 g (+0.2%)</td><td>2.7%</td></tr>
      <tr class="target-row"><td>Target</td><td>2900</td><td>200 g</td><td>388 g</td><td>61 g</td><td>+/- 5%</td></tr>
    </tbody>
  </table>
  <p>Daily calorie range across the week: 2859 to 2977 kcal. Every day stays within plus or minus 5 percent of every macro target. Maximum single-macro drift on any day is 4.1%.</p>
</section>`;

const SAMPLE_ATTRIBUTION = `
<div class="plan-attribution">
  Plan generated for Jake Ryan. Macros calculated from USDA reference values; individual product labels may vary by 5 to 10 percent. Plan ID: JR-20260525-001. Coach: Shaun, CCOS Nutrition. Generated May 25, 2026.
</div>`;
