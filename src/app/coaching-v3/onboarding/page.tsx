/**
 * Coaching V3 · Onboarding tab.
 *
 * Sections (MAS 2026-09-17 trim — dropped Scheduled and No-shows,
 * Nicole tracks those in Google Calendar + the Backlog Tracker):
 *  - Recently Onboarded (client onboarded in last 14 days)
 *  - Upcoming from Nicole's Google Calendar (next 14 days)
 *  - Unlinked intake forms
 *  - Backlog Tracker (spreadsheet-like, editable inline for Nicole+admins)
 *  - Refunds & Cancellations (read-only view of Nicole's sheet)
 *  - "New Client" button in the header
 *
 * Data is loaded server-side and handed to the client component so the
 * page renders cold-start without a request waterfall. Nicole's calendar
 * feed and the refunds sheet come from existing V1 endpoints; V3 reuses
 * them until Phase 6 moves the endpoints under a V3 namespace.
 */

import { getServiceSupabase } from "@/lib/supabase";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { fetchFinancials } from "@/lib/coaching-v2/financials";
import { headers } from "next/headers";
import OnboardingView from "./OnboardingView";

export const dynamic = "force-dynamic";

const NICOLE_EMAIL = "nicolettaokpala@gmail.com";

interface ClientRosterRow {
  id: number;
  name: string;
  email: string;
  phone_number: string | null;
  coach_name: string | null;
  program: string | null;
  offer: string | null;
  start_date: string | null;
  end_date: string | null;
  onboarding_date: string | null;
  onboarding_status: string | null;
  amount_paid: number | null;
  sales_person: string | null;
  payment_platform: string | null;
  sales_fathom_link: string | null;
  status: string;
  nutrition_form_id: number | null;
}

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  clientName: string;
  status: string;
}

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");
  const userEmail = (session.user.email ?? "").toLowerCase();
  const isAdmin = session.user.role === "admin";
  const canEditBacklog = isAdmin || userEmail === NICOLE_EMAIL;

  const db = getServiceSupabase();

  const [clientsQ, backlogQ, nutritionFormsQ, coachesQ] = await Promise.all([
    db
      .from("clients")
      .select(
        "id, name, email, phone_number, coach_name, program, offer, start_date, end_date, onboarding_date, onboarding_status, amount_paid, sales_person, payment_platform, sales_fathom_link, status, nutrition_form_id",
      )
      .neq("status", "deleted")
      .order("start_date", { ascending: false }),
    db
      .from("onboarding_backlog")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    db
      .from("nutrition_intake_forms")
      .select("id, first_name, last_name, email, phone, timestamp")
      .order("timestamp", { ascending: false })
      .limit(500),
    db.from("clients").select("coach_name").eq("status", "active"),
  ]);

  const clients = (clientsQ.data ?? []) as ClientRosterRow[];
  const backlog = (backlogQ.data ?? []) as Record<string, unknown>[];
  const nutritionForms = (nutritionFormsQ.data ?? []) as {
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    timestamp: string | null;
  }[];

  // Unlinked forms = forms whose id isn't referenced by any client's
  // nutrition_form_id AND submitted on/after 2026-04-01 (the same cutoff
  // Nutrition uses so old junk doesn't clutter).
  const linkedFormIds = new Set<number>();
  for (const c of clients) if (c.nutrition_form_id) linkedFormIds.add(c.nutrition_form_id);
  const CUTOFF = new Date("2026-04-01T00:00:00Z").getTime();
  const unlinkedForms = nutritionForms
    .filter((f) => !linkedFormIds.has(f.id))
    .filter((f) => f.timestamp && new Date(f.timestamp).getTime() >= CUTOFF)
    .map((f) => ({
      id: f.id,
      firstName: (f.first_name ?? "").trim(),
      lastName: (f.last_name ?? "").trim(),
      email: (f.email ?? "").trim(),
      phone: (f.phone ?? "").trim(),
      submittedAt: f.timestamp,
    }));

  // Distinct active coaches (for the New Client form's coach dropdown).
  const coachSet = new Set<string>();
  for (const r of (coachesQ.data ?? []) as { coach_name: string | null }[]) {
    const n = (r.coach_name ?? "").trim();
    if (n) coachSet.add(n);
  }
  const activeCoaches = [...coachSet].sort((a, b) => a.localeCompare(b));

  // Load calendar (next 14 days) and refunds (this month) via V1
  // endpoints, forwarding this session's cookie. Wrapped so a hiccup on
  // either doesn't take the whole page down.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const cookie = h.get("cookie") ?? "";
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const endIso = new Date(today.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  let calendarEvents: CalendarEvent[] = [];
  let calendarErr: string | null = null;
  try {
    const res = await fetch(
      `${proto}://${host}/api/coaching/calendar?start=${todayIso}&end=${endIso}`,
      { headers: { cookie }, cache: "no-store" },
    );
    const body = await res.json();
    if (res.ok) calendarEvents = (body.events ?? []) as CalendarEvent[];
    else calendarErr = body.error ?? `HTTP ${res.status}`;
  } catch (e) {
    calendarErr = e instanceof Error ? e.message : String(e);
  }

  const monthIndex = today.getMonth();
  const finance = await fetchFinancials(monthIndex);

  // Compact client directory for the LinkFormsPanel's in-memory search.
  // No coaching-client search endpoint exists — the panel does substring
  // matching against this slim slice (a few hundred rows at most).
  const clientDirectory = clients
    .filter((c) => c.status === "active")
    .map((c) => ({ id: c.id, name: c.name, email: c.email ?? "" }));

  // Slice clients into the sections legacy shows.
  const now = Date.now();
  const daysSince = (dateStr: string | null) => {
    if (!dateStr) return null;
    const t = Date.parse(dateStr);
    if (!Number.isFinite(t)) return null;
    return Math.floor((now - t) / 86_400_000);
  };

  const recentlyOnboarded = clients
    .filter((c) => c.status === "active")
    .filter((c) => {
      const d = daysSince(c.onboarding_date ?? c.start_date);
      return d !== null && d >= 0 && d <= 14;
    })
    .sort((a, b) => (b.onboarding_date ?? b.start_date ?? "").localeCompare(a.onboarding_date ?? a.start_date ?? ""));

  return (
    <OnboardingView
      viewer={{ isAdmin, canEditBacklog, email: userEmail }}
      recentlyOnboarded={recentlyOnboarded.map(mapClient)}
      calendarEvents={calendarEvents}
      calendarErr={calendarErr}
      backlog={backlog}
      activeCoaches={activeCoaches}
      clientDirectory={clientDirectory}
      unlinkedForms={unlinkedForms}
      refunds={finance.refunds.map((r) => ({
        clientName: r.clientName,
        date: r.date,
        type: r.type,
        amount: r.amount,
        reason: r.reason,
        salesPerson: r.salesPerson,
      }))}
      financeError={finance.error ?? null}
    />
  );
}

function mapClient(c: ClientRosterRow) {
  return {
    id: c.id,
    name: c.name,
    email: c.email ?? "",
    phone: c.phone_number ?? "",
    coach: c.coach_name ?? "",
    program: c.program ?? "",
    offer: c.offer ?? "",
    startDate: c.start_date ?? "",
    endDate: c.end_date ?? "",
    onboardingDate: c.onboarding_date ?? "",
    onboardingStatus: c.onboarding_status ?? "",
    amountPaid: Number(c.amount_paid) || 0,
    salesPerson: c.sales_person ?? "",
    paymentPlatform: c.payment_platform ?? "",
    salesFathomLink: c.sales_fathom_link ?? "",
  };
}
