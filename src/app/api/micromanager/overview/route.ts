// Micromanager overview: one day of sales-manager visibility for Alex only.
// Calls (with review status), admin-work %, per-setter day stats, adherence rollups.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchSheetData } from "@/lib/google-sheets";
import { getSetterReportData } from "@/lib/setter-report-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OWNER_EMAIL = "alexwalsh520@gmail.com";

// Same internal-meeting patterns the Sales Hub uses to keep huddles out of the call list.
const INTERNAL_TITLE_PATTERNS = [
  "sales team huddle", "c suite", "management", "setter connect", "training", "interview", "1:1", "huddle",
];

function etDateOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (session?.user?.email?.toLowerCase() !== OWNER_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = req.nextUrl.searchParams.get("date") || todayEt();
  const sb = getServiceSupabase();

  // Widen the query window by a day each side, then pin rows to the ET date.
  const from = new Date(`${date}T00:00:00Z`);
  const lo = new Date(from.getTime() - 36 * 3600 * 1000).toISOString();
  const hi = new Date(from.getTime() + 60 * 3600 * 1000).toISOString();

  const [callsRes, reviewsRes, scriptsRes, sheetRows, setterReport, eodRes, dmReviewRes, closerRollupRes] =
    await Promise.all([
      sb.from("fathom_calls")
        .select("fathom_id,title,recorded_at,duration_sec,prospect_name,attendees")
        .gte("recorded_at", lo).lt("recorded_at", hi)
        .order("recorded_at", { ascending: true }),
      sb.from("mm_call_reviews").select("fathom_id,grade,adherence_score,closer,outcome,prospect_name").gte("created_at", lo),
      sb.from("mm_scripts").select("role,content,updated_at"),
      fetchSheetData(date, date).catch(() => []),
      getSetterReportData(date).catch(() => null),
      sb.from("eod_reports").select("submitted_by,date").gte("date", etDateOf(new Date(from.getTime() - 14 * 86400e3).toISOString())).lte("date", date),
      sb.from("mm_dm_reviews").select("setter_name,adherence_score").gte("created_at", new Date(from.getTime() - 30 * 86400e3).toISOString()),
      sb.from("mm_call_reviews").select("closer,grade,adherence_score,call_date").gte("call_date", etDateOf(new Date(from.getTime() - 30 * 86400e3).toISOString())),
    ]);

  // ---- Calls for the day (sales calls only), joined with their reviews ----
  const reviewByFathomId: Record<string, { grade: number | null; adherence_score: number | null; closer: string | null; outcome: string | null; prospect_name: string | null }> = {};
  for (const r of reviewsRes.data || []) reviewByFathomId[r.fathom_id as string] = r;
  // Reviews can exist for calls outside the created_at window (upserts); fetch any missing ones for today's ids.
  const dayCalls = (callsRes.data || []).filter((c) => {
    if (etDateOf(c.recorded_at as string) !== date) return false;
    const t = String(c.title || "").toLowerCase();
    return !INTERNAL_TITLE_PATTERNS.some((p) => t.includes(p));
  });
  const missingIds = dayCalls.map((c) => c.fathom_id as string).filter((id) => !reviewByFathomId[id]);
  if (missingIds.length) {
    const { data: extra } = await sb.from("mm_call_reviews")
      .select("fathom_id,grade,adherence_score,closer,outcome,prospect_name").in("fathom_id", missingIds);
    for (const r of extra || []) reviewByFathomId[r.fathom_id as string] = r;
  }
  const calls = dayCalls.map((c) => {
    const r = reviewByFathomId[c.fathom_id as string];
    return {
      fathomId: c.fathom_id,
      time: c.recorded_at,
      title: c.title,
      prospect: r?.prospect_name || c.prospect_name || c.title,
      closer: r?.closer || null,
      outcome: r?.outcome || null,
      durationMin: c.duration_sec ? Math.round((c.duration_sec as number) / 60) : null,
      grade: r?.grade ?? null,
      adherence: r?.adherence_score ?? null,
      reviewed: !!r,
    };
  });

  // ---- Admin work % ----
  // Component 1: sales tracker completeness — key fields filled on today's taken calls.
  const takenRows = (sheetRows || []).filter((r) => r.callTaken && r.programLength !== "Subscription");
  const FIELDS = ["closer", "setter", "outcome", "callLength", "callNotes"] as const;
  let filled = 0;
  for (const row of takenRows) for (const f of FIELDS) if (String(row[f] ?? "").trim()) filled++;
  const trackerTotal = takenRows.length * FIELDS.length;
  const trackerPct = trackerTotal > 0 ? Math.round((filled / trackerTotal) * 100) : 100;

  // Component 2: EOD reports — submitted today vs everyone who submitted in the trailing 14 days.
  const eodRows = eodRes.data || [];
  const expected = new Set(eodRows.map((r) => String(r.submitted_by)));
  const submittedToday = new Set(eodRows.filter((r) => String(r.date) === date).map((r) => String(r.submitted_by)));
  const eodPct = expected.size > 0 ? Math.round((submittedToday.size / expected.size) * 100) : 100;

  // Blend only components that had anything to grade (empty denominator = perfect, never dragging).
  const activeParts: number[] = [];
  if (trackerTotal > 0) activeParts.push(trackerPct);
  if (expected.size > 0) activeParts.push(eodPct);
  const adminPct = activeParts.length ? Math.round(activeParts.reduce((a, b) => a + b, 0) / activeParts.length) : 100;

  // ---- Setters (day) ----
  const setters = (setterReport?.setters || []).map((s) => ({
    name: s.setterName,
    client: s.clientLabel,
    leads: s.daily.newLeads,
    booked: s.daily.booked,
    bookingRate: s.daily.newLeads > 0 ? Math.round((s.daily.booked / s.daily.newLeads) * 1000) / 10 : null,
    avgResponseMin: s.daily.averageResponseMinutes,
    responseSamples: s.daily.responseSampleCount,
  }));
  const totalLeads = setters.reduce((a, s) => a + s.leads, 0);
  const totalBooked = setters.reduce((a, s) => a + s.booked, 0);
  let respWeighted = 0, respSamples = 0;
  for (const s of setters) {
    if (s.avgResponseMin != null && s.responseSamples > 0) {
      respWeighted += s.avgResponseMin * s.responseSamples;
      respSamples += s.responseSamples;
    }
  }

  // ---- Adherence rollups (trailing 30 days) ----
  const closerAdh: Record<string, { scores: number[]; grades: number[] }> = {};
  for (const r of closerRollupRes.data || []) {
    const name = String(r.closer || "").trim();
    if (!name) continue;
    closerAdh[name] = closerAdh[name] || { scores: [], grades: [] };
    if (typeof r.adherence_score === "number") closerAdh[name].scores.push(r.adherence_score);
    if (typeof r.grade === "number") closerAdh[name].grades.push(r.grade);
  }
  const setterAdh: Record<string, number[]> = {};
  for (const r of dmReviewRes.data || []) {
    const name = String(r.setter_name || "").trim();
    if (!name || typeof r.adherence_score !== "number") continue;
    (setterAdh[name] = setterAdh[name] || []).push(r.adherence_score);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

  return NextResponse.json({
    date,
    calls,
    admin: {
      pct: adminPct,
      tracker: { pct: trackerTotal > 0 ? trackerPct : null, filled, total: trackerTotal, rows: takenRows.length },
      eod: { pct: expected.size > 0 ? eodPct : null, submitted: submittedToday.size, expected: expected.size },
    },
    setters,
    day: {
      calls: calls.length,
      leads: totalLeads,
      booked: totalBooked,
      bookingRate: totalLeads > 0 ? Math.round((totalBooked / totalLeads) * 1000) / 10 : null,
      avgResponseMin: respSamples > 0 ? Math.round((respWeighted / respSamples) * 10) / 10 : null,
      responseSamples: respSamples,
    },
    adherence: {
      closers: Object.entries(closerAdh).map(([name, v]) => ({ name, adherence: avg(v.scores), grade: avg(v.grades), calls: v.grades.length || v.scores.length })),
      setters: Object.entries(setterAdh).map(([name, scores]) => ({ name, adherence: avg(scores), convos: scores.length })),
    },
    scripts: {
      closer: !!(scriptsRes.data || []).find((s) => s.role === "closer" && String(s.content).trim()),
      setter: !!(scriptsRes.data || []).find((s) => s.role === "setter" && String(s.content).trim()),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
