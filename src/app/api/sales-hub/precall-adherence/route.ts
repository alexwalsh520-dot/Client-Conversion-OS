import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPrecallAdherence } from "@/lib/sales-hub/precall-adherence";

// Score pull + appointment join + a sheet fetch — give it headroom.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const cronSecret = process.env.CRON_SECRET?.trim();
  const secretOk = Boolean(cronSecret) && searchParams.get("secret") === cronSecret;
  if (!secretOk) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  if (!dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "dateFrom and dateTo query params are required" },
      { status: 400 },
    );
  }

  try {
    const result = await getPrecallAdherence({ dateFrom, dateTo });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Pre-call adherence error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load pre-call adherence" },
      { status: 500 },
    );
  }
}
