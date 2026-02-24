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
