// Locked HTML/CSS shell for the auto-generated 7-day meal plan PDF.
//
// Design philosophy: the LLM produces ONLY the content. The visual
// shell — typography, spacing, table styling, colors, page rules —
// is locked here in CCOS code. This way the LLM can have a bad day
// without producing an off-brand or broken PDF.
//
// Design language (v2, post-redesign):
//   - Cover page: very dark green-black background, lime-green accent,
//     editorial serif headline, KPI strip at the bottom.
//   - Interior pages: warm cream background, dark ink, same lime-green
//     accent used sparingly for section eyebrows and subtle dividers.
//   - Typography: Georgia (system serif) for headlines, system sans
//     for body and tables. Headlines lean large and tight to evoke
//     editorial / magazine layouts.
//
// Print sizing: US Letter (8.5" × 11"). The @page rule sets zero
// margin so the cover page can bleed dark to the edges; per-page
// padding is handled inside the .cover / .page-content containers
// instead.

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
 * so styles must be inline. Hidden on the first page (the cover)
 * via the `.page1` rule which Chromium auto-applies.
 */
export function buildFooterTemplate(clientFullName: string): string {
  const safeName = escapeForFooter(clientFullName);
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 9pt; color: #8a857a; width: 100%; padding: 0 0.55in; display: flex; justify-content: space-between; -webkit-print-color-adjust: exact;">
  <span>${safeName}</span>
  <span>7-Day Meal Plan &nbsp;·&nbsp; Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
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
 * No @import, no remote fonts, no remote assets — system stacks only.
 *
 * Colors (locked design tokens):
 *   --cream     #faf7f0   warm off-white background for interior pages
 *   --ink       #1a1a1c   primary dark text on cream
 *   --muted     #8a857a   secondary text / page footer
 *   --rule      #e6e0d2   subtle horizontal rules + table borders
 *   --dark      #0d1310   near-black green for cover background
 *   --light     #f5f3ec   light text on dark backgrounds
 *   --accent    #c8e64a   lime green accent used for section
 *                          eyebrows and the highlighted "Meal Plan" word
 *   --accent-d  #94b428   darker green for body accents on cream
 */
const LOCKED_CSS = `
/* ----- Page setup -----
   Interior pages need real bottom margin so the Puppeteer-injected
   footer (page number + client name) has somewhere to render without
   overlapping body content. @page :first removes margin only for the
   cover page so its dark background can bleed to all four edges. */
@page {
  size: letter;
  margin: 0.7in 0.6in 0.85in 0.6in;
}
@page :first {
  margin: 0;
}

/* ----- Reset + base ----- */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.55;
  color: #1a1a1c;
  background: #faf7f0;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* ----- Cover page (.cover) -----
   Fills the full first page with a dark background that bleeds to the
   sheet edge. @page :first { margin: 0 } above makes the bleed
   possible; this element fills the page with its own padding. */
.cover {
  background: #0d1310;
  color: #f5f3ec;
  min-height: 11in;
  width: 8.5in;
  padding: 0.75in 0.75in 0.6in;
  position: relative;
  page-break-after: always;
  display: flex;
  flex-direction: column;
}
.cover .cover-top {
  display: flex;
  justify-content: space-between;
  font-size: 9.5pt;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8a8f7e;
  margin-bottom: 0;
}
.cover .cover-top .brand {
  color: #c8e64a;
  font-weight: 600;
  letter-spacing: 0.18em;
}
.cover .cover-top .meta {
  text-align: right;
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 9pt;
  color: #b8b3a4;
}
.cover .cover-top .meta div { line-height: 1.5; }

/* Push the title block down a third of the page so the eyebrow has
   room to breathe and the KPI strip sits at the bottom. */
.cover .cover-headline {
  margin-top: 1.4in;
  flex: 1;
}
.cover .cover-headline .eyebrow {
  font-size: 9.5pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #8a8f7e;
  margin-bottom: 18pt;
  padding-bottom: 14pt;
  border-bottom: 1px solid #2a2e26;
}
.cover h1 {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 68pt;
  line-height: 0.95;
  font-weight: 400;
  margin: 0 0 8pt;
  letter-spacing: -0.02em;
  color: #f5f3ec;
}
.cover h1 .accent {
  color: #c8e64a;
  font-style: italic;
}
.cover .cover-subtitle {
  font-size: 11.5pt;
  color: #b8b3a4;
  margin: 28pt 0 0;
  font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif;
  letter-spacing: 0.01em;
}

/* Client identity strip just above the KPI grid */
.cover .client-strip {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 60pt 0 28pt;
  padding-bottom: 14pt;
  font-family: Georgia, "Times New Roman", serif;
}
.cover .client-strip .client-name {
  font-size: 18pt;
  color: #f5f3ec;
  font-weight: 400;
}
.cover .client-strip .client-meta {
  font-size: 10pt;
  color: #b8b3a4;
  font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.cover .client-strip .client-meta .label {
  color: #8a8f7e;
  margin-right: 4pt;
}
.cover .client-strip .client-meta .val {
  color: #f5f3ec;
  font-weight: 600;
  margin-right: 18pt;
  letter-spacing: 0.02em;
  text-transform: none;
  font-size: 10.5pt;
}

/* KPI strip (calories / protein / carbs / fat / sodium cap) at the
   bottom of the cover. Built from the LLM's .info-table values plus
   the macro-table — the LLM is asked in the prompt template to
   structure these exact classes inside .cover. */
.cover .kpi-strip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0;
  margin-top: auto;
  padding-top: 16pt;
  border-top: 1px solid #2a2e26;
}
.cover .kpi-strip .kpi {
  padding: 0 16pt;
  border-right: 1px solid #2a2e26;
}
.cover .kpi-strip .kpi:first-child { padding-left: 0; }
.cover .kpi-strip .kpi:last-child { border-right: none; padding-right: 0; }
.cover .kpi-strip .kpi .label {
  font-size: 8.5pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8a8f7e;
  margin-bottom: 8pt;
}
.cover .kpi-strip .kpi .val {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 28pt;
  font-weight: 400;
  color: #f5f3ec;
  line-height: 1;
}
.cover .kpi-strip .kpi .val.accent { color: #c8e64a; }
.cover .kpi-strip .kpi .val .unit {
  font-size: 12pt;
  color: #8a8f7e;
  margin-left: 2pt;
  vertical-align: baseline;
}
.cover .cover-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 24pt;
  font-size: 8.5pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8a8f7e;
}

/* ----- Interior pages -----
   Padding is now ZERO because the @page margin handles the outer
   spacing. The previous version doubled it (page margin + section
   padding) and didn't account for the footer, causing the overlap.
   Each section just stacks vertically with consistent inter-section
   spacing via margin-top. */
section.plan-section,
.page-section {
  padding: 0;
  margin-top: 36pt;
  page-break-inside: auto;
}
section.plan-section:first-of-type {
  margin-top: 0;
}
section.plan-section.page-break,
.page-break {
  page-break-before: always;
  margin-top: 0;
}

/* Section eyebrow + headline pattern used on Strategy, Lifestyle,
   Practical Execution, Substitutions, Shopping List */
.section-eyebrow {
  font-size: 9pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #94b428;
  font-weight: 600;
  margin-bottom: 8pt;
}
section.plan-section h2 {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 28pt;
  line-height: 1.05;
  font-weight: 400;
  letter-spacing: -0.01em;
  margin: 0 0 18pt;
  color: #1a1a1c;
}
section.plan-section h3 {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 14pt;
  line-height: 1.2;
  font-weight: 600;
  margin: 18pt 0 4pt;
  color: #1a1a1c;
}
section.plan-section h4 {
  font-size: 10.5pt;
  font-weight: 700;
  margin: 8pt 0 4pt;
  color: #1a1a1c;
}
section.plan-section p {
  margin: 0 0 10pt;
  color: #3a3a3c;
}
section.plan-section p:last-child { margin-bottom: 0; }

/* ----- Info table (legacy structure, kept on cover) ----- */
.info-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 20pt;
}
.info-table tr { border-top: 1px solid #2a2e26; }
.info-table tr:last-child { border-bottom: 1px solid #2a2e26; }
.info-table th {
  text-align: left;
  font-weight: 500;
  color: #8a8f7e;
  vertical-align: top;
  padding: 8pt 14pt 8pt 0;
  width: 28%;
  font-size: 9.5pt;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.info-table td {
  vertical-align: top;
  padding: 8pt 0;
  color: #d8d4c4;
  font-size: 10.5pt;
  line-height: 1.55;
}

/* ----- Daily macro targets table (top of doc, after cover) -----
   When this appears on a cream interior page, restyle as a clean
   KPI row. The cover version is restyled separately via .cover */
.macro-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 0 0 18pt;
}
.macro-table tr:first-child th {
  font-size: 8.5pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8a857a;
  font-weight: 600;
  padding: 0 0 8pt;
  text-align: left;
  border-bottom: 1px solid #e6e0d2;
}
.macro-table tr:nth-child(2) td {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 22pt;
  font-weight: 400;
  color: #1a1a1c;
  padding: 12pt 0 0;
  text-align: left;
  line-height: 1;
}

/* ----- Day block ----- */
.day-block {
  margin: 0 0 24pt;
  page-break-inside: avoid;
}
.day-block .day-header {
  display: flex;
  align-items: center;
  gap: 22pt;
  margin-bottom: 16pt;
  padding-bottom: 12pt;
  border-bottom: 1px solid #1a1a1c;
}
.day-block .day-header h3 {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 40pt;
  line-height: 0.9;
  font-weight: 400;
  margin: 0;
  color: #1a1a1c;
  flex-shrink: 0;
  min-width: 36pt;
}
.day-block .day-header h3 .day-num {
  color: #94b428;
  font-style: italic;
}
.day-block .day-header .day-theme {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 18pt;
  font-style: italic;
  color: #1a1a1c;
  font-weight: 400;
  line-height: 1.2;
  display: block;
}
.day-block .day-header .day-of-week {
  font-size: 9pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #8a857a;
  font-weight: 600;
  display: block;
  margin-bottom: 6pt;
}

/* Daily totals strip — cleaner than the old version */
.daily-totals-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  margin: 0 0 18pt;
  border-bottom: 1px solid #e6e0d2;
  padding-bottom: 14pt;
}
.daily-totals-strip table { display: none; } /* hide legacy table markup */
.daily-totals-strip .totals-col {
  padding-right: 14pt;
  border-right: 1px solid #e6e0d2;
}
.daily-totals-strip .totals-col:last-child { border-right: none; padding-right: 0; }
.daily-totals-strip .totals-col .label {
  font-size: 8.5pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8a857a;
  font-weight: 600;
  margin-bottom: 6pt;
}
.daily-totals-strip .totals-col .val {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 22pt;
  font-weight: 400;
  color: #1a1a1c;
  line-height: 1;
}
.daily-totals-strip .totals-col .val .target {
  font-size: 11pt;
  color: #8a857a;
  font-family: -apple-system, Arial, sans-serif;
  margin-left: 4pt;
}
/* Backwards-compat: the LLM still emits the old <table class="daily-totals-strip">
   structure. Restyle it inline to look like the new grid. */
table.daily-totals-strip {
  display: table;
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16pt;
  border-bottom: 1px solid #e6e0d2;
  padding-bottom: 0;
}
table.daily-totals-strip th,
table.daily-totals-strip td {
  text-align: left;
  padding: 6pt 12pt 6pt 0;
  font-size: 9.5pt;
}
table.daily-totals-strip th {
  font-weight: 600;
  color: #8a857a;
  text-transform: uppercase;
  font-size: 8.5pt;
  letter-spacing: 0.14em;
  border-bottom: 1px solid #e6e0d2;
}
table.daily-totals-strip tr:nth-child(2) td {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 16pt;
  font-weight: 400;
  color: #1a1a1c;
  padding-top: 10pt;
  line-height: 1;
}
table.daily-totals-strip tr:nth-child(3) td {
  font-size: 9pt;
  color: #8a857a;
  padding-bottom: 10pt;
}

/* Per-meal block within a day */
.meal-block {
  margin: 14pt 0 18pt;
  page-break-inside: avoid;
}
.meal-block h4 {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 15pt;
  font-weight: 400;
  margin: 0 0 8pt;
  color: #1a1a1c;
  display: flex;
  align-items: baseline;
  gap: 12pt;
  flex-wrap: wrap;
}
/* Convert the LLM's "Meal Type (~Time): Name" into a badge + title.
   Since the LLM outputs all of this as a single h4 string, we can't
   easily split — instead we just style the h4 cleanly. */
.meal-block h4::before {
  content: "";
}

/* Ingredients table */
table.ingredients-table {
  width: 100%;
  border-collapse: collapse;
  margin: 6pt 0 0;
  font-size: 9.5pt;
}
table.ingredients-table th {
  text-align: left;
  font-weight: 600;
  color: #8a857a;
  background: transparent;
  border-bottom: 1px solid #1a1a1c;
  padding: 4pt 8pt 4pt 0;
  font-size: 8pt;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}
table.ingredients-table td {
  padding: 6pt 8pt 6pt 0;
  border-bottom: 1px solid #f0ebde;
  color: #1a1a1c;
}
table.ingredients-table tr.meal-subtotal td {
  font-weight: 700;
  background: transparent;
  border-top: 1px solid #1a1a1c;
  border-bottom: none;
  padding: 8pt 8pt 0 0;
  color: #1a1a1c;
}
/* Right-align numeric columns (2nd onward) */
table.ingredients-table th:not(:first-child),
table.ingredients-table td:not(:first-child) {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ----- Lifestyle Notes / Practical Execution / Substitutions ----- */
.lifestyle-notes h3,
.execution h3,
.substitutions h3 {
  border-left: 3px solid #c8e64a;
  padding-left: 14pt;
  margin-left: -14pt;
  margin-top: 24pt;
  margin-bottom: 6pt;
}
.execution h3:first-of-type,
.lifestyle-notes h3:first-of-type,
.substitutions h3:first-of-type {
  margin-top: 8pt;
}

/* Substitutions Q/A */
.substitutions .sub-q {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 13pt;
  font-weight: 600;
  color: #1a1a1c;
  margin-top: 18pt;
  border-left: 3px solid #c8e64a;
  padding-left: 14pt;
  margin-left: -14pt;
}
.substitutions .sub-a {
  margin: 4pt 0 0 0;
  padding-left: 0;
  color: #3a3a3c;
}

/* ----- 7-Day Shopping List ----- */
.shopping-list h3 { display: none; } /* category names come via h4 */
.shopping-list .category-block {
  margin-bottom: 0;
  page-break-inside: avoid;
}
/* Two-column layout — categories flow naturally across two columns
   for that magazine-spread feel. */
.shopping-list > .category-block,
.shopping-list .categories-grid {
  break-inside: avoid;
}
.shopping-list .category-block h4 {
  font-size: 9pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #94b428;
  font-weight: 700;
  margin: 18pt 0 8pt;
  padding-bottom: 4pt;
  border-bottom: 1px solid #1a1a1c;
}
table.shopping-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10pt;
  margin: 0;
}
table.shopping-table th { display: none; } /* headers redundant given the section eyebrow */
table.shopping-table td {
  padding: 6pt 8pt 6pt 0;
  border-bottom: 1px solid #f0ebde;
  color: #1a1a1c;
  vertical-align: baseline;
}
table.shopping-table td:nth-child(2) {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
table.shopping-table td:nth-child(3) {
  color: #8a857a;
  font-size: 9pt;
  text-align: left;
  padding-left: 8pt;
  width: 32%;
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
  color: #8a857a;
  background: transparent;
  border-bottom: 1px solid #1a1a1c;
  padding: 5pt 8pt 5pt 0;
  font-size: 8.5pt;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}
table.variance-table td {
  padding: 6pt 8pt 6pt 0;
  border-bottom: 1px solid #f0ebde;
  font-variant-numeric: tabular-nums;
}
table.variance-table th:not(:first-child),
table.variance-table td:not(:first-child) {
  text-align: right;
  white-space: nowrap;
}
table.variance-table tr.target-row td {
  font-weight: 700;
  border-top: 1px solid #1a1a1c;
  border-bottom: none;
  background: transparent;
  padding-top: 8pt;
}

/* ----- Trailing attribution ----- */
.plan-attribution {
  margin-top: 40pt;
  padding-top: 14pt;
  border-top: 1px solid #e6e0d2;
  font-size: 9pt;
  color: #8a857a;
  letter-spacing: 0.02em;
}

/* Generic helpers */
strong { font-weight: 700; color: #1a1a1c; }
em { font-style: italic; }
ul, ol { margin: 0 0 10pt; padding-left: 18pt; }
li { margin-bottom: 4pt; color: #3a3a3c; }

/* Force page breaks for major sections so each gets its own opener */
.shopping-list { page-break-before: always; }
.execution { page-break-before: always; }
.variance-table { page-break-inside: avoid; }
`;

// ---------------------------------------------------------------------------
// Sample body for renderer testing
// ---------------------------------------------------------------------------

/**
 * Comprehensive sample body for renderer smoke-testing. Mirrors the
 * full Jake-Ryan/Oscar-style structure so we can verify the redesigned
 * CSS without burning an LLM call. NOT used for shipped plans.
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
  <div class="cover-top">
    <div class="brand">CCOS Nutrition</div>
    <div class="meta">
      <div>Generated May 25, 2026</div>
      <div>Coach: Shaun</div>
    </div>
  </div>

  <div class="cover-headline">
    <div class="eyebrow">Personalized Nutrition Protocol</div>
    <h1>7-Day<br/><span class="accent">Meal Plan</span></h1>
    <div class="cover-subtitle">Bulk for muscle gain · 4 meals/day · Anchored in foods you already love.</div>
  </div>

  <div class="client-strip">
    <div class="client-name">Jake Ryan</div>
    <div class="client-meta">
      <span class="label">Age</span><span class="val">25</span>
      <span class="label">Ht</span><span class="val">6'3"</span>
      <span class="label">Wt</span><span class="val">200 lbs</span>
    </div>
  </div>

  <div class="kpi-strip">
    <div class="kpi"><div class="label">Calories</div><div class="val accent">2900<span class="unit"></span></div></div>
    <div class="kpi"><div class="label">Protein</div><div class="val">200<span class="unit">g</span></div></div>
    <div class="kpi"><div class="label">Carbs</div><div class="val">388<span class="unit">g</span></div></div>
    <div class="kpi"><div class="label">Fat</div><div class="val">61<span class="unit">g</span></div></div>
    <div class="kpi"><div class="label">Sodium cap</div><div class="val">2300<span class="unit">mg</span></div></div>
  </div>

  <div class="cover-footer">
    <span>Slow bulk · ~0.5 lb/week</span>
    <span>Prepared exclusively for Jake Ryan</span>
  </div>
</div>`;

const SAMPLE_MACROS = `
<section class="plan-section">
  <div class="section-eyebrow">Daily macro targets</div>
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
  <div class="section-eyebrow">Strategy & Approach</div>
  <h2>The plan, and why it works</h2>
  <p>2900 cals, 200g protein, 388g carbs, 61g fat. That's the target, and it's a small surplus, a bit more than you burn, because the goal is to add muscle and bring you up to 215 lb. The coach set the calories just above the basic suggestion on purpose, only about 85 cals over, which makes this a slow bulk, not a dirty one.</p>
  <p>The plan is built straight from the foods you said you love. Bacon and eggs are on the menu most mornings, just with the portion dialed in so the sodium stays in line. Seafood is a major feature: salmon, shrimp, scallops, tuna, and cod each show up across the week. Italian and pasta nights are anchored by spaghetti with meat sauce and garlic bread, fettuccine Alfredo with shrimp, and chicken Alfredo.</p>
  <p>The four meals are built to fix the biggest gap in your current pattern. You said you often skip dinner and sometimes default to two PB and honey sandwiches, which on a bulk is actually leaving a ton of calories on the table.</p>
</section>`;

const SAMPLE_LIFESTYLE = `
<section class="plan-section lifestyle-notes">
  <div class="section-eyebrow">Lifestyle Notes</div>
  <h2>Habits that make the plan work</h2>
  <h3>Hydration</h3>
  <p>You're at about half a gallon (64 oz) a day, which is decent, but on a bulk like this it needs to come up. The target is 100 oz over the next couple of weeks, building one bottle at a time. The high protein also puts your kidneys to work, so good water keeps everything running.</p>
  <h3>Sleep</h3>
  <p>7 hours is a solid number, hold it where it is. Sleep matters a lot on a bulk because the actual muscle growth happens overnight, not in the gym. Good sleep also keeps your hunger and energy steady, which is important when you're trying to put away 2900 calories most days.</p>
</section>`;

const SAMPLE_DAILY_BREAKDOWN = `
<section class="plan-section">
  <div class="section-eyebrow">Daily Breakdown</div>
  <h2>Seven days, in detail</h2>
  <p>Each day starts with a totals strip showing how the day adds up against your targets. Every meal lists ingredients with gram weights, per-ingredient macros, and a subtotal. Cooked weights are listed for all meats, seafood, pasta, and rice.</p>

  ${[1,2,3,4,5,6,7].map((n) => sampleDayBlock(n)).join("\n")}
</section>`;

function sampleDayBlock(dayNum: number): string {
  const dayName = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][dayNum - 1];
  const theme = ["Spaghetti night","Salmon and rice","Shrimp Alfredo night","Steak and pasta","Scallops and pasta","Salmon and rice","Chicken pasta night"][dayNum - 1];
  return `
<div class="day-block">
  <div class="day-header">
    <h3><span class="day-num">${dayNum}</span></h3>
    <div>
      <span class="day-of-week">${dayName}</span>
      <span class="day-theme">${theme}</span>
    </div>
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
        <tr><td>Garlic bread</td><td>40 g</td><td>140</td><td>3.4</td><td>20.0</td><td>5.2</td></tr>
        <tr><td>Spinach, cooked</td><td>80 g</td><td>18</td><td>2.4</td><td>3.0</td><td>0.2</td></tr>
        <tr class="meal-subtotal"><td>Meal subtotal</td><td></td><td>979</td><td>63.1</td><td>132.8</td><td>20.2</td></tr>
      </tbody>
    </table>
  </div>
</div>`;
}

const SAMPLE_EXECUTION = `
<section class="plan-section execution">
  <div class="section-eyebrow">Practical Execution</div>
  <h2>Making it work in real life</h2>

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
  <div class="section-eyebrow">Practical Substitutions</div>
  <h2>Swaps so you can flex</h2>
  <p>Same-weight protein swaps stay macro-equivalent. Stay close to the gram weight listed.</p>

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
<section class="plan-section shopping-list">
  <div class="section-eyebrow">7-Day Shopping List</div>
  <h2>Everything, in one trip</h2>
  <p>Total grams across all 7 days. Buy slightly more than listed to account for trim, packaging, and small portion variation.</p>

  <div class="category-block">
    <h4>Proteins</h4>
    <table class="shopping-table">
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
  <div class="section-eyebrow">Variance Disclosure</div>
  <h2>How honest the math is</h2>
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
  Plan generated for Jake Ryan. Macros calculated from USDA reference values; individual product labels may vary by 5 to 10 percent. Coach: Shaun, CCOS Nutrition. Generated May 25, 2026.
</div>`;
