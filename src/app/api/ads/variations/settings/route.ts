/**
 * Variations Factory — live-editable settings.
 *
 * GET  /api/ads/variations/settings
 *   Response 200:
 *     {
 *       "settings": {
 *         "variationsPerJob": 10,
 *         "mix": { "background": 6, "highlightWord": 2, "copyTweak": 2 },
 *         "provider": "openai",
 *         "enabled": true
 *       }
 *     }
 *
 * PUT  /api/ads/variations/settings
 *   Body (any subset; missing fields fall back to current/defaults):
 *     {
 *       "variationsPerJob"?: number,            // derived from mix; mix is source of truth
 *       "mix"?: { "background": number, "highlightWord": number, "copyTweak": number },
 *       "provider"?: string,                    // "openai" (default)
 *       "enabled"?: boolean
 *     }
 *   Response 200: { "settings": <normalized settings, mix guaranteed to sum to variationsPerJob> }
 *   Response 400: { "error": "invalid JSON body" }
 *   Response 401: { "error": "unauthorized" }
 *
 * Notes for the UI:
 *  - The engine treats `mix` as the source of truth; `variationsPerJob` is the
 *    sum of the three mix values. The server re-derives it, so you can drive the
 *    UI off `mix` and show `variationsPerJob` as a read-only total.
 *  - Values are clamped server-side (each mix entry >= 0, total capped at 20).
 *    A submitted empty mix is replaced with the default mix.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSettings, saveSettings } from "@/lib/ads-variations/settings";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Merge onto the current settings so a partial PUT only changes what it sends.
  const current = await getSettings();
  const merged = { ...current, ...(body && typeof body === "object" ? body : {}) };

  try {
    const settings = await saveSettings(merged, session.user.email);
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to save settings" },
      { status: 500 }
    );
  }
}
