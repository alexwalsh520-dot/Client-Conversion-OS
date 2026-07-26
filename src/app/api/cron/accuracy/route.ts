import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runAccuracyChecks } from "@/lib/accuracy/run";

// The daily accuracy run. Offset from the nightly Ads v2 self-check (07:45 UTC)
// and from the hourly sync (:25) so the two never overlap and so the saved
// answers have already been rebuilt from the freshest spend before anything is
// compared against them.
//
// Every check inside runs isolated, with its own budget and its own try/catch.
// One broken check shows as its own red or errored row and never stops the rest.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  const isCron = secret === process.env.CRON_SECRET;
  const session = isCron ? null : await auth();
  if (!isCron && !session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runAccuracyChecks();
    return NextResponse.json({
      runId: result.runId,
      etDay: result.etDay,
      counts: result.counts,
      recorded: result.recorded,
      rows: result.rows.map((r) => ({
        check: r.check_key,
        status: r.status,
        left: `${r.left_label}: ${r.left_value}`,
        right: `${r.right_label}: ${r.right_value}`,
        diff: r.diff_value,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "accuracy run failed" },
      { status: 500 },
    );
  }
}
