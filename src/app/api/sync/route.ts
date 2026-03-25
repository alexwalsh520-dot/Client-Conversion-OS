// POST /api/sync — Sync Google Sheets data into Supabase
// Dual auth: Vercel Cron (Bearer CRON_SECRET) or NextAuth session (manual Sync Now)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  fetchCoachingFeedback,
  fetchOnboarding,
  fetchSalesData,
  fetchAdsDaily,
  fetchCoachTrackers,
  SHEET_IDS,
} from "@/lib/sheets";

export async function POST(req: NextRequest) {
  // Auth check: Vercel Cron sends Bearer CRON_SECRET, manual sync uses session
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (authHeader === `Bearer ${cronSecret}`) {
    // Cron job — authorized
  } else {
    // Check NextAuth session for manual sync
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const db = getServiceSupabase();

  // Create sync log entry
  const { data: logEntry, error: logError } = await db
    .from("sync_log")
    .insert({ status: "running" })
    .select()
    .single();

  if (logError) {
    console.error("[sync] Failed to create sync log:", logError);
    // Continue anyway — sync log is nice-to-have
  }

  try {
    // Fetch all sheets in parallel
    const [coaching, onboarding, sales, tysonAds, keithAds, coachTrackers] =
      await Promise.all([
        fetchCoachingFeedback().catch((e) => {
          console.error("[sync] Coaching fetch failed:", e);
          return [];
        }),
        fetchOnboarding().catch((e) => {
          console.error("[sync] Onboarding fetch failed:", e);
          return [];
        }),
        fetchSalesData().catch((e) => {
          console.error("[sync] Sales fetch failed:", e);
          return { closers: [], setters: [] };
        }),
        fetchAdsDaily(SHEET_IDS.tysonAds, "tyson").catch((e) => {
          console.error("[sync] Tyson ads fetch failed:", e);
          return [];
        }),
        fetchAdsDaily(SHEET_IDS.keithAds, "keith").catch((e) => {
          console.error("[sync] Keith ads fetch failed:", e);
          return [];
        }),
        fetchCoachTrackers().catch((e) => {
          console.error("[sync] Coach trackers fetch failed:", e);
          return [];
        }),
      ]);

    let totalRows = 0;
    const sheetsSynced: string[] = [];
    const errors: string[] = [];

    // Upsert coaching feedback — deduplicate by (client_name, date, coach_name) keeping latest
    if (coaching.length > 0) {
      const dedupMap = new Map<string, (typeof coaching)[0]>();
      for (const row of coaching) {
        const key = `${row.client_name}|${row.date}|${row.coach_name}`;
        dedupMap.set(key, row); // Last one wins (latest timestamp)
      }
      const dedupedCoaching = Array.from(dedupMap.values());

      const { error } = await db
        .from("coaching_feedback")
        .upsert(dedupedCoaching, {
          onConflict: "client_name,date,coach_name",
        });
      if (error) {
        errors.push(`coaching_feedback: ${error.message}`);
      } else {
        totalRows += dedupedCoaching.length;
        sheetsSynced.push("coaching_feedback");
      }
    }

    // Upsert onboarding
    if (onboarding.length > 0) {
      const { error } = await db
        .from("onboarding_tracker")
        .upsert(onboarding, { onConflict: "client,email" });
      if (error) {
        errors.push(`onboarding_tracker: ${error.message}`);
      } else {
        totalRows += onboarding.length;
        sheetsSynced.push("onboarding_tracker");
      }
    }

    // Upsert closer stats
    if (sales.closers.length > 0) {
      const { error } = await db
        .from("sales_closer_stats")
        .upsert(sales.closers, { onConflict: "month,closer_name" });
      if (error) {
        errors.push(`sales_closer_stats: ${error.message}`);
      } else {
        totalRows += sales.closers.length;
        sheetsSynced.push("sales_closer_stats");
      }
    }

    // Upsert setter stats
    if (sales.setters.length > 0) {
      const { error } = await db
        .from("sales_setter_stats")
        .upsert(sales.setters, { onConflict: "month,setter_name" });
      if (error) {
        errors.push(`sales_setter_stats: ${error.message}`);
      } else {
        totalRows += sales.setters.length;
        sheetsSynced.push("sales_setter_stats");
      }
    }

    // Upsert ads daily (both sources)
    const allAds = [...tysonAds, ...keithAds];
    if (allAds.length > 0) {
      const { error } = await db
        .from("ads_daily")
        .upsert(allAds, { onConflict: "source,date" });
      if (error) {
        errors.push(`ads_daily: ${error.message}`);
      } else {
        totalRows += allAds.length;
        sheetsSynced.push("ads_daily");
      }
    }

    // Upsert coach tracker data into clients table
    // Deduplicate by (client_name, coach_name) — coach tabs are authoritative,
    // Nicole's tab fills in onboarding-specific fields
    if (coachTrackers.length > 0) {
      // Build a map keyed by "clientName|coachName"
      // Coach tabs go first; Nicole's data merges on top for shared fields
      const clientMap = new Map<
        string,
        {
          name: string;
          coach_name: string;
          program: string;
          offer: string;
          start_date: string | null;
          end_date: string | null;
          status: string;
          sales_person: string;
          comments: string;
          payment_platform: string;
          onboarding_fathom_link: string;
          sales_fathom_link: string;
        }
      >();

      for (const row of coachTrackers) {
        if (!row.client_name || !row.coach_name) continue;
        const key = `${row.client_name}|${row.coach_name}`;
        const existing = clientMap.get(key);

        if (!existing) {
          // First time seeing this client+coach combo
          clientMap.set(key, {
            name: row.client_name,
            coach_name: row.coach_name,
            program: row.program,
            offer: row.offer,
            start_date: row.start_date,
            end_date: row.end_date,
            status: row.is_active ? "active" : "completed",
            sales_person: row.sales_person,
            comments: row.comments,
            payment_platform: row.payment_platform,
            onboarding_fathom_link: row.onboarding_call_link,
            sales_fathom_link: row.sales_information,
          });
        } else {
          // Merge: prefer non-empty values (Nicole's tab fills gaps)
          if (!existing.program && row.program) existing.program = row.program;
          if (!existing.offer && row.offer) existing.offer = row.offer;
          if (!existing.start_date && row.start_date)
            existing.start_date = row.start_date;
          if (!existing.end_date && row.end_date)
            existing.end_date = row.end_date;
          if (!existing.sales_person && row.sales_person)
            existing.sales_person = row.sales_person;
          if (!existing.comments && row.comments)
            existing.comments = row.comments;
          if (!existing.payment_platform && row.payment_platform)
            existing.payment_platform = row.payment_platform;
          if (!existing.onboarding_fathom_link && row.onboarding_call_link)
            existing.onboarding_fathom_link = row.onboarding_call_link;
          if (!existing.sales_fathom_link && row.sales_information)
            existing.sales_fathom_link = row.sales_information;
          // Coach tabs have the real Active? column — always let them override
          // status set by Nicole's tab (which hardcodes is_active: true)
          if (row.source_tab !== "Nicole's LT Client Tracker") {
            existing.status = row.is_active ? "active" : "completed";
          }
        }
      }

      const clientRows = Array.from(clientMap.values());
      if (clientRows.length > 0) {
        const { error } = await db
          .from("clients")
          .upsert(clientRows, { onConflict: "name,coach_name" });
        if (error) {
          errors.push(`clients (coach trackers): ${error.message}`);
        } else {
          totalRows += clientRows.length;
          sheetsSynced.push("clients");
        }
      }

      // Upsert milestones from coach tabs (only rows that have milestone data)
      const milestoneRows = coachTrackers
        .filter(
          (row) =>
            row.source_tab !== "Nicole's LT Client Tracker" &&
            row.client_name &&
            row.coach_name
        )
        .map((row) => ({
          client_name: row.client_name,
          coach_name: row.coach_name,
          trust_pilot_completed: row.trust_pilot_done,
          trust_pilot_completion_date: row.trust_pilot_date,
          video_testimonial_completed: row.video_testimonial_done,
          video_testimonial_completion_date: row.video_testimonial_date,
          retention_completed: row.retention_done,
          retention_completion_date: row.retention_date,
          referral_completed: row.referral_done,
          referral_completion_date: row.referral_date,
        }));

      // Deduplicate milestones by client_name+coach_name
      const milestoneMap = new Map<string, (typeof milestoneRows)[0]>();
      for (const m of milestoneRows) {
        milestoneMap.set(`${m.client_name}|${m.coach_name}`, m);
      }
      const dedupedMilestones = Array.from(milestoneMap.values());

      if (dedupedMilestones.length > 0) {
        const { error } = await db
          .from("coach_milestones")
          .upsert(dedupedMilestones, {
            onConflict: "client_name,coach_name",
          });
        if (error) {
          errors.push(`coach_milestones (coach trackers): ${error.message}`);
        } else {
          totalRows += dedupedMilestones.length;
          sheetsSynced.push("coach_milestones");
        }
      }
    }

    // Update sync log
    if (logEntry) {
      await db
        .from("sync_log")
        .update({
          completed_at: new Date().toISOString(),
          status: errors.length > 0 ? "partial" : "success",
          sheets_synced: sheetsSynced,
          rows_upserted: totalRows,
          error: errors.length > 0 ? errors.join("; ") : null,
        })
        .eq("id", logEntry.id);
    }

    return NextResponse.json({
      success: true,
      rows: totalRows,
      sheets: sheetsSynced,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[sync] Fatal error:", errMsg);

    // Update sync log with error
    if (logEntry) {
      await db
        .from("sync_log")
        .update({
          completed_at: new Date().toISOString(),
          status: "error",
          error: errMsg,
        })
        .eq("id", logEntry.id);
    }

    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// GET /api/sync — Return last sync status
export async function GET() {
  const db = getServiceSupabase();

  try {
    const { data } = await db
      .from("sync_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(5);

    return NextResponse.json({ syncs: data || [] });
  } catch {
    return NextResponse.json({ syncs: [] });
  }
}
