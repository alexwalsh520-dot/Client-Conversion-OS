/**
 * Server-side PDF renderer using jsPDF.
 * Produces a clean, unbranded 7-day meal plan with grocery list and tips.
 * Footer on every page: "Reviewed by Damanjeet Kaur".
 */

import { jsPDF } from "jspdf";
import type { IngredientRow } from "./ingredient-filter";
import type { MacroTargets } from "./macro-calculator";
import type { DayPlan, GroceryItem, MacroSummary } from "./macro-validator";
import { computeMealMacros } from "./macro-validator";

export interface PdfContext {
  clientFirstName: string;
  clientLastName: string;
  goal: string;
  targets: MacroTargets;
  days: DayPlan[];
  dayMacros: MacroSummary[];
  grocery: GroceryItem[];
  tips: string[];
  byslug: Map<string, IngredientRow>;
  version: number;
}

const FOOTER_TEXT = "Reviewed by Damanjeet Kaur";
const INK = "#1a1a1a";
const SUBTLE = "#666666";
const ACCENT = "#c9a96e";
const DIVIDER = "#e0e0e0";

export function renderMealPlanPDF(ctx: PdfContext): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 54;
  const marginTop = 60;
  const marginBottom = 60;

  const usedDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const addFooter = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(SUBTLE);
    doc.text(FOOTER_TEXT, marginX, pageHeight - 30);
    doc.text(
      `Page ${doc.getNumberOfPages()}`,
      pageWidth - marginX,
      pageHeight - 30,
      { align: "right" }
    );
    // thin divider above footer
    doc.setDrawColor(DIVIDER);
    doc.setLineWidth(0.5);
    doc.line(marginX, pageHeight - 40, pageWidth - marginX, pageHeight - 40);
  };

  // ========== PAGE 1: COVER ==========
  const fullName = `${ctx.clientFirstName} ${ctx.clientLastName}`.trim();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(INK);
  doc.text("7-Day Custom Meal Plan", marginX, 120);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(SUBTLE);
  doc.text(`Prepared for ${fullName}`, marginX, 145);
  doc.text(`${usedDate} · Version ${ctx.version}`, marginX, 160);

  // Goal
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(INK);
  doc.text("Fitness Goal", marginX, 210);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(SUBTLE);
  const goalLines = doc.splitTextToSize(ctx.goal || "—", pageWidth - 2 * marginX);
  doc.text(goalLines, marginX, 225);

  // Daily Targets box
  const targetsY = 285;
  doc.setDrawColor(ACCENT);
  doc.setLineWidth(1);
  doc.roundedRect(marginX, targetsY, pageWidth - 2 * marginX, 100, 8, 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(INK);
  doc.text("Daily Macro Targets", marginX + 20, targetsY + 25);

  doc.setFontSize(10);
  doc.setTextColor(SUBTLE);
  doc.setFont("helvetica", "normal");

  const targetItems = [
    { label: "Calories", value: `${ctx.targets.calories} kcal` },
    { label: "Protein", value: `${ctx.targets.proteinG} g` },
    { label: "Carbs", value: `${ctx.targets.carbsG} g` },
    { label: "Fat", value: `${ctx.targets.fatG} g` },
  ];
  const colWidth = (pageWidth - 2 * marginX - 40) / 4;
  targetItems.forEach((item, i) => {
    const x = marginX + 20 + i * colWidth;
    doc.setTextColor(SUBTLE);
    doc.setFontSize(9);
    doc.text(item.label.toUpperCase(), x, targetsY + 55);
    doc.setTextColor(INK);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(item.value, x, targetsY + 75);
    doc.setFont("helvetica", "normal");
  });

  // Plan overview note
  doc.setFontSize(9);
  doc.setTextColor(SUBTLE);
  doc.setFont("helvetica", "normal");
  const overviewText =
    `This plan provides 7 days of structured meals calibrated to your targets above. ` +
    `Portion sizes are listed in grams (and ounces for reference). ` +
    `Consistency with portions is the most important factor — aim to weigh ingredients when possible. ` +
    `A consolidated grocery list for the full week is included at the end of the plan, followed by personalized tips to help you succeed.`;
  const overviewLines = doc.splitTextToSize(overviewText, pageWidth - 2 * marginX);
  doc.text(overviewLines, marginX, 420);

  addFooter();

  // ========== PAGES 2-8: DAILY MEAL PLANS ==========
  for (let di = 0; di < ctx.days.length; di++) {
    const day = ctx.days[di];
    const dayTotals = ctx.dayMacros[di];
    doc.addPage();

    // Day header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(INK);
    doc.text(`Day ${day.day}`, marginX, marginTop);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(SUBTLE);
    const totalsLine = `${dayTotals.calories} kcal · ${dayTotals.proteinG}g P · ${dayTotals.carbsG}g C · ${dayTotals.fatG}g F`;
    doc.text(totalsLine, marginX, marginTop + 18);

    // Divider
    doc.setDrawColor(DIVIDER);
    doc.setLineWidth(0.5);
    doc.line(marginX, marginTop + 30, pageWidth - marginX, marginTop + 30);

    let y = marginTop + 55;

    for (const meal of day.meals) {
      const mealMacros = computeMealMacros(meal, ctx.byslug);

      // Meal name + time
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(INK);
      doc.text(meal.name, marginX, y);

      if (meal.time) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(SUBTLE);
        doc.text(meal.time, pageWidth - marginX, y, { align: "right" });
      }

      // Meal macros line
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(SUBTLE);
      doc.text(
        `${mealMacros.calories} kcal · ${mealMacros.proteinG}g P · ${mealMacros.carbsG}g C · ${mealMacros.fatG}g F`,
        marginX,
        y
      );

      y += 12;

      // Ingredients
      doc.setFontSize(10);
      doc.setTextColor(INK);
      for (const ing of meal.ingredients) {
        const row = ctx.byslug.get(ing.slug);
        const name = row?.name || ing.slug;
        const oz = (ing.grams / 28.3495).toFixed(1);
        const line = `  •  ${name} — ${ing.grams}g (${oz} oz)`;
        doc.text(line, marginX, y);
        y += 14;
      }

      y += 10;

      // Page break if running out of space
      if (y > pageHeight - marginBottom - 60 && day.meals.indexOf(meal) < day.meals.length - 1) {
        addFooter();
        doc.addPage();
        y = marginTop;
      }
    }

    addFooter();
  }

  // ========== GROCERY LIST ==========
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(INK);
  doc.text("Grocery List", marginX, marginTop);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(SUBTLE);
  doc.text("Total quantities for the full 7 days. Round up at the store for practical portioning.", marginX, marginTop + 18);

  doc.setDrawColor(DIVIDER);
  doc.setLineWidth(0.5);
  doc.line(marginX, marginTop + 30, pageWidth - marginX, marginTop + 30);

  let gy = marginTop + 55;
  let currentCat = "";

  const categoryLabels: Record<string, string> = {
    protein: "Proteins",
    seafood: "Seafood",
    dairy: "Dairy",
    grain: "Grains",
    carb: "Carbs & Starches",
    legume: "Legumes",
    vegetable: "Vegetables",
    fruit: "Fruits",
    fat: "Fats, Oils & Nuts",
    condiment: "Condiments & Sauces",
    supplement: "Supplements",
    beverage: "Beverages",
  };

  for (const item of ctx.grocery) {
    if (item.category !== currentCat) {
      currentCat = item.category;
      if (gy > pageHeight - marginBottom - 80) {
        addFooter();
        doc.addPage();
        gy = marginTop;
      }
      gy += 8;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(ACCENT);
      doc.text((categoryLabels[currentCat] || currentCat).toUpperCase(), marginX, gy);
      gy += 16;
    }

    if (gy > pageHeight - marginBottom - 20) {
      addFooter();
      doc.addPage();
      gy = marginTop;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(INK);
    doc.text(item.name, marginX + 10, gy);

    doc.setTextColor(SUBTLE);
    const qty = `${item.totalGrams}g (${item.totalOz} oz)`;
    doc.text(qty, pageWidth - marginX, gy, { align: "right" });
    gy += 14;
  }

  addFooter();

  // ========== TIPS ==========
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(INK);
  doc.text("Tips for Success", marginX, marginTop);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(SUBTLE);
  doc.text("A few pointers — some personalized to your intake form, some broadly useful.", marginX, marginTop + 18);

  doc.setDrawColor(DIVIDER);
  doc.setLineWidth(0.5);
  doc.line(marginX, marginTop + 30, pageWidth - marginX, marginTop + 30);

  let ty = marginTop + 55;
  for (let i = 0; i < ctx.tips.length; i++) {
    const tip = ctx.tips[i];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(ACCENT);
    doc.text(`${i + 1}.`, marginX, ty);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(INK);
    const lines = doc.splitTextToSize(tip, pageWidth - 2 * marginX - 24);
    doc.text(lines, marginX + 24, ty);
    ty += lines.length * 13 + 10;

    if (ty > pageHeight - marginBottom - 40 && i < ctx.tips.length - 1) {
      addFooter();
      doc.addPage();
      ty = marginTop;
    }
  }

  addFooter();

  // Return raw PDF bytes
  return doc.output("arraybuffer") as unknown as Uint8Array;
}
