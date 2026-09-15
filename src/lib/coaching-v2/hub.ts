/**
 * Coaching Hub v2 — read model.
 *
 * Builds one HubClient per client from tables the app already has
 * (clients, coach_milestones, coach_meetings, client_check_ins,
 * client_notes, everfit_inbox_conversations/messages). No schema
 * changes, no writes. Every screen in /coaching-v2 reads from here.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { auth } from "@/auth";
import { listKnownCoaches } from "@/lib/nutrition/coach-resolver";

export type Level = "r" | "a" | "g";
export const LEVEL_LABEL: Record<Level, string> = { r: "At risk", a: "Watch", g: "On track" };
const LEVEL_ORDER: Record<Level, number> = { r: 0, a: 1, g: 2 };

export interface Signal {
  lvl: Level;
  label: string;
  value: string;
}

export interface Ask {
  key: "written" | "video" | "extension" | "referral";
  label: string;
  field: "trustPilotCompleted" | "videoTestimonialCompleted" | "retentionCompleted" | "referralCompleted";
  done: boolean;
  doneDate: string | null;
  asked: boolean;
  askedDate: string | null;
  dueDate: string | null;
  dueDays: number | null;
}

export interface CheckIn {
  id: number;
  submittedAt: string;
  daysAgo: number;
  score: number;
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  text: string;
}

export interface Msg {
  at: string; // ISO
  daysAgo: number;
  sender: "client" | "coach";
  text: string;
}

export interface HubClient {
  id: number;
  name: string;
  coach: string;
  program: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  days: number | null;
  stage: "Onboarding" | "Active" | "Ending soon" | "Needs a decision" | "Completed";
  paid: number;
  closer: string;
  platform: string;
  salesLink: string;
  onboardingLink: string;
  onboardingDate: string | null;
  onboardingStatus: string | null;
  nutritionStatus: string;
  nutritionWaitDays: number | null;
  checkins: CheckIn[];
  latestCheckin: CheckIn | null;
  score: number | null;
  lastCheckDays: number | null;
  lastMeetDays: number | null;
  meetings: { date: string; minutes: number; notes: string; link: string | null }[];
  notes: { at: string; text: string; by: string }[];
  convoId: string | null;
  messages: Msg[];
  lastClientMsgDays: number | null;
  lastCoachMsgDays: number | null;
  owedDays: number | null;
  coachRepliedAfterCheckin: boolean | null;
  asks: Ask[];
  milestoneId: number | null;
  retention: { nextStep: string | null; note: string | null; noteAt: string | null };
  signals: Signal[];
  health: Level;
  lead: Signal | null;
}

export interface Viewer {
  email: string;
  name: string;
  isAdmin: boolean;
  /** Internal coach name when the signed in person is a coach, else null (manager view). */
  coach: string | null;
}

export interface Hub {
  viewer: Viewer;
  clients: HubClient[]; // every client the viewer may see (active + completed)
  active: HubClient[];
  coaches: string[];
  inboxCapturedAt: string | null;
  today: string; // YYYY-MM-DD
}

// ---------- date helpers ----------
const DAY = 86400000;
function todayUtc(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function dateOnlyUtc(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
function daysFromToday(s: string | null | undefined): number | null {
  const t = dateOnlyUtc(s);
  if (t === null) return null;
  return Math.round((t - todayUtc()) / DAY);
}
function daysAgoIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / DAY));
}
function addDays(s: string | null, n: number): string | null {
  const t = dateOnlyUtc(s);
  if (t === null) return null;
  return new Date(t + n * DAY).toISOString().slice(0, 10);
}
export function fmtDay(s: string | null | undefined): string {
  const t = dateOnlyUtc(s ?? null);
  if (t === null) return "–";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
export function fmtDayYear(s: string | null | undefined): string {
  const t = dateOnlyUtc(s ?? null);
  if (t === null) return "–";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
export function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
export function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Everfit stores "Sunday, 06 Sep 2026" and "03:17 PM" (time may be empty). */
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseEverfit(date: string | null, time: string | null, fallback: string | null): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(date ?? "");
  if (!m) return fallback;
  let h = 12, min = 0;
  const t = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time ?? "");
  if (t) {
    h = +t[1] % 12 + (t[3].toUpperCase() === "PM" ? 12 : 0);
    min = +t[2];
  }
  const mo = MONTHS[m[2].toLowerCase()];
  if (mo === undefined) return fallback;
  return new Date(Date.UTC(+m[3], mo, +m[1], h, min)).toISOString();
}

// ---------- viewer ----------
export async function getViewer(): Promise<Viewer | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  const isAdmin = session?.user?.role === "admin";
  const name = session?.user?.name ?? email;
  if (isAdmin) return { email, name, isAdmin, coach: null };
  // A coach is matched by the roster email first, then by their app_users name.
  const known = listKnownCoaches().find((c) => c.email.toLowerCase() === email);
  if (known) return { email, name, isAdmin, coach: known.internal };
  return { email, name, isAdmin, coach: null };
}

// ---------- load ----------
export async function loadHub(): Promise<Hub | null> {
  const viewer = await getViewer();
  if (!viewer) return null;
  const db = getServiceSupabase();

  const [clientsQ, milestonesQ, meetingsQ, checkinsQ, notesQ, convosQ, msgsQ, usersQ] = await Promise.all([
    db.from("clients").select("id, name, coach_name, program, status, start_date, end_date, amount_paid, sales_person, payment_platform, sales_fathom_link, onboarding_fathom_link, onboarding_date, onboarding_status, nutrition_status, nutrition_assigned_at, nutrition_form_id, created_at"),
    db.from("coach_milestones").select("*"),
    db.from("coach_meetings").select("client_id, client_name, coach_name, meeting_date, duration_minutes, notes, fathom_link").order("meeting_date", { ascending: false }),
    db.from("client_check_ins").select("id, client_id, client_name, coach_name, q1_overall, q2_strength, q3_lifestyle, q4_progress, q5_open_response, score_0_100, submitted_at").order("submitted_at", { ascending: false }),
    db.from("client_notes").select("client_name, coach_name, note, created_at").order("created_at", { ascending: false }),
    db.from("everfit_inbox_conversations").select("everfit_id, name, coach_name, client_id, last_captured_at"),
    db.from("everfit_inbox_messages").select("everfit_id, message_id, sender, text, date, time, observed_at"),
    viewer.coach ? Promise.resolve({ data: null }) : db.from("app_users").select("name").eq("email", viewer.email).maybeSingle(),
  ]);

  // If the roster did not know this coach, try their app_users name against coach names.
  let coachFilter = viewer.coach;
  if (!viewer.isAdmin && !coachFilter) {
    const userName = (usersQ as { data: { name?: string } | null }).data?.name ?? "";
    const coachNames = new Set((clientsQ.data ?? []).map((c) => norm(c.coach_name)));
    if (userName && coachNames.has(norm(userName))) coachFilter = userName;
  }
  const viewerOut: Viewer = { ...viewer, coach: coachFilter };

  // ---- index side tables ----
  const msByName = new Map<string, Record<string, unknown>>();
  for (const m of milestonesQ.data ?? []) msByName.set(norm(m.client_name as string), m);

  const meetByName = new Map<string, HubClient["meetings"]>();
  for (const m of meetingsQ.data ?? []) {
    const k = norm(m.client_name as string);
    const list = meetByName.get(k) ?? [];
    list.push({ date: (m.meeting_date as string) ?? "", minutes: Number(m.duration_minutes) || 0, notes: (m.notes as string) ?? "", link: (m.fathom_link as string) ?? null });
    meetByName.set(k, list);
  }

  const ciByName = new Map<string, CheckIn[]>();
  for (const r of checkinsQ.data ?? []) {
    const k = norm(r.client_name as string);
    const list = ciByName.get(k) ?? [];
    list.push({
      id: r.id as number,
      submittedAt: r.submitted_at as string,
      daysAgo: daysAgoIso(r.submitted_at as string) ?? 0,
      score: Number(r.score_0_100) || 0,
      q1: Number(r.q1_overall) || 0,
      q2: Number(r.q2_strength) || 0,
      q3: Number(r.q3_lifestyle) || 0,
      q4: Number(r.q4_progress) || 0,
      text: ((r.q5_open_response as string) ?? "").trim(),
    });
    ciByName.set(k, list);
  }

  const notesByName = new Map<string, HubClient["notes"]>();
  for (const n of notesQ.data ?? []) {
    const k = norm(n.client_name as string);
    const list = notesByName.get(k) ?? [];
    list.push({ at: n.created_at as string, text: (n.note as string) ?? "", by: (n.coach_name as string) ?? "" });
    notesByName.set(k, list);
  }

  const convoByName = new Map<string, { id: string; coach: string | null; captured: string | null }>();
  let inboxCapturedAt: string | null = null;
  for (const c of convosQ.data ?? []) {
    const k = norm(c.name as string);
    if (!convoByName.has(k)) convoByName.set(k, { id: c.everfit_id as string, coach: (c.coach_name as string) ?? null, captured: (c.last_captured_at as string) ?? null });
    const cap = c.last_captured_at as string | null;
    if (cap && (!inboxCapturedAt || cap > inboxCapturedAt)) inboxCapturedAt = cap;
  }
  const msgsByConvo = new Map<string, Msg[]>();
  for (const m of msgsQ.data ?? []) {
    const at = parseEverfit(m.date as string, m.time as string, m.observed_at as string);
    if (!at) continue;
    const list = msgsByConvo.get(m.everfit_id as string) ?? [];
    list.push({ at, daysAgo: daysAgoIso(at) ?? 0, sender: (m.sender as string) === "client" ? "client" : "coach", text: ((m.text as string) ?? "").trim() });
    msgsByConvo.set(m.everfit_id as string, list);
  }
  for (const list of msgsByConvo.values()) list.sort((a, b) => b.at.localeCompare(a.at));

  // ---- build ----
  const clients: HubClient[] = [];
  for (const row of clientsQ.data ?? []) {
    const name = (row.name as string) ?? "";
    const k = norm(name);
    const coach = (row.coach_name as string) ?? "";
    const status = (row.status as string) ?? "active";
    const startDate = (row.start_date as string) ?? null;
    const endDate = (row.end_date as string) ?? null;
    const days = daysFromToday(endDate);

    const ms = msByName.get(k);
    const asks: Ask[] = [
      mkAsk("written", "Written testimonial", "trustPilotCompleted", ms, "trust_pilot", addDays(startDate, 7)),
      mkAsk("video", "Video testimonial", "videoTestimonialCompleted", ms, "video_testimonial", addDays(endDate, -20)),
      mkAsk("extension", "Extension", "retentionCompleted", ms, "retention", addDays(endDate, -14)),
      mkAsk("referral", "Referral", "referralCompleted", ms, "referral", addDays(endDate, -7)),
    ];
    const extension = asks[2];

    const checkins = ciByName.get(k) ?? [];
    const latest = checkins[0] ?? null;
    const meetings = meetByName.get(k) ?? [];
    const lastMeetDays = meetings.length ? Math.max(0, -(daysFromToday(meetings[0].date) ?? 0)) : null;
    const notes = notesByName.get(k) ?? [];

    const convoRow = convoByName.get(k) ?? null;
    const messages = convoRow ? msgsByConvo.get(convoRow.id) ?? [] : [];
    const convo = convoRow && messages.length ? convoRow : null;
    const lastClient = messages.find((m) => m.sender === "client") ?? null;
    const lastCoach = messages.find((m) => m.sender === "coach") ?? null;
    const owedDays = lastClient && (!lastCoach || lastCoach.at < lastClient.at) ? lastClient.daysAgo : null;
    const coachRepliedAfterCheckin = latest ? messages.some((m) => m.sender === "coach" && m.at > latest.submittedAt) : null;

    let nutritionStatus = (row.nutrition_status as string) ?? "";
    let nutritionWaitDays = nutritionStatus === "pending" || nutritionStatus === "assigned"
      ? Math.max(0, -(daysFromToday(((row.nutrition_assigned_at as string) ?? (row.onboarding_date as string) ?? startDate ?? null)?.slice(0, 10) ?? null) ?? 0))
      : null;
    // Rows pending for over 30 days are stale bookkeeping; the Nutrition tab treats them as done.
    if (nutritionWaitDays !== null && nutritionWaitDays > 30) { nutritionWaitDays = null; nutritionStatus = "done"; }

    const ret = notes.find((n) => /^retention/i.test(n.text)) ?? null;
    let nextStep: string | null = null;
    let retNote: string | null = null;
    if (ret) {
      const parts = ret.text.split("·").map((p) => p.trim());
      nextStep = parts[1] || null;
      retNote = parts.slice(2).join(" · ") || null;
    }

    // ---- stage ----
    let stage: HubClient["stage"] = "Active";
    const startAgo = startDate ? -(daysFromToday(startDate) ?? 0) : null;
    if (status !== "active") stage = "Completed";
    else if (days !== null && days < 0) stage = "Needs a decision";
    else if (days !== null && days <= 14) stage = "Ending soon";
    else if ((row.onboarding_status as string) !== "onboarded" || (startAgo !== null && startAgo <= 7)) stage = "Onboarding";

    // ---- signals ----
    const signals: Signal[] = [];
    if (status === "active") {
      if (days !== null && days < 0 && extension.done) signals.push({ lvl: "a", label: "Program", value: `Extended, but the end date still reads ${-days} day${-days === 1 ? "" : "s"} ago` });
      else if (days !== null && days < 0) signals.push({ lvl: "r", label: "Program", value: `Ended ${-days} day${-days === 1 ? "" : "s"} ago, no decision recorded` });
      else if (days !== null && days <= 14 && !extension.done && !extension.asked) signals.push({ lvl: "a", label: "Program", value: `Ends in ${days} day${days === 1 ? "" : "s"}, extension not asked` });
      else if (days !== null) signals.push({ lvl: "g", label: "Program", value: `${days} days left` });

      if (!convo) signals.push({ lvl: "g", label: "Messages", value: "No Everfit conversation matched yet" });
      else if (owedDays !== null && owedDays >= 2) signals.push({ lvl: "r", label: "Messages", value: `Client waiting ${owedDays} days for a reply` });
      else if (owedDays === 1) signals.push({ lvl: "a", label: "Messages", value: "Client waiting 1 day for a reply" });
      else if (lastClient && lastClient.daysAgo >= 7) signals.push({ lvl: "a", label: "Messages", value: `Client quiet for ${lastClient.daysAgo} days` });
      else if (lastClient) signals.push({ lvl: "g", label: "Messages", value: `Last message ${lastClient.daysAgo} day${lastClient.daysAgo === 1 ? "" : "s"} ago` });
      else signals.push({ lvl: "g", label: "Messages", value: "No client messages captured" });

      if (latest) {
        if (latest.score < 60) signals.push({ lvl: "r", label: "Check in score", value: `${latest.score} out of 100` });
        else if (latest.score < 75) signals.push({ lvl: "a", label: "Check in score", value: `${latest.score} out of 100` });
        else signals.push({ lvl: "g", label: "Check in score", value: `${latest.score} out of 100` });
        if (latest.daysAgo > 21) signals.push({ lvl: "a", label: "Check in", value: `None for ${latest.daysAgo} days` });
        else signals.push({ lvl: "g", label: "Check in", value: `${latest.daysAgo} day${latest.daysAgo === 1 ? "" : "s"} ago` });
      } else signals.push({ lvl: "g", label: "Check in", value: "None yet" });

      const contact = [lastMeetDays, lastCoach?.daysAgo ?? null].filter((x): x is number => x !== null);
      const contactDays = contact.length ? Math.min(...contact) : null;
      if (contactDays === null) signals.push({ lvl: "a", label: "Coach contact", value: "No call or message on record" });
      else if (contactDays > 28) signals.push({ lvl: "a", label: "Coach contact", value: `None for ${contactDays} days` });
      else signals.push({ lvl: "g", label: "Coach contact", value: `${contactDays} day${contactDays === 1 ? "" : "s"} ago` });

      if (nutritionWaitDays !== null) {
        if (nutritionWaitDays >= 7) signals.push({ lvl: "r", label: "Nutrition plan", value: `Waiting ${nutritionWaitDays} days` });
        else if (nutritionWaitDays >= 4) signals.push({ lvl: "a", label: "Nutrition plan", value: `Waiting ${nutritionWaitDays} days` });
        else signals.push({ lvl: "g", label: "Nutrition plan", value: `Waiting ${nutritionWaitDays} days` });
      } else if (nutritionStatus === "done") signals.push({ lvl: "g", label: "Nutrition plan", value: "Delivered" });
    }
    signals.sort((a, b) => LEVEL_ORDER[a.lvl] - LEVEL_ORDER[b.lvl]);
    const health: Level = signals.some((s) => s.lvl === "r") ? "r" : signals.some((s) => s.lvl === "a") ? "a" : "g";
    const lead = signals.find((s) => s.lvl === health && s.lvl !== "g") ?? null;

    clients.push({
      id: row.id as number,
      name,
      coach,
      program: (row.program as string) ?? "",
      status,
      startDate,
      endDate,
      days,
      stage,
      paid: Number(row.amount_paid) || 0,
      closer: (row.sales_person as string) ?? "",
      platform: (row.payment_platform as string) ?? "",
      salesLink: (row.sales_fathom_link as string) ?? "",
      onboardingLink: (row.onboarding_fathom_link as string) ?? "",
      onboardingDate: (row.onboarding_date as string) ?? null,
      onboardingStatus: (row.onboarding_status as string) ?? null,
      nutritionStatus,
      nutritionWaitDays,
      checkins,
      latestCheckin: latest,
      score: latest?.score ?? null,
      lastCheckDays: latest?.daysAgo ?? null,
      lastMeetDays,
      meetings,
      notes,
      convoId: convo?.id ?? null,
      messages,
      lastClientMsgDays: lastClient?.daysAgo ?? null,
      lastCoachMsgDays: lastCoach?.daysAgo ?? null,
      owedDays,
      coachRepliedAfterCheckin,
      asks,
      milestoneId: (ms?.id as number) ?? null,
      retention: { nextStep, note: retNote, noteAt: ret?.at ?? null },
      signals,
      health,
      lead,
    });
  }

  const visible = viewerOut.coach ? clients.filter((c) => norm(c.coach) === norm(viewerOut.coach)) : clients;
  const active = visible.filter((c) => c.status === "active");
  const coaches = [...new Set(clients.filter((c) => c.status === "active" && c.coach).map((c) => c.coach))].sort();

  return { viewer: viewerOut, clients: visible, active, coaches, inboxCapturedAt, today: new Date(todayUtc()).toISOString().slice(0, 10) };
}

function mkAsk(
  key: Ask["key"],
  label: string,
  field: Ask["field"],
  ms: Record<string, unknown> | undefined,
  col: string,
  dueDate: string | null
): Ask {
  const done = !!ms?.[`${col}_completed`];
  const doneDate = (ms?.[`${col}_completion_date`] as string) ?? null;
  const askedDate = (ms?.[`${col}_prompted_date`] as string) ?? null;
  return { key, label, field, done, doneDate, asked: !!askedDate, askedDate, dueDate, dueDays: daysFromToday(dueDate) };
}

// ---------- shared derived views ----------
export function byHealth(a: HubClient, b: HubClient): number {
  return LEVEL_ORDER[a.health] - LEVEL_ORDER[b.health] || (a.days ?? 999) - (b.days ?? 999);
}

export interface CoachRow {
  coach: string;
  clients: number;
  atRisk: number;
  atRiskPct: number;
  coveragePct: number;
  owed: number;
  replyHours: number | null;
  retentionPct: number | null;
  pastEnd: number;
}

export function coachRows(active: HubClient[], coaches: string[]): CoachRow[] {
  return coaches.map((coach) => {
    const cs = active.filter((c) => norm(c.coach) === norm(coach));
    const atRisk = cs.filter((c) => c.health === "r").length;
    const covered = cs.filter((c) => (c.lastCheckDays ?? 99) <= 14 || (c.lastCoachMsgDays ?? 99) <= 14 || (c.lastMeetDays ?? 99) <= 14).length;
    const owed = cs.filter((c) => c.owedDays !== null && c.owedDays >= 1).length;
    // Reply time: client message -> next coach message, only where both carry a clock time.
    const gaps: number[] = [];
    for (const c of cs) {
      const asc = c.messages.slice().sort((x, y) => x.at.localeCompare(y.at));
      for (let i = 0; i < asc.length; i++) {
        if (asc[i].sender !== "client") continue;
        const next = asc.slice(i + 1).find((m) => m.sender === "coach");
        if (!next) continue;
        const h = (Date.parse(next.at) - Date.parse(asc[i].at)) / 3600000;
        if (h >= 0 && h < 24 * 14) gaps.push(h);
      }
    }
    gaps.sort((x, y) => x - y);
    const replyHours = gaps.length >= 3 ? Math.round(gaps[Math.floor(gaps.length / 2)]) : null;
    const ending = cs.filter((c) => c.days !== null && c.days <= 14 && c.days >= -30);
    const retentionPct = ending.length ? Math.round((100 * ending.filter((c) => c.asks[2].done).length) / ending.length) : null;
    return {
      coach,
      clients: cs.length,
      atRisk,
      atRiskPct: cs.length ? Math.round((100 * atRisk) / cs.length) : 0,
      coveragePct: cs.length ? Math.round((100 * covered) / cs.length) : 0,
      owed,
      replyHours,
      retentionPct,
      pastEnd: cs.filter((c) => c.days !== null && c.days < 0).length,
    };
  });
}
