import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// Live source for the CMO tab. Reads the brain's state straight from Supabase at
// request time so the frontend reflects whatever the CMO has written, with no deploy.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLES = [
  ["cmo_open_loops", "loops"],
  ["cmo_learning_feed", "feed"],
  ["cmo_impact", "ledger"],
  ["cmo_meetings", "meetings"],
  ["cmo_docs", "docs"],
] as const;

export async function GET() {
  const out: Record<string, unknown[]> = { loops: [], feed: [], ledger: [], meetings: [], docs: [] };
  try {
    const sb = getServiceSupabase();
    await Promise.all(
      TABLES.map(async ([table, key]) => {
        const { data, error } = await sb.from(table).select("data").order("position", { ascending: true });
        if (!error && Array.isArray(data)) out[key] = data.map((r: { data: unknown }) => r.data);
      })
    );
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ...out, error: String(e) }, { headers: { "Cache-Control": "no-store" } });
  }
}
