import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { runAccuracyChecks } from "@/lib/accuracy/run";

// GET  reads STORED rows only. The page never computes a check at request time.
// POST is the manual "run now" button, which uses the exact same code path the
// daily cron uses, so the button can never produce a different kind of answer.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface StoredRow {
  run_id: string;
  et_day: string;
  check_key: string;
  plain_english_name: string;
  status: string;
  left_label: string | null;
  left_value: string | null;
  right_label: string | null;
  right_value: string | null;
  diff_value: string | null;
  tolerance_note: string | null;
  what_to_do: string | null;
  detail: Record<string, unknown> | null;
  ran_at: string;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = getServiceSupabase();
    const [{ data: latest, error: latestErr }, { data: history, error: historyErr }] =
      await Promise.all([
        db.rpc("warehouse_accuracy_latest_run"),
        db.rpc("warehouse_accuracy_history", { p_days: 30 }),
      ]);
    if (latestErr) throw new Error(latestErr.message);
    if (historyErr) throw new Error(historyErr.message);

    const rows = (latest || []) as StoredRow[];
    const counts = { green: 0, amber: 0, red: 0, error: 0 } as Record<string, number>;
    for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

    return NextResponse.json(
      {
        lastRunAt: rows.length ? rows[rows.length - 1].ran_at : null,
        etDay: rows.length ? rows[0].et_day : null,
        counts,
        rows,
        history: history || [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read accuracy rows" },
      { status: 500 },
    );
  }
}

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runAccuracyChecks();
    return NextResponse.json({ runId: result.runId, counts: result.counts, recorded: result.recorded });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "accuracy run failed" },
      { status: 500 },
    );
  }
}
