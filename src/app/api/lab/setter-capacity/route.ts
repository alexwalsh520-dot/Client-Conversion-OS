import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  SETTER_CAPACITY_CONFIG_KEY,
  getSetterCapacityConfig,
  normalizeSetterCapacityConfig,
  type SetterCapacityConfig,
} from "@/lib/lab/setter-capacity";

export const dynamic = "force-dynamic";

// GET: current setter capacity config (manager-editable caps via the gear icon).
// Falls back to the default (100 leads/day per setter) when nothing is saved yet.
export async function GET() {
  try {
    const config = await getSetterCapacityConfig();
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    console.error("[lab/setter-capacity] GET failed", error);
    // Never break the gate — hand back the safe default.
    return NextResponse.json({
      ok: true,
      config: normalizeSetterCapacityConfig(null),
      note: "Returned default capacity; reading saved config failed.",
    });
  }
}

// POST: upsert the manager-edited capacity config. Body matches SetterCapacityConfig.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let config: SetterCapacityConfig;
  try {
    config = normalizeSetterCapacityConfig(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid capacity config" },
      { status: 400 },
    );
  }

  try {
    const db = getServiceSupabase();
    const { error } = await db
      .from("lab_config")
      .upsert(
        {
          key: SETTER_CAPACITY_CONFIG_KEY,
          value: config,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );

    if (error) {
      console.error("[lab/setter-capacity] upsert failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, config });
  } catch (error) {
    console.error("[lab/setter-capacity] POST failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save config" },
      { status: 500 },
    );
  }
}
