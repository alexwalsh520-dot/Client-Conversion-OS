// POST /api/coaching — Write operations for coaching hub tables
// Requires NextAuth session. Uses service role key to bypass RLS.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

type Action =
  | "upsert_client"
  | "upsert_milestone"
  | "upsert_pause"
  | "upsert_meeting"
  | "submit_eod"
  | "upsert_finance"
  | "update_milestone_checkbox";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const action = body.action as Action;
  const payload = body.payload;

  if (!action || !payload) {
    return NextResponse.json({ error: "Missing action or payload" }, { status: 400 });
  }

  const db = getServiceSupabase();

  try {
    switch (action) {
      // ---- Clients ----
      case "upsert_client": {
        const row = {
          name: payload.name,
          email: payload.email || null,
          coach_name: payload.coachName || null,
          program: payload.program || null,
          offer: payload.offer || null,
          start_date: payload.startDate || null,
          end_date: payload.endDate || null,
          status: payload.status || "active",
          payment_platform: payload.paymentPlatform || null,
          sales_fathom_link: payload.salesFathomLink || null,
          onboarding_fathom_link: payload.onboardingFathomLink || null,
          amount_paid: payload.amountPaid || 0,
          sales_person: payload.salesPerson || null,
          comments: payload.comments || null,
        };
        if (payload.id) Object.assign(row, { id: payload.id });

        const { data, error } = await db
          .from("clients")
          .upsert(row, { onConflict: "id" })
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ success: true, data });
      }

      // ---- Milestones ----
      case "upsert_milestone": {
        const row = {
          client_id: payload.clientId,
          client_name: payload.clientName,
          coach_name: payload.coachName,
          trust_pilot_prompted_date: payload.trustPilotPromptedDate || null,
          trust_pilot_completed: payload.trustPilotCompleted || false,
          trust_pilot_completion_date: payload.trustPilotCompletionDate || null,
          video_testimonial_prompted_date: payload.videoTestimonialPromptedDate || null,
          video_testimonial_completed: payload.videoTestimonialCompleted || false,
          video_testimonial_completion_date: payload.videoTestimonialCompletionDate || null,
          retention_prompted_date: payload.retentionPromptedDate || null,
          retention_completed: payload.retentionCompleted || false,
          retention_completion_date: payload.retentionCompletionDate || null,
          referral_prompted_date: payload.referralPromptedDate || null,
          referral_completed: payload.referralCompleted || false,
          referral_completion_date: payload.referralCompletionDate || null,
        };
        if (payload.id) Object.assign(row, { id: payload.id });

        const { data, error } = await db
          .from("coach_milestones")
          .upsert(row, { onConflict: "id" })
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ success: true, data });
      }

      // ---- Quick milestone checkbox toggle ----
      case "update_milestone_checkbox": {
        const { milestoneId, field, value } = payload;
        const today = new Date().toISOString().split("T")[0];

        // Build the update: set the boolean + auto-capture date
        const updateObj: Record<string, unknown> = { [field]: value };
        const dateField = field.replace("Completed", "CompletionDate")
          .replace(/([A-Z])/g, "_$1").toLowerCase()
          .replace(/^_/, "");
        // Map camelCase field to snake_case date column
        const dateColumn = field === "trustPilotCompleted" ? "trust_pilot_completion_date"
          : field === "videoTestimonialCompleted" ? "video_testimonial_completion_date"
          : field === "retentionCompleted" ? "retention_completion_date"
          : field === "referralCompleted" ? "referral_completion_date"
          : null;

        const boolColumn = field === "trustPilotCompleted" ? "trust_pilot_completed"
          : field === "videoTestimonialCompleted" ? "video_testimonial_completed"
          : field === "retentionCompleted" ? "retention_completed"
          : field === "referralCompleted" ? "referral_completed"
          : null;

        if (!boolColumn || !dateColumn) {
          return NextResponse.json({ error: "Invalid field" }, { status: 400 });
        }

        const update: Record<string, unknown> = {
          [boolColumn]: value,
          [dateColumn]: value ? today : null,
        };

        // Also set prompted date if not already set
        const promptedColumn = dateColumn.replace("completion_date", "prompted_date");
        if (value) {
          update[promptedColumn] = today; // ensure prompted is set
        }

        const { data, error } = await db
          .from("coach_milestones")
          .update(update)
          .eq("id", milestoneId)
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ success: true, data });
      }

      // ---- Program Pauses ----
      case "upsert_pause": {
        const row = {
          client_id: payload.clientId,
          client_name: payload.clientName,
          coach_name: payload.coachName || null,
          pause_start_date: payload.pauseStartDate,
          pause_days: payload.pauseDays || 0,
          reason: payload.reason || "",
          approved: payload.approved || false,
        };
        if (payload.id) Object.assign(row, { id: payload.id });

        const { data, error } = await db
          .from("program_pauses")
          .upsert(row, { onConflict: "id" })
          .select()
          .single();

        if (error) throw error;

        // Auto-extend client end date if pause is approved
        if (payload.approved && payload.clientId && payload.pauseDays > 0) {
          const { data: client } = await db
            .from("clients")
            .select("end_date")
            .eq("id", payload.clientId)
            .single();

          if (client?.end_date) {
            const currentEnd = new Date(client.end_date);
            currentEnd.setDate(currentEnd.getDate() + payload.pauseDays);
            await db
              .from("clients")
              .update({ end_date: currentEnd.toISOString().split("T")[0] })
              .eq("id", payload.clientId);
          }
        }

        return NextResponse.json({ success: true, data });
      }

      // ---- Coach Meetings ----
      case "upsert_meeting": {
        const row = {
          client_id: payload.clientId,
          client_name: payload.clientName,
          coach_name: payload.coachName,
          meeting_date: payload.meetingDate,
          duration_minutes: payload.durationMinutes || 0,
          notes: payload.notes || "",
        };
        if (payload.id) Object.assign(row, { id: payload.id });

        const { data, error } = await db
          .from("coach_meetings")
          .upsert(row, { onConflict: "id" })
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ success: true, data });
      }

      // ---- EOD Reports ----
      case "submit_eod": {
        // Insert the main report
        const reportRow = {
          submitted_by: payload.submittedBy,
          role: payload.role,
          date: payload.date,
          active_client_count: payload.activeClientCount || 0,
          new_clients: payload.newClients || 0,
          accounts_deactivated: payload.accountsDeactivated || 0,
          community_engagement: payload.communityEngagement || "",
          summary: payload.summary || "",
          questions_for_management: payload.questionsForManagement || "",
          hours_logged: payload.hoursLogged || 0,
          feeling_today: payload.feelingToday || "",
        };

        const { data: report, error: e1 } = await db
          .from("eod_reports")
          .insert(reportRow)
          .select()
          .single();

        if (e1) throw e1;

        // Insert client checkins if provided
        if (payload.clientCheckins?.length > 0) {
          const checkinRows = payload.clientCheckins.map((c: { clientName: string; checkedIn: boolean; notes: string }) => ({
            eod_id: report.id,
            client_name: c.clientName,
            checked_in: c.checkedIn || false,
            notes: c.notes || "",
          }));

          const { error: e2 } = await db
            .from("eod_client_checkins")
            .insert(checkinRows);

          if (e2) throw e2;
        }

        return NextResponse.json({ success: true, data: report });
      }

      // ---- Finances ----
      case "upsert_finance": {
        const row = {
          client_id: payload.clientId,
          client_name: payload.clientName,
          coach_name: payload.coachName || null,
          amount_paid: payload.amountPaid || 0,
          refund_amount: payload.refundAmount || 0,
          refund_reason: payload.refundReason || "",
          refund_date: payload.refundDate || null,
          retention_revenue: payload.retentionRevenue || 0,
          retention_date: payload.retentionDate || null,
        };
        if (payload.id) Object.assign(row, { id: payload.id });

        const { data, error } = await db
          .from("finances")
          .upsert(row, { onConflict: "id" })
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ success: true, data });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[api/coaching] ${action} failed:`, err);
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 }
    );
  }
}
