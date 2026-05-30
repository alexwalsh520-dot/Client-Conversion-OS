/**
 * GET /api/nutrition/v2/admin/test-generate-plan
 *     ?client_id=NNN        (precise lookup)
 *  OR ?name=Zach Glanz       (case-insensitive, fuzzy match — picks
 *                              the best single match; errors if many)
 *
 * End-to-end test of Pieces 1+2 of the auto meal-plan pipeline:
 *   1. Load the client's intake form + onboarding notes + macro targets
 *      from CCOS (same data the manual copy-prompt uses).
 *   2. Build the auto-pipeline prompt + attach reference PDFs.
 *   3. Call Anthropic to generate the HTML body.
 *   4. Wrap in the locked CCOS template + render to PDF.
 *   5. Return the PDF inline so the admin can download + visually
 *      review it without auto-uploading or pinging Slack.
 *
 * Admin-only. Manual run for any client. Does NOT mutate the client
 * row, does NOT mark the task done, does NOT post to Slack. Pure
 * preview.
 *
 * Examples:
 *   /api/nutrition/v2/admin/test-generate-plan?name=Zach%20Glanz
 *   /api/nutrition/v2/admin/test-generate-plan?client_id=1234
 *   /api/nutrition/v2/admin/test-generate-plan?name=Zach&stub=1
 *     (stub=1 short-circuits the LLM and uses the hardcoded sample
 *      body, useful for verifying the renderer alone.)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { loadIntakeAndComputeRawTargets } from "@/lib/nutrition/intake-targets";
import { adjustMacros } from "@/lib/nutrition/macro-adjust";
import { generatePlanHtml } from "@/lib/nutrition/generate-plan-html";
import {
  buildSampleBodyForTesting,
  wrapAsFullHtml,
} from "@/lib/nutrition/plan-pdf-template";
import { renderHtmlToPdf } from "@/lib/nutrition/render-pdf";

export const runtime = "nodejs";
// API call can take 60-120s; render adds another 5-10s. Budget high.
export const maxDuration = 300;

function formatGeneratedDateLabel(now: Date = new Date()): string {
  // PKT calendar date (UTC+5)
  const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return pkt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  // Accept either ?client_id=N or ?name=<partial name>. Name takes
  // priority since that's what coaches will actually type.
  const clientIdRaw = req.nextUrl.searchParams.get("client_id");
  const nameRaw = req.nextUrl.searchParams.get("name")?.trim();

  let clientId: number | null = null;
  const db = getServiceSupabase();

  if (nameRaw) {
    // Escape PostgREST `or` filter wildcards for the ilike lookup.
    const escaped = nameRaw.replace(/[%,]/g, "");
    const { data: matches, error } = await db
      .from("clients")
      .select("id, name")
      .ilike("name", `%${escaped}%`)
      .order("name", { ascending: true })
      .limit(10);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!matches || matches.length === 0) {
      return NextResponse.json(
        { error: `no client matches name "${nameRaw}"` },
        { status: 404 },
      );
    }
    if (matches.length > 1) {
      // Exact match wins over ambiguity
      const exact = matches.find(
        (m) => (m.name as string).toLowerCase() === nameRaw.toLowerCase(),
      );
      if (exact) {
        clientId = exact.id as number;
      } else {
        return NextResponse.json(
          {
            error: `multiple matches for "${nameRaw}" — narrow the name or use ?client_id=N`,
            matches: matches.map((m) => ({ id: m.id, name: m.name })),
          },
          { status: 400 },
        );
      }
    } else {
      clientId = matches[0].id as number;
    }
  } else if (clientIdRaw) {
    const parsed = parseInt(clientIdRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "invalid client_id" }, { status: 400 });
    }
    clientId = parsed;
  } else {
    return NextResponse.json(
      {
        error:
          "Provide ?name=Zach%20Glanz or ?client_id=1234. Example: /api/nutrition/v2/admin/test-generate-plan?name=Zach%20Glanz",
      },
      { status: 400 },
    );
  }

  // Optional: ?stub=1 short-circuits the LLM call and uses the
  // hardcoded sample body. Useful for verifying the renderer keeps
  // working independent of the LLM step.
  const useStub = req.nextUrl.searchParams.get("stub") === "1";

  try {
    const intake = await loadIntakeAndComputeRawTargets(db, clientId);
    if (!intake.ok) {
      return NextResponse.json({ error: intake.error }, { status: intake.status });
    }

    const targets = adjustMacros(intake.raw);

    // Look up coach name from clients table — intake helper only
    // returns intake row + parsed name. Coach lives on clients.
    const { data: clientRow } = await db
      .from("clients")
      .select("coach_name, name")
      .eq("id", clientId)
      .single();
    const coachInternalName = clientRow?.coach_name ?? null;
    const clientFullName = clientRow?.name ?? intake.clientName ?? "Client";

    const generatedDateLabel = formatGeneratedDateLabel();

    let bodyHtml: string;
    let stats = "stub";
    if (useStub) {
      bodyHtml = buildSampleBodyForTesting();
    } else {
      const result = await generatePlanHtml({
        intake,
        targets,
        coachInternalName,
        generatedDateLabel,
      });
      bodyHtml = result.bodyHtml;
      stats = `tokens in/out: ${result.inputTokens}/${result.outputTokens}`;
    }

    const firstName =
      String(intake.intake.first_name ?? "").trim() ||
      clientFullName.split(/\s+/)[0] ||
      "Client";
    const fullHtml = wrapAsFullHtml(bodyHtml, firstName);
    const pdf = await renderHtmlToPdf(fullHtml, {
      clientFullName,
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="ccos-${firstName}-test-plan.pdf"`,
        "Cache-Control": "no-store",
        "X-Generation-Stats": stats,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[test-generate-plan] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
