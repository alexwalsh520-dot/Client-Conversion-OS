// Data access layer for CCOS
// Queries Supabase with automatic fallback to mock data
// Used by page components via useAsyncData hook

import { supabase } from "./supabase";
import * as mock from "./mock-data";
import type {
  CoachingFeedbackEntry,
  OnboardingEntry,
  SalesData,
  CloserStat,
  SetterStat,
  AdsDayEntry,
} from "./mock-data";
import type {
  Client,
  CoachMilestone,
  ProgramPause,
  CoachMeeting,
  CoachEODReport,
  EODClientCheckin,
  FinanceRecord,
  Expense,
  NutritionIntakeForm,
} from "./types";

// ---- Coaching Feedback ----

export async function getCoachingFeedback(): Promise<CoachingFeedbackEntry[]> {
  try {
    const { data, error } = await supabase
      .from("coaching_feedback")
      .select("*")
      .order("date", { ascending: false });

    if (error || !data?.length) throw error || new Error("No coaching data");

    return data.map((row) => ({
      timestamp: row.timestamp || "",
      name: row.client_name,
      coachRating: row.coach_rating,
      workoutCompletion: row.workout_completion || "Yes",
      missedReason: row.missed_reason || "",
      sleepRating: row.sleep_rating,
      nutritionRating: row.nutrition_rating,
      energyRating: row.energy_rating,
      npsScore: row.nps_score,
      feedback: row.feedback || "",
      wins: row.wins || "",
      coachName: row.coach_name,
      date: row.date || "",
    }));
  } catch {
    console.warn("[data] Coaching feedback: falling back to mock data");
    return mock.coachingFeedback;
  }
}

// ---- Onboarding ----

export async function getOnboardingTracker(): Promise<OnboardingEntry[]> {
  try {
    const { data, error } = await supabase
      .from("onboarding_tracker")
      .select("*");

    if (error || !data?.length) throw error || new Error("No onboarding data");

    return data.map((row) => ({
      onboarder: row.onboarder,
      client: row.client,
      email: row.email || "",
      closer: row.closer || "",
      amountPaid: Number(row.amount_paid) || 0,
      pif:
        row.pif === "true" ? true : row.pif === "false" ? false : row.pif || "",
      rescheduleEmailSent: row.reschedule_email_sent || false,
      reminderEmail: row.reminder_email || false,
      reachOutCloser: row.reach_out_closer || false,
      comments: row.comments || "",
      status: row.status || "pending",
    }));
  } catch {
    console.warn("[data] Onboarding tracker: falling back to mock data");
    return mock.onboardingTracker;
  }
}

// ---- Sales Data ----

export async function getSalesData(): Promise<SalesData> {
  try {
    const { data: closers, error: e1 } = await supabase
      .from("sales_closer_stats")
      .select("*");

    if (e1 || !closers?.length) throw e1 || new Error("No closer stats");

    // Aggregate closer stats across months
    const closerMap = new Map<string, CloserStat>();
    for (const row of closers) {
      const existing = closerMap.get(row.closer_name) || {
        name: row.closer_name,
        callsBooked: 0,
        callsTaken: 0,
        closed: 0,
        revenue: 0,
      };
      existing.callsBooked += row.calls_booked || 0;
      existing.callsTaken += row.calls_taken || 0;
      existing.closed += row.closed || 0;
      existing.revenue += Number(row.revenue) || 0;
      closerMap.set(row.closer_name, existing);
    }

    const closerStats = Array.from(closerMap.values());
    const totalCallsBooked = closerStats.reduce(
      (s, c) => s + c.callsBooked,
      0
    );
    const liveCallsCompleted = closerStats.reduce(
      (s, c) => s + c.callsTaken,
      0
    );
    const totalWon = closerStats.reduce((s, c) => s + c.closed, 0);
    const revenueTotal = closerStats.reduce((s, c) => s + c.revenue, 0);
    const totalLost = totalCallsBooked - totalWon;

    // Approximate cash values (can be refined with more sheet data)
    const cashRatio = revenueTotal > 0 ? 0.7 : 0;

    return {
      totalCallsBooked,
      liveCallsCompleted,
      totalWon,
      totalLost: Math.max(0, totalLost),
      revenueTotal,
      totalCash: revenueTotal * cashRatio,
      cashOnCalls: revenueTotal * 0.6,
      subscriptions: revenueTotal * 0.1,
      closerStats,
    };
  } catch {
    console.warn("[data] Sales data: falling back to mock data");
    return mock.salesData;
  }
}

// ---- Setter Stats ----

export async function getSetterStats(): Promise<SetterStat[]> {
  try {
    const { data, error } = await supabase
      .from("sales_setter_stats")
      .select("*");

    if (error || !data?.length) throw error || new Error("No setter stats");

    return data.map((row) => ({
      name: row.setter_name,
      messagesHandled: row.messages_handled || 0,
      callsBooked: row.calls_booked || 0,
      conversionRate: Number(row.conversion_rate) || 0,
      source: (row.source as "keith" | "tyson") || "tyson",
    }));
  } catch {
    console.warn("[data] Setter stats: falling back to mock data");
    return mock.setterStats;
  }
}

// ---- Ads Daily ----

export async function getAdsDaily(
  source?: "tyson" | "keith"
): Promise<AdsDayEntry[]> {
  try {
    let query = supabase
      .from("ads_daily")
      .select("*")
      .order("date", { ascending: true });

    if (source) query = query.eq("source", source);

    const { data, error } = await query;
    if (error || !data?.length) throw error || new Error("No ads data");

    return data.map((row) => ({
      date: row.date,
      adSpend: Number(row.ad_spend) || 0,
      impressions: row.impressions || 0,
      cpi: Number(row.cpi) || 0,
      linkClicks: row.link_clicks || 0,
      ctr: Number(row.ctr) || 0,
      cpc: Number(row.cpc) || 0,
      messages: row.messages || 0,
      costPerMessage: Number(row.cost_per_message) || 0,
      calls60Booked: row.calls_60_booked || 0,
      costPer60Booked: Number(row.cost_per_60_booked) || 0,
      calls60Taken: row.calls_60_taken || 0,
      showUp60Pct: Number(row.show_up_60_pct) || 0,
      newClients: row.new_clients || 0,
      closeRate: Number(row.close_rate) || 0,
      msgConversionRate: Number(row.msg_conversion_rate) || 0,
      contractedRevenue: Number(row.contracted_revenue) || 0,
      collectedRevenue: Number(row.collected_revenue) || 0,
      costPerClient: Number(row.cost_per_client) || 0,
      contractedROI: Number(row.contracted_roi) || 0,
      collectedROI: Number(row.collected_roi) || 0,
    }));
  } catch {
    console.warn("[data] Ads daily: falling back to mock data");
    return mock.adsData;
  }
}

// ---- Ads Aggregates (computed from daily data) ----
// Returns the same shape as mock.adPerformance:
// { keith: { spend, impressions, clicks, leads, cpl, ctr, cpc, roas, revenue }, tyson: {...} }

export async function getAdPerformance(): Promise<typeof mock.adPerformance> {
  try {
    const tysonData = await getAdsDaily("tyson");
    const keithData = await getAdsDaily("keith");

    // If we got mock data back (fallback), just return mock aggregates
    if (tysonData === mock.adsData || keithData === mock.adsData) {
      return mock.adPerformance;
    }

    const aggregate = (data: AdsDayEntry[]) => {
      const spend = data.reduce((s, d) => s + d.adSpend, 0);
      const impressions = data.reduce((s, d) => s + d.impressions, 0);
      const clicks = data.reduce((s, d) => s + d.linkClicks, 0);
      const leads = data.reduce((s, d) => s + d.messages, 0);
      const revenue = data.reduce((s, d) => s + d.contractedRevenue, 0);

      return {
        spend,
        impressions,
        clicks,
        leads,
        cpl: leads > 0 ? spend / leads : 0,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        roas: spend > 0 ? revenue / spend : 0,
        revenue,
      };
    };

    return {
      keith: aggregate(keithData),
      tyson: aggregate(tysonData),
    };
  } catch {
    return mock.adPerformance;
  }
}

// ---- Clients (master roster) ----

export async function getClients(): Promise<Client[]> {
  try {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !data?.length) throw error || new Error("No client data");

    return data.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email || "",
      coachName: row.coach_name || "",
      program: row.program || "",
      offer: row.offer || "",
      startDate: row.start_date || "",
      endDate: row.end_date || "",
      onboardingDate: row.onboarding_date || null,
      onboardingStatus: row.onboarding_status || null,
      status: row.status || "active",
      paymentPlatform: row.payment_platform || "",
      salesFathomLink: row.sales_fathom_link || "",
      onboardingFathomLink: row.onboarding_fathom_link || "",
      amountPaid: Number(row.amount_paid) || 0,
      salesPerson: row.sales_person || "",
      comments: row.comments || "",
      phoneNumber: row.phone_number || "",
      nutritionFormId: row.nutrition_form_id || null,
      nutritionStatus: row.nutrition_status || "",
      nutritionAssignedTo: row.nutrition_assigned_to || "",
      nutritionAssignedAt: row.nutrition_assigned_at || null,
      nutritionCompletedAt: row.nutrition_completed_at || null,
      nutritionChecklistAllergies: row.nutrition_checklist_allergies || false,
      nutritionChecklistEverfit: row.nutrition_checklist_everfit || false,
      nutritionChecklistMessage: row.nutrition_checklist_message || false,
      createdAt: row.created_at,
    }));
  } catch {
    console.warn("[data] Clients: falling back to mock data");
    return mock.mockClients;
  }
}

// ---- Coach Milestones ----

export async function getMilestones(): Promise<CoachMilestone[]> {
  try {
    const { data, error } = await supabase
      .from("coach_milestones")
      .select("*");

    if (error || !data?.length) throw error || new Error("No milestone data");

    return data.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      clientName: row.client_name,
      coachName: row.coach_name,
      trustPilotPromptedDate: row.trust_pilot_prompted_date,
      trustPilotCompleted: row.trust_pilot_completed || false,
      trustPilotCompletionDate: row.trust_pilot_completion_date,
      videoTestimonialPromptedDate: row.video_testimonial_prompted_date,
      videoTestimonialCompleted: row.video_testimonial_completed || false,
      videoTestimonialCompletionDate: row.video_testimonial_completion_date,
      retentionPromptedDate: row.retention_prompted_date,
      retentionCompleted: row.retention_completed || false,
      retentionCompletionDate: row.retention_completion_date,
      referralPromptedDate: row.referral_prompted_date,
      referralCompleted: row.referral_completed || false,
      referralCompletionDate: row.referral_completion_date,
    }));
  } catch {
    console.warn("[data] Milestones: falling back to mock data");
    return mock.mockMilestones;
  }
}

// ---- Milestone Activity Log ----

export interface MilestoneActivity {
  id: number;
  milestoneId: number;
  clientName: string;
  coachName: string;
  field: string;
  newStatus: string;
  changedBy: string;
  createdAt: string;
}

export async function getMilestoneActivity(): Promise<MilestoneActivity[]> {
  try {
    const { data, error } = await supabase
      .from("milestone_activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    if (error || !data?.length) return [];

    return data.map((row) => ({
      id: row.id,
      milestoneId: row.milestone_id,
      clientName: row.client_name,
      coachName: row.coach_name || "",
      field: row.field,
      newStatus: row.new_status,
      changedBy: row.changed_by || "",
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

// ---- Program Pauses ----

export async function getPauses(): Promise<ProgramPause[]> {
  try {
    const { data, error } = await supabase
      .from("program_pauses")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !data?.length) throw error || new Error("No pause data");

    return data.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      clientName: row.client_name,
      coachName: row.coach_name || "",
      pauseStartDate: row.pause_start_date || "",
      pauseDays: row.pause_days || 0,
      reason: row.reason || "",
      approved: row.approved || false,
      createdAt: row.created_at,
    }));
  } catch {
    console.warn("[data] Pauses: falling back to mock data");
    return mock.mockPauses;
  }
}

// ---- Coach Meetings ----

export async function getMeetings(): Promise<CoachMeeting[]> {
  try {
    const { data, error } = await supabase
      .from("coach_meetings")
      .select("*")
      .order("meeting_date", { ascending: false });

    if (error || !data?.length) throw error || new Error("No meeting data");

    return data.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      clientName: row.client_name,
      coachName: row.coach_name,
      meetingDate: row.meeting_date || "",
      durationMinutes: row.duration_minutes || 0,
      notes: row.notes || "",
      createdAt: row.created_at,
    }));
  } catch {
    console.warn("[data] Meetings: no data found");
    return [];
  }
}

// ---- EOD Reports ----

export async function getEODReports(): Promise<CoachEODReport[]> {
  try {
    const { data: reports, error: e1 } = await supabase
      .from("eod_reports")
      .select("*")
      .order("date", { ascending: false });

    if (e1 || !reports?.length) throw e1 || new Error("No EOD data");

    // Fetch all checkins for these reports
    const reportIds = reports.map((r) => r.id);
    const { data: checkins } = await supabase
      .from("eod_client_checkins")
      .select("*")
      .in("eod_id", reportIds);

    const checkinMap = new Map<number, EODClientCheckin[]>();
    for (const c of checkins || []) {
      const arr = checkinMap.get(c.eod_id) || [];
      arr.push({
        id: c.id,
        eodId: c.eod_id,
        clientName: c.client_name,
        checkedIn: c.checked_in || false,
        notes: c.notes || "",
        onboardingStatus: c.onboarding_status || undefined,
      });
      checkinMap.set(c.eod_id, arr);
    }

    return reports.map((row) => ({
      id: row.id,
      submittedBy: row.submitted_by,
      role: row.role as "coach" | "onboarding",
      date: row.date,
      activeClientCount: row.active_client_count || 0,
      newClients: row.new_clients || 0,
      newClientNames: (() => { try { return JSON.parse(row.new_client_names || "[]"); } catch { return []; } })(),
      accountsDeactivated: row.accounts_deactivated || 0,
      deactivatedClientNames: (() => { try { return JSON.parse(row.deactivated_client_names || "[]"); } catch { return []; } })(),
      communityEngagement: row.community_engagement || "",
      summary: row.summary || "",
      questionsForManagement: row.questions_for_management || "",
      hoursLogged: Number(row.hours_logged) || 0,
      feelingToday: row.feeling_today || "",
      createdAt: row.created_at,
      clientCheckins: checkinMap.get(row.id) || [],
    }));
  } catch {
    console.warn("[data] EOD Reports: falling back to mock data");
    return mock.mockEODReports;
  }
}

// ---- Finances ----

export async function getFinances(): Promise<FinanceRecord[]> {
  try {
    const { data, error } = await supabase
      .from("finances")
      .select("*");

    if (error || !data?.length) throw error || new Error("No finance data");

    return data.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      clientName: row.client_name,
      coachName: row.coach_name || "",
      amountPaid: Number(row.amount_paid) || 0,
      refundAmount: Number(row.refund_amount) || 0,
      refundReason: row.refund_reason || "",
      refundDate: row.refund_date,
      retentionRevenue: Number(row.retention_revenue) || 0,
      retentionDate: row.retention_date,
    }));
  } catch {
    console.warn("[data] Finances: falling back to mock data");
    return mock.mockFinances;
  }
}

// ---- Nutrition Intake Forms ----

export async function getNutritionIntakeForms(): Promise<NutritionIntakeForm[]> {
  try {
    const { data, error } = await supabase
      .from("nutrition_intake_forms")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !data?.length) return [];

    return data.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      firstName: row.first_name || "",
      lastName: row.last_name || "",
      email: row.email || "",
      phone: row.phone || "",
      address: row.address || "",
      city: row.city || "",
      state: row.state || "",
      zipCode: row.zip_code || "",
      age: row.age || null,
      height: row.height || "",
      currentWeight: row.current_weight || "",
      goalWeight: row.goal_weight || "",
      fitnessGoal: row.fitness_goal || "",
      foodsEnjoy: row.foods_enjoy || "",
      foodsAvoid: row.foods_avoid || "",
      allergies: row.allergies || "",
      proteinPreferences: row.protein_preferences || "",
      canCook: row.can_cook || "",
      mealCount: row.meal_count || "",
      medications: row.medications || "",
      supplements: row.supplements || "",
      sleepHours: row.sleep_hours || "",
      waterIntake: row.water_intake || "",
      dailyMealsDescription: row.daily_meals_description || "",
      dailyMealsDescription2: row.daily_meals_description_2 || "",
      dietPlanSent: row.diet_plan_sent || "",
      createdAt: row.created_at,
    }));
  } catch {
    console.warn("[data] Nutrition intake forms: returning empty array");
    return [];
  }
}

// ---- Expenses ----

export async function getExpenses(): Promise<Expense[]> {
  try {
    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    if (error || !data?.length) return [];

    return data.map((row) => ({
      id: row.id,
      month: row.month || "",
      name: row.name || "",
      role: row.role || "",
      base: Number(row.base) || 0,
      commissions: Number(row.commissions) || 0,
      platform: row.platform || "",
      comments: row.comments || "",
      createdAt: row.created_at,
    }));
  } catch {
    console.warn("[data] Expenses: returning empty array");
    return [];
  }
}

// ---- Last Sync Status ----

export async function getLastSync(): Promise<{
  status: string;
  completedAt: string | null;
  rowsUpserted: number;
} | null> {
  try {
    const { data } = await supabase
      .from("sync_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    return data
      ? {
          status: data.status,
          completedAt: data.completed_at,
          rowsUpserted: data.rows_upserted || 0,
        }
      : null;
  } catch {
    return null;
  }
}
