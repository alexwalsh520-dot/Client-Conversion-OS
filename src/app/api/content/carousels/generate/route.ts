import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getCurrentIcp } from "@/lib/buyer-dna/icp";
import type { Icp } from "@/lib/buyer-dna/icp";
import { generateCarouselSet } from "@/lib/buyer-dna/carousels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "claude-sonnet-4-6";

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

function todayET(): string {
  // YYYY-MM-DD in America/New_York (en-CA formats as ISO date).
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// Generate the day's 5 carousels for one creator with EXACTLY ONE LLM call. If the day already has its
// 5 rows, they are returned untouched — never regenerated.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const slug = (url.searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  const dateParam = url.searchParams.get("date");
  const forDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || "") ? (dateParam as string) : todayET();
  // Opt-in override for a deliberate re-run (e.g. the day's first set came out off-brief). Off by
  // default, so the daily cron and every existing caller behave exactly as before. Overwrites the
  // day's rows IN PLACE via the same upsert below — it never deletes anything.
  const force = url.searchParams.get("force") === "1";

  const sb = getServiceSupabase();

  // No-regeneration guard: if the day's 5 rows already exist, return them as-is (no LLM call) —
  // unless force=1 asks for a fresh set.
  const { data: existing } = await sb
    .from("content_carousels")
    .select("*")
    .eq("client_key", slug)
    .eq("for_date", forDate)
    .order("slot", { ascending: true });
  if (!force && existing && existing.length >= 5) {
    return NextResponse.json({ ok: true, creator: slug, date: forDate, generated: false, carousels: existing });
  }

  const current = await getCurrentIcp(sb, slug);
  const icp = current ? ((current as { icp: Icp }).icp) : null;
  const res = await generateCarouselSet(sb, slug, forDate, icp, new Anthropic());
  if (!res.ok) return NextResponse.json({ ok: false, creator: slug, date: forDate, reason: res.reason }, { status: 200 });

  const rows = res.carousels.map((c, i) => ({
    client_key: slug,
    for_date: forDate,
    slot: i,
    topic: c.topic || null,
    slides: c.slides.map((s) => ({ text: s.text || "" })),
    model: MODEL,
    updated_at: new Date().toISOString(),
  }));
  // Upsert on the unique (client_key, for_date, slot) so a partial prior run can't collide.
  const { data: inserted, error } = await sb
    .from("content_carousels")
    .upsert(rows, { onConflict: "client_key,for_date,slot" })
    .select("*");
  if (error) return NextResponse.json({ ok: false, creator: slug, date: forDate, reason: error.message }, { status: 200 });

  const ordered = (inserted || []).sort((a, b) => (a as { slot: number }).slot - (b as { slot: number }).slot);
  // sentence_violations > 0 means the model couldn't get every slide under the 4-sentence cap even
  // after the retry; the copy is kept in full (never truncated) and the count is surfaced.
  return NextResponse.json({ ok: true, creator: slug, date: forDate, generated: true, sentence_violations: res.sentenceViolations, carousels: ordered });
}
