/**
 * Server-side PDF renderer using jsPDF.
 * Matches the sample "Custom Nutrition Plan" layout:
 *   Page 1: cover (name, details table, macro targets box)
 *   Pages 2..N+1: one per day (meal tables + day total band)
 *   Page N+2: weekly grocery list, grouped + 2 columns
 *   Page N+3: nutrition tips & guidelines
 * Footer on every page: "Reviewed by Damanjeet Kaur | Prepared <date> | Page N".
 */

import { jsPDF } from "jspdf";
import type { MacroTargets } from "./macro-calculator";

// Colors (matching sample)
const INK = "#1f2a44";        // dark navy for headers/body
const GOLD = "#c9a96e";       // accent (name, meal labels, day total band)
const CREAM = "#f5efdf";      // totals row + macro box bg
const GRAY = "#6b7280";       // labels
const LIGHT_DIVIDER = "#e5e7eb";

const FOOTER_REVIEW_TEXT = "Created by Damanjeet Kaur";

// ============================================================================
// Input types — self-contained, no dependence on Map<slug, IngredientRow>
// ============================================================================

export interface PdfIngredient {
  name: string;          // display name, e.g. "Grilled Chicken Breast"
  amount: string;        // display amount, e.g. "180g" or "240ml"
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  category: string;      // DB category: protein, carb, vegetable, fruit, dairy, condiment, supplement, beverage, legume, grain, seafood, fat
}

export interface PdfMeal {
  name: string;          // "Breakfast", "Lunch", etc.
  time: string;          // "7:30 AM"
  dishName?: string;     // "Tex-Mex Egg Scramble Bowl" (from Claude)
  ingredients: PdfIngredient[];
  totalCal: number;
  totalP: number;
  totalC: number;
  totalF: number;
}

export interface PdfDay {
  dayNumber: number;     // 1..7
  weekday: string;       // "Monday", ...
  meals: PdfMeal[];
  totalCal: number;
  totalP: number;
  totalC: number;
  totalF: number;
  totalSodiumMg?: number;  // optional — rendered in the Day Total band when present
}

export interface PdfGroceryItem {
  name: string;
  amount: string;        // "360 g" or "150 ml"
  category: string;
}

export interface PdfTip {
  title: string;
  body: string;
}

export interface PdfClient {
  firstName: string;
  lastName: string;
  age: number;
  weightKg: number;
  weightLbs: number;
  heightCm: number;
  heightFtIn: string;   // e.g. "5'11""
  goalLabel: string;    // "Fat Loss", "Muscle Gain", "Maintenance"
  goalWeightLbs?: number; // optional — shown in "Your Timeline" line if present
  mealsPerDay: number;
  allergies: string;    // free text (e.g. "Tree nuts" or "None")
  medications?: string; // free text (e.g. "Lisinopril") — hidden if empty/none
  timelineNote?: string; // e.g. "~12 weeks to reach your goal weight of 170 lbs"
}

export interface PdfInput {
  client: PdfClient;
  targets: MacroTargets;
  days: PdfDay[];
  grocery: PdfGroceryItem[];
  tips: PdfTip[];
}

// ============================================================================
// Table column layout for daily meal tables
// ============================================================================

const TABLE_COLS = [
  { key: "ingredient", label: "Ingredient", width: 250, align: "left" as const },
  { key: "amt",        label: "Amt",        width: 55,  align: "left" as const },
  { key: "cal",        label: "Cal",        width: 45,  align: "left" as const },
  { key: "p",          label: "P (g)",      width: 50,  align: "left" as const },
  { key: "c",          label: "C (g)",      width: 50,  align: "left" as const },
  { key: "f",          label: "F (g)",      width: 45,  align: "left" as const },
];
const TABLE_TOTAL_WIDTH = TABLE_COLS.reduce((s, c) => s + c.width, 0); // 495

// ============================================================================
// Grocery category display order (matching sample)
// ============================================================================

const GROCERY_CATEGORY_ORDER = [
  "Fruits",
  "Vegetables",
  "Other",
  "Proteins",
  "Oils, Sauces & Condiments",
  "Grains & Carbs",
  "Beverages",
  "Dairy & Eggs",
];

export function mapDbCategoryToDisplay(dbCategory: string): string {
  switch (dbCategory) {
    case "fruit":      return "Fruits";
    case "vegetable":  return "Vegetables";
    case "protein":
    case "seafood":    return "Proteins";
    case "fat":
    case "condiment":  return "Oils, Sauces & Condiments";
    case "carb":
    case "grain":      return "Grains & Carbs";
    case "beverage":   return "Beverages";
    case "dairy":      return "Dairy & Eggs";
    case "legume":
    case "supplement": return "Other";
    default:           return "Other";
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * The intake form collapses allergies and medical conditions into a single
 * free-text "Allergies / Medical" field. This splits the string on commas/
 * semicolons/newlines and classifies each piece by keyword so the cover page
 * can render "Allergies" and "Medical Conditions" as separate rows.
 * This is a PDF-display workaround. The proper fix is separating the fields
 * on the intake form + DB schema (separate ticket).
 */
function splitAllergiesMedical(raw: string): { allergies: string; medical: string } {
  if (!raw) return { allergies: "", medical: "" };
  const parts = raw
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const medicalKeywords = [
    "high blood pressure", "hbp", "hypertension",
    "diabetes", "type 1", "type 2", "t1d", "t2d", "pre-diabetes", "prediabetes",
    "celiac", "coeliac", "gluten", "lactose", "dairy intolerance",
    "kidney", "renal", "ckd",
    "high cholesterol", "hyperlipidemia",
    "thyroid", "hypothyroid", "hyperthyroid",
    "pcos", "endometriosis",
    "ibs", "crohn", "colitis", "ibd",
    "heart disease", "cardiac", "arrhythmia",
    "cancer", "autoimmune",
  ];
  const allergyBuckets: string[] = [];
  const medicalBuckets: string[] = [];
  for (const p of parts) {
    const low = p.toLowerCase();
    if (medicalKeywords.some((k) => low.includes(k))) {
      medicalBuckets.push(p);
    } else {
      allergyBuckets.push(p);
    }
  }
  return {
    allergies: allergyBuckets.join(", "),
    medical: medicalBuckets.join(", "),
  };
}

function fmtNum(n: number, decimals = 0): string {
  if (!isFinite(n)) return "0";
  const rounded = decimals === 0 ? Math.round(n) : Number(n.toFixed(decimals));
  return String(rounded);
}

function fmtMacro(n: number): string {
  // 1 decimal for small numbers, 0 for larger
  if (n < 10) return n.toFixed(1).replace(/\.0$/, "");
  if (n < 100) return n.toFixed(1).replace(/\.0$/, "");
  return String(Math.round(n));
}

// ============================================================================
// Main renderer
// ============================================================================

export function renderMealPlanPDF(input: PdfInput): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();   // 612
  const pageHeight = doc.internal.pageSize.getHeight(); // 792
  const marginX = 54;
  const marginTop = 60;
  const marginBottom = 60;
  const contentWidth = pageWidth - marginX * 2;

  const preparedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  // ---------- Footer drawn on every page ----------
  const drawFooter = () => {
    const footerY = pageHeight - 30;
    // Light divider line
    doc.setDrawColor(LIGHT_DIVIDER);
    doc.setLineWidth(0.5);
    doc.line(marginX, footerY - 12, pageWidth - marginX, footerY - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(GRAY);
    const page = doc.getNumberOfPages();
    const text = `${FOOTER_REVIEW_TEXT}  |  Prepared ${preparedDate}  |  Page ${page}`;
    doc.text(text, pageWidth / 2, footerY, { align: "center" });
  };

  // ---------- Header strip on every page (same text as footer, top of page) ----------
  const drawTopHeader = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(GRAY);
    const page = doc.getNumberOfPages();
    const text = `${FOOTER_REVIEW_TEXT}  |  Prepared ${preparedDate}  |  Page ${page}`;
    doc.text(text, pageWidth / 2, 30, { align: "center" });
  };

  // ============================================================================
  // PAGE 1: COVER
  // ============================================================================
  {
    drawTopHeader();
    // The client-facing PDF is ALWAYS clean. Convergence violations live in
    // the API response and the admin UI — never on the document the client sees.
    const y_start = 140;
    let y = y_start;

    // Top gold rule
    doc.setDrawColor(GOLD);
    doc.setLineWidth(2);
    const ruleWidth = 220;
    const ruleX = (pageWidth - ruleWidth) / 2;
    doc.line(ruleX, y, ruleX + ruleWidth, y);
    y += 40;

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(30);
    doc.setTextColor(INK);
    doc.text("Custom Nutrition Plan", pageWidth / 2, y, { align: "center" });
    y += 32;

    // "Designed for" label
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(GRAY);
    doc.text("Designed for", pageWidth / 2, y, { align: "center" });
    y += 22;

    // Name (gold, larger, bold)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(GOLD);
    const fullName = `${input.client.firstName} ${input.client.lastName}`.trim();
    doc.text(fullName, pageWidth / 2, y, { align: "center" });
    y += 20;

    // Bottom gold rule
    doc.setDrawColor(GOLD);
    doc.setLineWidth(2);
    doc.line(ruleX, y, ruleX + ruleWidth, y);
    y += 40;

    // Details table (label gray/right-aligned, value dark/left-aligned)
    const detailRows: Array<[string, string]> = [
      ["Age", `${input.client.age} years`],
      ["Weight", `${fmtNum(input.client.weightKg)} kg  (${fmtNum(input.client.weightLbs)} lbs)`],
      ["Height", `${fmtNum(input.client.heightCm)} cm  (${input.client.heightFtIn})`],
      ["Goal", input.client.goalLabel],
    ];
    if (input.client.goalWeightLbs && input.client.goalWeightLbs > 0) {
      detailRows.push(["Goal Weight", `${fmtNum(input.client.goalWeightLbs)} lbs`]);
    }
    detailRows.push(["Meals / Day", String(input.client.mealsPerDay)]);

    // The intake form conflates allergies and medical conditions into one
    // "Allergies / Medical" field. This split detects common condition keywords
    // and displays them under "Medical Conditions", while everything else
    // stays under "Allergies". Real fix is an intake-form schema change.
    const { allergies: allergiesPart, medical: medicalPart } = splitAllergiesMedical(input.client.allergies || "");
    detailRows.push(["Allergies", allergiesPart || "None"]);
    if (medicalPart) {
      detailRows.push(["Medical Conditions", medicalPart]);
    }
    const medsStr = (input.client.medications || "").trim();
    if (medsStr && !/^(n\/?a|none|no)$/i.test(medsStr)) {
      detailRows.push(["Medications", medsStr]);
    }
    const labelX = pageWidth / 2 - 20;
    const valueX = pageWidth / 2 - 5;
    doc.setFontSize(10);
    for (const [label, value] of detailRows) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(GRAY);
      doc.text(label, labelX, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setTextColor(INK);
      doc.text(value, valueX, y, { align: "left" });
      y += 18;
    }

    y += 30;
    // Divider line
    doc.setDrawColor(LIGHT_DIVIDER);
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 24;

    // Daily Macro Targets heading
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(INK);
    doc.text("Daily Macro Targets", marginX, y);
    y += 22;

    // Macro targets box (cream bg, 4 columns)
    const boxX = marginX + 30;
    const boxW = contentWidth - 60;
    const boxH = 60;
    doc.setFillColor(CREAM);
    doc.roundedRect(boxX, y, boxW, boxH, 6, 6, "F");

    const cells = [
      { big: String(Math.round(input.targets.calories)), small: "kcal" },
      { big: `${Math.round(input.targets.proteinG)}g`,    small: "Protein" },
      { big: `${Math.round(input.targets.carbsG)}g`,      small: "Carbs" },
      { big: `${Math.round(input.targets.fatG)}g`,        small: "Fat" },
    ];
    const cellW = boxW / 4;
    for (let i = 0; i < cells.length; i++) {
      const cx = boxX + cellW * i + cellW / 2;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(INK);
      doc.text(cells[i].big, cx, y + 28, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(INK);
      doc.text(cells[i].small, cx, y + 44, { align: "center" });
    }

    // "Your Timeline" note under the macro box — only rendered if supplied
    if (input.client.timelineNote) {
      const noteY = y + boxH + 20;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(INK);
      doc.text("Your Timeline", marginX, noteY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(GRAY);
      const lines = doc.splitTextToSize(input.client.timelineNote, contentWidth);
      doc.text(lines, marginX, noteY + 14);
    }

    drawFooter();
  }

  // ============================================================================
  // PAGES FOR EACH DAY
  // ============================================================================
  for (const day of input.days) {
    doc.addPage();
    drawTopHeader();
    let y = marginTop + 30;

    // Day title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(INK);
    doc.text(`Day ${day.dayNumber} — ${day.weekday}`, marginX, y);
    y += 30;

    for (let mi = 0; mi < day.meals.length; mi++) {
      const meal = day.meals[mi];
      // Ensure room; otherwise new page.
      // For the LAST meal, include the day-total band (~28pt) + its 20pt
      // top spacing so the meal + day total never get split across pages.
      const isLastMeal = mi === day.meals.length - 1;
      const dayTotalBandRoom = isLastMeal ? 28 + 20 : 0;
      const neededHeight =
        20 + 22 + meal.ingredients.length * 18 + 22 + 20 + dayTotalBandRoom;
      if (y + neededHeight > pageHeight - marginBottom - 30) {
        doc.addPage();
        drawTopHeader();
        y = marginTop + 30;
      }

      // Meal label (e.g. "Breakfast")
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(GOLD);
      doc.text(meal.name, marginX, y);
      let cursorX = marginX + doc.getTextWidth(meal.name);

      // Dish name in between label and time if present
      if (meal.dishName) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(INK);
        const sep = "  ·  ";
        doc.text(sep, cursorX, y);
        cursorX += doc.getTextWidth(sep);
        doc.text(meal.dishName, cursorX, y);
        cursorX += doc.getTextWidth(meal.dishName);
      }

      // Time (gray, smaller)
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(GRAY);
      doc.text(`  ·  ${meal.time}`, cursorX, y);
      y += 10;

      // Table header (dark navy bg, white text)
      const headerH = 22;
      doc.setFillColor(INK);
      doc.rect(marginX, y, TABLE_TOTAL_WIDTH, headerH, "F");

      let colX = marginX;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor("#ffffff");
      for (const col of TABLE_COLS) {
        doc.text(col.label, colX + 8, y + 14);
        colX += col.width;
      }
      y += headerH;

      // Rows
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(INK);
      for (const ing of meal.ingredients) {
        const rowH = 18;
        // Light bottom border
        doc.setDrawColor(LIGHT_DIVIDER);
        doc.setLineWidth(0.5);
        doc.line(marginX, y + rowH, marginX + TABLE_TOTAL_WIDTH, y + rowH);

        const values = [
          ing.name.length > 42 ? ing.name.slice(0, 41) + "…" : ing.name,
          ing.amount,
          fmtNum(ing.calories),
          fmtMacro(ing.proteinG),
          fmtMacro(ing.carbsG),
          fmtMacro(ing.fatG),
        ];
        let cx = marginX;
        for (let i = 0; i < TABLE_COLS.length; i++) {
          doc.text(values[i], cx + 8, y + 12);
          cx += TABLE_COLS[i].width;
        }
        y += rowH;
      }

      // Total row (cream bg, bold)
      const totalH = 22;
      doc.setFillColor(CREAM);
      doc.rect(marginX, y, TABLE_TOTAL_WIDTH, totalH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(INK);
      const totalValues = [
        "Total",
        "",
        fmtNum(meal.totalCal),
        fmtMacro(meal.totalP),
        fmtMacro(meal.totalC),
        fmtMacro(meal.totalF),
      ];
      let tcx = marginX;
      for (let i = 0; i < TABLE_COLS.length; i++) {
        doc.text(totalValues[i], tcx + 8, y + 14);
        tcx += TABLE_COLS[i].width;
      }
      y += totalH + 18;
    }

    // Day total band (gold)
    const bandH = 28;
    if (y + bandH > pageHeight - marginBottom - 30) {
      doc.addPage();
      drawTopHeader();
      y = marginTop + 30;
    }
    doc.setFillColor(GOLD);
    doc.rect(marginX, y, TABLE_TOTAL_WIDTH, bandH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor("#ffffff");
    doc.text(`Day ${day.dayNumber} Total`, marginX + 12, y + 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    // Client-facing PDF shows kcal + macros only. Sodium is intentionally
    // NOT rendered here or anywhere else in the PDF — the internal numbers
    // are rough estimates and surfacing them to clients invites more
    // confusion than clarity. Sodium still drives server-side validation
    // (HBP/stim caps, universal stacking rule) — just not the PDF output.
    const bandSegments = [
      `${fmtNum(day.totalCal)} kcal`,
      `${fmtMacro(day.totalP)}g protein`,
      `${fmtMacro(day.totalC)}g carbs`,
      `${fmtMacro(day.totalF)}g fat`,
    ];
    let segX = marginX + 130;
    const segW = (TABLE_TOTAL_WIDTH - 140) / bandSegments.length;
    for (const seg of bandSegments) {
      doc.text(seg, segX, y + 18);
      segX += segW;
    }

    drawFooter();
  }

  // ============================================================================
  // GROCERY LIST PAGE
  // ============================================================================
  {
    doc.addPage();
    drawTopHeader();
    let y = marginTop + 30;

    // Grocery page header. No weekly sodium summary — those internal
    // estimates were confusing and not client-facing. Sodium is still
    // checked server-side by the validator.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(INK);
    doc.text("Weekly Grocery List", marginX, y);
    y += 24;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(GRAY);
    doc.text("Totals across all 7 days. Adjust for items you already have.", marginX, y);
    y += 18;

    // Group items by display category
    const groups = new Map<string, PdfGroceryItem[]>();
    for (const item of input.grocery) {
      const cat = mapDbCategoryToDisplay(item.category);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(item);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Two-column layout
    const colGap = 20;
    const colW = (contentWidth - colGap) / 2;
    const leftX = marginX;
    const rightX = marginX + colW + colGap;
    const topY = y;
    let leftY = topY;
    let rightY = topY;

    // Decide left vs right column based on cumulative height
    const estimateGroupHeight = (items: PdfGroceryItem[]) => {
      return 18 + items.length * 12 + 10;
    };

    // Order: iterate through preferred category order for consistency
    const orderedCategories = GROCERY_CATEGORY_ORDER.filter((c) => groups.has(c));

    // Simple placement: put groups in left col until it'd pass rightY, then right
    for (const catName of orderedCategories) {
      const items = groups.get(catName)!;
      const h = estimateGroupHeight(items);

      // Check if either column would overflow the page
      const maxY = pageHeight - marginBottom - 20;
      if (leftY + h > maxY && rightY + h > maxY) {
        // Start new page
        doc.addPage();
        drawTopHeader();
        leftY = marginTop + 30;
        rightY = marginTop + 30;
      }

      // Place in shorter column
      const placeLeft = leftY <= rightY;
      const x = placeLeft ? leftX : rightX;
      let curY = placeLeft ? leftY : rightY;

      // Category title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(INK);
      doc.text(catName, x, curY);
      curY += 14;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(INK);
      for (const item of items) {
        doc.setTextColor(GOLD);
        doc.text("•", x, curY);
        doc.setTextColor(INK);
        doc.text(`${item.name} — ${item.amount}`, x + 8, curY);
        curY += 12;
      }
      curY += 8;

      if (placeLeft) leftY = curY;
      else rightY = curY;
    }

    drawFooter();
  }

  // ============================================================================
  // TIPS PAGE
  // ============================================================================
  {
    doc.addPage();
    drawTopHeader();
    let y = marginTop + 30;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(INK);
    doc.text("Nutrition Tips & Guidelines", marginX, y);
    y += 32;

    for (const tip of input.tips) {
      // Estimate height
      const bodyLines = doc.splitTextToSize(tip.body, contentWidth);
      const h = 18 + bodyLines.length * 12 + 14;
      if (y + h > pageHeight - marginBottom - 20) {
        doc.addPage();
        drawTopHeader();
        y = marginTop + 30;
      }

      // Gold square bullet + title
      doc.setFillColor(GOLD);
      doc.rect(marginX, y - 8, 8, 8, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(GOLD);
      doc.text(tip.title, marginX + 14, y);
      y += 14;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(INK);
      doc.text(bodyLines, marginX, y);
      y += bodyLines.length * 12 + 14;
    }

    drawFooter();
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
