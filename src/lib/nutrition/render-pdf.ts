// Headless Chromium HTML to PDF renderer for the auto meal plan pipeline.
//
// Runs on Vercel via @sparticuz/chromium — the Lambda-optimized
// Chromium build (binary lives in a tar.br ~50MB). On local dev we
// fall back to whatever Chrome the system has installed (or the
// puppeteer-bundled Chromium if puppeteer-core was paired with the
// full puppeteer package). Either path returns a Buffer of the PDF.
//
// All renders use US Letter at 0.6"/0.55" margins — matching the
// @page rule in plan-pdf-template.ts. Don't override these on the
// PDF print call; the template controls layout.

import type { Browser, Page } from "puppeteer-core";
import { buildFooterTemplate } from "./plan-pdf-template";

interface RenderOptions {
  /** Used in the page footer ("Jake Ryan | 7-Day Meal Plan Page N / M"). */
  clientFullName: string;
}

/**
 * Render a fully-formed HTML document (with <html><head><style>...) to
 * a PDF Buffer. Adds a per-page footer with client name + page numbers
 * via puppeteer's displayHeaderFooter.
 */
export async function renderHtmlToPdf(
  html: string,
  options: RenderOptions,
): Promise<Buffer> {
  const { browser, page } = await launchBrowser();
  try {
    // domcontentloaded is sufficient — we have no external assets in
    // the locked CSS (no @import, no remote fonts/images).
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const pdf = await page.pdf({
      format: "letter",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: buildFooterTemplate(options.clientFullName),
      // Margin is controlled by the @page rule in the template's CSS
      // (since preferCSSPageSize: true). The bottom margin in the
      // CSS includes room for the footer template.
      margin: { top: "0in", right: "0in", bottom: "0in", left: "0in" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {
      // Best-effort cleanup. Vercel will reap the function anyway.
    });
  }
}

/**
 * Launches Chromium with environment-appropriate config:
 *   - Vercel / Lambda: use @sparticuz/chromium's executablePath + args
 *   - Local dev (macOS): use system Chrome if present
 *
 * Detection is via the AWS_LAMBDA_FUNCTION_NAME or VERCEL env vars,
 * which are set on Vercel functions but not local dev.
 */
async function launchBrowser(): Promise<{ browser: Browser; page: Page }> {
  const isServerless = Boolean(
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.VERCEL ||
      process.env.NEXT_RUNTIME === "nodejs" && process.env.VERCEL_ENV,
  );

  const puppeteer = await import("puppeteer-core");

  if (isServerless) {
    const chromiumPkg = await import("@sparticuz/chromium");
    const chromium = chromiumPkg.default ?? chromiumPkg;
    const executablePath = await chromium.executablePath();
    // Note: defaultViewport was dropped from the public API in
    // @sparticuz/chromium 100+. Puppeteer uses 800x600 by default,
    // which is fine for PDF render (page.pdf ignores the viewport).
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });
    const page = await browser.newPage();
    return { browser, page };
  }

  // Local dev: try common macOS Chrome paths
  const localPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    process.env.PUPPETEER_EXECUTABLE_PATH,
  ].filter(Boolean) as string[];

  for (const exec of localPaths) {
    try {
      const browser = await puppeteer.launch({
        executablePath: exec,
        headless: true,
        args: ["--no-sandbox"],
      });
      const page = await browser.newPage();
      return { browser, page };
    } catch {
      // try next
    }
  }

  throw new Error(
    "No Chromium binary available. On Vercel this should auto-resolve via @sparticuz/chromium; locally install Google Chrome or set PUPPETEER_EXECUTABLE_PATH.",
  );
}
