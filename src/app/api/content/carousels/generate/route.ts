import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getCurrentIcp } from "@/lib/buyer-dna/icp";
import type { Icp } from "@/lib/buyer-dna/icp";
import { generateCarouselSet } from "@/lib/buyer-dna/carousels";
import { getCadence } from "@/lib/content/calendar-build";
import { CAROUSELS_PER_DAY, intentForSlot } from "@/lib/content/carousel-config";
import { postToSlack, getSalesManagerChannel } from "@/lib/slack";
import { auditAudience } from "@/lib/buyer-dna/audience-audit";

// An external content worker, when one is configured, owns midnight → 06:00 in the creator's own
// timezone and CCOS only steps in after 06:00. That handoff exists ONLY for a worker that is
// actually wired up: with no EXTERNAL_CONTENT_API_KEY set there is nothing to wait for, so internal
// generation owns midnight again and the day populates on the first tick after local midnight.
// force=1 (a deliberate human re-run) bypasses the window either way.
function localHour(tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date())) % 24;
}
const EXTERNAL_WINDOW_END_HOUR = 6;
const externalWorkerConfigured = () => !!process.env.EXTERNAL_CONTENT_API_KEY?.trim();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "claude-sonnet-4-6";

// The audit rejected the set. Nothing was stored, so the day keeps whatever it already had — but a
// silent rejection is how off-audience content shipped unnoticed in the first place.
async function alertIcpAudit(creator: string, what: string, reason: string, test = false) {
  const channel = getSalesManagerChannel();
  if (!channel) return;
  const tag = test ? "[TEST] " : "";
  await postToSlack(channel, `${tag}:rotating_light: *ICP audit failed for ${creator}* — ${what} rejected, needs eyes.\n${reason}`).catch(() => {});
}

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

  // audit_only=1 — run the audience audit against the day's ALREADY STORED set and report. No
  // generation, no writes. This is how a suspect day gets re-checked after the fact, and it is the
  // same audit + alert path a live run uses.
  if (url.searchParams.get("audit_only") === "1") {
    const { data: stored } = await sb
      .from("content_carousels")
      .select("slot, topic, slides")
      .eq("client_key", slug)
      .eq("for_date", forDate)
      .order("slot", { ascending: true });
    const rows = (stored || []) as { slot: number; topic: string | null; slides: { text?: string }[] }[];
    if (!rows.length) return NextResponse.json({ ok: false, creator: slug, date: forDate, reason: "nothing stored for that day" }, { status: 200 });
    const verdict = await auditAudience(
      slug,
      rows.map((r) => ({ label: `carousel ${r.slot + 1}`, text: [r.topic || "", (r.slides || [])[0]?.text || ""].filter(Boolean).join("\n") })),
      new Anthropic(),
    );
    if (!verdict.ok) {
      await alertIcpAudit(slug, `stored carousels (${forDate})`, verdict.offAudience.map((o) => `${o.label} — ${o.why}`).join("; "), url.searchParams.get("test") === "1");
    }
    return NextResponse.json({ ok: true, creator: slug, date: forDate, mode: "audit_only", icp_audit: verdict });
  }

  // No-regeneration guard: if the day's 5 rows already exist, return them as-is (no LLM call) —
  // unless force=1 asks for a fresh set.
  const { data: existing } = await sb
    .from("content_carousels")
    .select("*")
    .eq("client_key", slug)
    .eq("for_date", forDate)
    .order("slot", { ascending: true });
  if (!force && existing && existing.length >= CAROUSELS_PER_DAY) {
    return NextResponse.json({ ok: true, creator: slug, date: forDate, generated: false, carousels: existing });
  }

  // Fallback window: only when an external worker is actually configured. Otherwise there is nobody
  // to hand midnight to, and deferring would just leave the day empty until 06:00.
  if (!force && externalWorkerConfigured()) {
    const { timezone } = await getCadence(sb, slug);
    if (localHour(timezone) < EXTERNAL_WINDOW_END_HOUR) {
      return NextResponse.json({ ok: true, creator: slug, date: forDate, generated: false, deferred: true, reason: `before ${EXTERNAL_WINDOW_END_HOUR}:00 ${timezone} — external worker window` });
    }
  }

  const current = await getCurrentIcp(sb, slug);
  const icp = current ? ((current as { icp: Icp }).icp) : null;
  const res = await generateCarouselSet(sb, slug, forDate, icp, new Anthropic());
  if (!res.ok) {
    // An audience failure is categorically different from a generation failure: the model produced
    // content for the wrong person. Refuse the write, keep the day as it was, and say so out loud.
    if (res.audit && !res.audit.ok) {
      await alertIcpAudit(slug, `today's carousels (${forDate})`, res.reason, url.searchParams.get("test") === "1");
      return NextResponse.json({ ok: false, creator: slug, date: forDate, reason: res.reason, icp_audit: res.audit, stored: false }, { status: 200 });
    }
    return NextResponse.json({ ok: false, creator: slug, date: forDate, reason: res.reason }, { status: 200 });
  }

  const rows = res.carousels.map((c, i) => ({
    client_key: slug,
    for_date: forDate,
    slot: i,
    topic: c.topic || null,
    slides: c.slides.map((s) => ({ text: s.text || "" })),
    // This is CCOS's own generation — stamp provenance so a force-regen over an external day
    // correctly reclaims it as internal (and clears any external meta). The origin/meta columns
    // arrive with a migration; if they're not there yet we retry without them below.
    origin: "internal",
    // The day's fixed split, stamped from the slot so the tag describes what actually shipped rather
    // than what the model called it. Cleared of any external meta by the same write.
    meta: { intent: intentForSlot(i) },
    model: MODEL,
    updated_at: new Date().toISOString(),
  }));
  // Upsert on the unique (client_key, for_date, slot) so a partial prior run can't collide.
  let { data: inserted, error } = await sb
    .from("content_carousels")
    .upsert(rows, { onConflict: "client_key,for_date,slot" })
    .select("*");
  if (error && /origin|meta/i.test(error.message)) {
    const bare = rows.map(({ origin: _o, meta: _m, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
    ({ data: inserted, error } = await sb.from("content_carousels").upsert(bare, { onConflict: "client_key,for_date,slot" }).select("*"));
  }
  if (error) return NextResponse.json({ ok: false, creator: slug, date: forDate, reason: error.message }, { status: 200 });

  // The day's set is a replacement, not a merge. If the daily count has shrunk since this day was
  // last generated, the higher slots are superseded copy from the old cadence — left in place they
  // would render alongside the new set in the old format. Scoped strictly to the one creator+date we
  // just wrote; every other day keeps whatever it was generated with.
  await sb
    .from("content_carousels")
    .delete()
    .eq("client_key", slug)
    .eq("for_date", forDate)
    .gte("slot", rows.length);

  const ordered = (inserted || []).sort((a, b) => (a as { slot: number }).slot - (b as { slot: number }).slot);
  // sentence_violations > 0 means the model couldn't get every slide under the 4-sentence cap even
  // after the retry; the copy is kept in full (never truncated) and the count is surfaced.
  return NextResponse.json({ ok: true, creator: slug, date: forDate, generated: true, dashes_fixed: res.dashesFixed, icp_audit: res.audit, sentence_violations: res.sentenceViolations, style_violations: res.styleViolations, carousels: ordered });
}
