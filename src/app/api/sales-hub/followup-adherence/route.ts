import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFollowupAdherence } from "@/lib/sales-hub/followup-adherence";

// Walking every conversation in the range takes a few seconds of headroom.
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

  // Any registry client key is accepted; unknown keys return empty metrics.
  const client = searchParams.get("client") || "all";
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (!dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "dateFrom and dateTo query params are required" },
      { status: 400 },
    );
  }

  try {
    const result = await getFollowupAdherence({ client, dateFrom, dateTo });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Follow-up adherence error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load follow-up adherence" },
      { status: 500 },
    );
  }
}
