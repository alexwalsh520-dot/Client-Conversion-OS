/**
 * Per-creator content-compliance recap — posts to #a-sales-manager at 12:30 AM ET.
 *
 * NOTE: the original per-closer / per-setter SALES metrics were retired at the
 * owner's request (2026-07). Only the content-compliance lines (reels / carousels /
 * story vs target, per creator) remain — that feature is kept live here. The
 * dormant sales-metrics builders still live in `@/lib/daily-report/team` if needed.
 *
 * Scheduled at 04:30 and 05:30 UTC; runs only when it's 12:30 AM ET (DST-correct).
 * `?force=1` ignores the gate; `?dry=1` returns the message without posting.
 *
 * Auth: x-vercel-cron header OR Bearer CRON_SECRET (standard CCOS cron pattern).
 */

import { NextRequest, NextResponse } from "next/server";
import { etHour } from "@/lib/daily-report/time";
import { postAsCso } from "@/lib/slack";
import { getServiceSupabase } from "@/lib/supabase";
import { ACTIVE_CREATORS } from "@/lib/creators";
import { complianceForDay, streakEndingOn } from "@/lib/content/calendar-reconcile";
import { getCadence } from "@/lib/content/calendar-build";
import { shiftDay, todayIn } from "@/lib/content/calendar";

export const runtime = "nodejs";
export const maxDuration = 300;

const TARGET_ET_HOUR = 0; // 12:30 AM ET (cron minute :30 pins the time)

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const auth = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`);
}


// One calendar-compliance line per creator, appended to the daily team recap. Counts come from the
// SAME derivation the Calendar grid uses, for the creator's own previous local day, so the number in
// Slack and the number on the grid can never disagree.
async function complianceLines(): Promise<string> {
  try {
    const sb = getServiceSupabase();
    const lines: string[] = [];
    for (const c of ACTIVE_CREATORS) {
      const cadence = await getCadence(sb, c.key);
      const day = shiftDay(todayIn(cadence.timezone), -1); // yesterday, locally
      const [comp, streak] = await Promise.all([
        complianceForDay(sb, c.key, day),
        streakEndingOn(sb, c.key, day),
      ]);
      const bits = [`${comp.reels.done}/${comp.reels.target} reels ${comp.reels.done >= comp.reels.target ? "\u2713" : "\u2717"}`];
      if (comp.carousels.target > 0) {
        bits.push(`${comp.carousels.done}/${comp.carousels.target} carousels ${comp.carousels.done >= comp.carousels.target ? "\u2713" : "\u2717"}`);
      }
      // Stories are manual-only (never policed), so the recap reports checked ones and stays
      // silent otherwise instead of implying a miss.
      if (comp.story?.done) bits.push("story \u2713");
      // How much of that "done" rests on the creator's word with no post found to back it.
      const claimed = comp.claimed > 0 ? ` (${comp.claimed} claimed, unverified)` : "";
      lines.push(`*${c.name} content:* ${bits.join(" \u00b7 ")} (streak ${streak})${claimed}`);
    }
    return lines.length ? `\n\n${lines.join("\n")}` : "";
  } catch {
    return ""; // the recap must never fail because the calendar had a bad day
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const dry = url.searchParams.get("dry") === "1";
  const atParam = url.searchParams.get("at");
  const now = atParam && !Number.isNaN(Date.parse(atParam)) ? new Date(atParam) : new Date();

  if (!force && etHour(now) !== TARGET_ET_HOUR) {
    return NextResponse.json({ skipped: true, reason: `ET hour ${etHour(now)} != ${TARGET_ET_HOUR}` });
  }

  // Sales recap + closer/setter metrics retired (owner request) — post only the
  // per-creator content-compliance lines. Strip the leading spacer they carried
  // when they were appended to the sales metrics.
  const text = (await complianceLines()).replace(/^\n+/, "");

  if (dry) {
    return NextResponse.json({ dry: true, text });
  }

  if (!text.trim()) {
    return NextResponse.json({ skipped: true, reason: "no content-compliance to post" });
  }

  const posted = await postAsCso(text);
  return NextResponse.json({ posted });
}
