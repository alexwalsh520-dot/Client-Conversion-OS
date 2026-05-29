/**
 * GET /api/nutrition/v2/admin/test-pdf-render
 *
 * Admin-only renderer smoke test. Returns a PDF built from the locked
 * CCOS HTML template + a sample fully-formed body. Useful for verifying
 * the template renders correctly after CSS or template tweaks, BEFORE
 * burning an Anthropic API call to test end-to-end.
 *
 * Usage:
 *   - Sign into CCOS as an admin
 *   - Visit https://client-conversion-os.vercel.app/api/nutrition/v2/admin/test-pdf-render
 *   - Browser downloads the PDF; open it and visually compare against
 *     Jake_Ryan_7Day_Meal_Plan.pdf (the reference)
 *
 * This endpoint never touches the database, never calls Claude, never
 * uploads anything. Pure render-pipeline smoke test.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  buildSampleBodyForTesting,
  wrapAsFullHtml,
} from "@/lib/nutrition/plan-pdf-template";
import { renderHtmlToPdf } from "@/lib/nutrition/render-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  try {
    const body = buildSampleBodyForTesting();
    const html = wrapAsFullHtml(body, "Jake");
    const pdf = await renderHtmlToPdf(html);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="ccos-render-test.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[test-pdf-render] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
