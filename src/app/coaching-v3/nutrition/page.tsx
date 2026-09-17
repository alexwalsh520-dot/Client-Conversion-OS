/**
 * Coaching V3 · Nutrition tab.
 *
 * Mirrors legacy Daman flow (MAS 2026-09-16) with V3-only surfaces:
 *   1. Unlinked intake forms — link to client + auto-connect
 *   2. Pending meal plans — Generate with AI, Push done, per-row V2 panel
 *   3. Done — same V2 panel, so a coach can generate a revision later
 *
 * Data is fetched server-side with the service key and reshaped to
 * camelCase before it reaches the client (so the reused V2 panel
 * components see exactly the same NutritionIntakeForm shape they see
 * in legacy). Reuses:
 *   · /components/coaching/nutrition-v2/NutritionV2TaskPanel
 *   · /components/coaching/nutrition-v2/GenerateWithAiButton
 *   · /components/coaching/nutrition-v2/PushDoneButton
 * These are current-generation shared components (Alex's v2 work),
 * not legacy Coaching UI. Phase 6 will decide whether V3 owns copies.
 */

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getServiceSupabase } from "@/lib/supabase";
import type { NutritionIntakeForm } from "@/lib/types";
import NutritionView from "./NutritionView";

export const dynamic = "force-dynamic";

// Match the legacy cutoff so historically-messy intake data doesn't
// pollute the Unlinked list. Anything before this date is out of scope.
const UNLINKED_CUTOFF_TS = new Date("2026-04-01T00:00:00Z").getTime();

// Fresh vs stale pending: 30 days after onboarding_date/start_date is
// the boundary legacy uses. Older tasks stay hidden unless the coach
// clicks "Show older".
const STALE_PENDING_DAYS = 30;

interface ClientRow {
  id: number;
  name: string;
  email: string | null;
  phone_number: string | null;
  coach_name: string | null;
  program: string | null;
  offer: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  onboarding_date: string | null;
  nutrition_form_id: number | null;
  nutrition_status: string | null;
  nutrition_assigned_to: string | null;
  nutrition_assigned_at: string | null;
  nutrition_completed_at: string | null;
  nutrition_checklist_allergies: boolean | null;
  nutrition_checklist_everfit: boolean | null;
  nutrition_checklist_message: boolean | null;
}

interface FormRow {
  id: number;
  timestamp: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  age: number | null;
  height: string | null;
  current_weight: string | null;
  goal_weight: string | null;
  fitness_goal: string | null;
  foods_enjoy: string | null;
  foods_avoid: string | null;
  allergies: string | null;
  protein_preferences: string | null;
  can_cook: string | null;
  meal_count: string | null;
  medications: string | null;
  supplements: string | null;
  sleep_hours: string | null;
  water_intake: string | null;
  daily_meals_description: string | null;
  daily_meals_description_2: string | null;
  medical_supervision_yn: string | null;
  medical_supervision_detail: string | null;
  diet_plan_sent: string | null;
  created_at: string | null;
}

function toForm(r: FormRow): NutritionIntakeForm {
  return {
    id: r.id,
    timestamp: r.timestamp,
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    address: r.address ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    zipCode: r.zip_code ?? "",
    age: r.age,
    height: r.height ?? "",
    currentWeight: r.current_weight ?? "",
    goalWeight: r.goal_weight ?? "",
    fitnessGoal: r.fitness_goal ?? "",
    foodsEnjoy: r.foods_enjoy ?? "",
    foodsAvoid: r.foods_avoid ?? "",
    allergies: r.allergies ?? "",
    proteinPreferences: r.protein_preferences ?? "",
    canCook: r.can_cook ?? "",
    mealCount: r.meal_count ?? "",
    medications: r.medications ?? "",
    supplements: r.supplements ?? "",
    sleepHours: r.sleep_hours ?? "",
    waterIntake: r.water_intake ?? "",
    dailyMealsDescription: r.daily_meals_description ?? "",
    dailyMealsDescription2: r.daily_meals_description_2 ?? "",
    medicalSupervisionYn: r.medical_supervision_yn ?? "",
    medicalSupervisionDetail: r.medical_supervision_detail ?? "",
    dietPlanSent: r.diet_plan_sent ?? "",
    createdAt: r.created_at ?? undefined,
  };
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export default async function NutritionPage() {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");
  const userEmail = (session.user.email ?? "").toLowerCase();
  const isAdmin = session.user.role === "admin";

  const db = getServiceSupabase();
  const [clientsQ, formsQ] = await Promise.all([
    db
      .from("clients")
      .select(
        "id, name, email, phone_number, coach_name, program, offer, status, start_date, end_date, onboarding_date, nutrition_form_id, nutrition_status, nutrition_assigned_to, nutrition_assigned_at, nutrition_completed_at, nutrition_checklist_allergies, nutrition_checklist_everfit, nutrition_checklist_message",
      )
      .neq("status", "deleted"),
    db
      .from("nutrition_intake_forms")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(1000),
  ]);

  const clients = (clientsQ.data ?? []) as ClientRow[];
  const forms = (formsQ.data ?? []) as FormRow[];

  // Slim client directory for the LinkFormsPanel's in-memory search.
  const clientDirectory = clients
    .filter((c) => c.status === "active")
    .map((c) => ({ id: c.id, name: c.name, email: c.email ?? "" }));

  // Unlinked forms = every form id NOT referenced by any client. Legacy
  // and V3 both keep pre-2026-04-01 rows in the pool but hide them by
  // default (see NutritionView's "show older" toggle) — those legacy
  // rows aren't worth chasing but occasionally still get resurfaced.
  const linkedFormIds = new Set<number>();
  for (const c of clients) if (c.nutrition_form_id) linkedFormIds.add(c.nutrition_form_id);
  const unlinkedForms = forms
    .filter((f) => !linkedFormIds.has(f.id))
    .map((f) => ({
      id: f.id,
      firstName: (f.first_name ?? "").trim(),
      lastName: (f.last_name ?? "").trim(),
      email: (f.email ?? "").trim(),
      phone: (f.phone ?? "").trim(),
      submittedAt: f.timestamp,
      isOld:
        !f.timestamp || new Date(f.timestamp).getTime() < UNLINKED_CUTOFF_TS,
    }));

  // Pending clients — active, has intake form linked, status is 'pending'
  // or 'assigned'. Split fresh vs stale on daysSince(onboarding||start).
  const formById = new Map<number, NutritionIntakeForm>();
  for (const f of forms) formById.set(f.id, toForm(f));

  const pendingRaw = clients.filter(
    (c) =>
      c.nutrition_form_id != null &&
      (c.nutrition_status === "pending" || c.nutrition_status === "assigned"),
  );
  const doneRaw = clients.filter(
    (c) => c.nutrition_form_id != null && c.nutrition_status === "done",
  );

  const shape = (c: ClientRow) => ({
    id: c.id,
    name: c.name,
    email: c.email ?? "",
    coach: c.coach_name ?? "",
    program: c.program ?? "",
    status: c.status,
    startDate: c.start_date ?? "",
    onboardingDate: c.onboarding_date ?? "",
    daysSinceOnboarding: daysSince(c.onboarding_date ?? c.start_date),
    nutritionFormId: c.nutrition_form_id,
    nutritionStatus: c.nutrition_status ?? "",
    nutritionAssignedTo: c.nutrition_assigned_to ?? "",
    nutritionAssignedAt: c.nutrition_assigned_at ?? "",
    nutritionCompletedAt: c.nutrition_completed_at ?? "",
    intakeForm: c.nutrition_form_id ? formById.get(c.nutrition_form_id) ?? null : null,
  });

  const pending = pendingRaw
    .map(shape)
    .sort((a, b) => b.daysSinceOnboarding - a.daysSinceOnboarding);
  const done = doneRaw
    .map(shape)
    .sort((a, b) =>
      (b.nutritionCompletedAt || "").localeCompare(a.nutritionCompletedAt || ""),
    );

  return (
    <NutritionView
      viewer={{ isAdmin, email: userEmail }}
      unlinkedForms={unlinkedForms}
      clientDirectory={clientDirectory}
      pending={pending}
      done={done}
      stalePendingDays={STALE_PENDING_DAYS}
    />
  );
}
