import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { DEFAULT_STORY_SCHEDULE, DOW, type StorySchedule } from "@/lib/content/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const creator = (new URL(req.url).searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  }
  const sb = getServiceSupabase();
  const { data } = await sb.from("content_cadences").select("*").eq("client_key", creator).maybeSingle();
  const row = data as { reels_per_day?: number; carousels_per_day?: number; story_schedule?: StorySchedule } | null;
  return NextResponse.json({
    creator,
    reels_per_day: row?.reels_per_day ?? 6,
    carousels_per_day: row?.carousels_per_day ?? 1,
    story_schedule: row?.story_schedule && Object.keys(row.story_schedule).length ? row.story_schedule : DEFAULT_STORY_SCHEDULE,
  });
}

// Normalize an incoming story schedule to exactly mon..sun with {label} or null.
function cleanSchedule(input: unknown): StorySchedule {
  const out: StorySchedule = {};
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  for (const d of DOW) {
    const v = obj[d];
    if (v && typeof v === "object" && typeof (v as { label?: unknown }).label === "string" && (v as { label: string }).label.trim()) {
      out[d] = { label: (v as { label: string }).label.trim().slice(0, 200) };
    } else {
      out[d] = null; // missing / cleared / non-string label = rest day
    }
  }
  return out;
}

export async function PUT(req: NextRequest) {
  const s = await auth().catch(() => null);
  if (!s?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const creator = String(body?.creator || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  }
  const reels = Math.max(0, Math.min(20, Math.round(Number(body?.reels_per_day)) || 0));
  const carousels = Math.max(0, Math.min(20, Math.round(Number(body?.carousels_per_day)) || 0));
  const schedule = cleanSchedule(body?.story_schedule);

  const sb = getServiceSupabase();
  const { error } = await sb.from("content_cadences").upsert(
    { client_key: creator, reels_per_day: reels, carousels_per_day: carousels, story_schedule: schedule, updated_at: new Date().toISOString() },
    { onConflict: "client_key" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, creator, reels_per_day: reels, carousels_per_day: carousels, story_schedule: schedule });
}
