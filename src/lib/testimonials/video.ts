// Shared helpers for the client video testimonial flow.

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// The live site runs on the client-conversion-os Vercel project (same place as
// Studio 2 media + the R2 credentials). Recording links MUST point here so the
// public upload-url API runs on the deployment that has R2 configured. The old
// dashboard-drab-two-78 fallback pointed at a separate project with no R2 vars,
// which made every uploaded testimonial fail with "Failed to create upload URL".
export const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://client-conversion-os.vercel.app";

// Shown verbatim on the public recording page so the client knows what to say.
// Order matters. Keep free of em-dashes (house style).
export const TESTIMONIAL_GUIDE: string[] = [
  "Intro: state your name and where you live",
  "How was your situation before? (brief, 1 to 2 short statements)",
  "How did that make you feel?",
  "How did you find us (or find out about) our program?",
  "What were your thoughts going through the process?",
  "What were your doubts and fears about this?",
  "What made you say yes anyway?",
  "Where are you at now?",
  "How does that make you feel?",
  "What are you able to do now that you couldn't before?",
  "What positive impact did that have on others around you?",
  "What would you tell someone who is watching this right now and is unsure about taking the next step?",
];

export function generateTestimonialToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function recordingUrl(token: string): string {
  return `${APP_BASE_URL}/testimonials/record/${token}`;
}

// Auto-mark the client's Video Testimonial milestone as completed when they
// submit. Mirrors the "update_milestone_checkbox" logic in /api/coaching, and
// finds-or-creates the milestone row so it works even if a coach never opened
// the Milestones tab for this client. Best-effort: never throws.
export async function completeVideoMilestone(
  db: SupabaseClient,
  args: { clientId: number; clientName: string; coachName: string | null; changedBy: string }
): Promise<void> {
  try {
    const now = new Date();
    const today = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;

    let milestoneId: number | null = null;
    const existing = await db
      .from("coach_milestones")
      .select("id")
      .eq("client_id", args.clientId)
      .maybeSingle();

    if (existing.data?.id) {
      milestoneId = existing.data.id as number;
    } else {
      const created = await db
        .from("coach_milestones")
        .insert({
          client_id: args.clientId,
          client_name: args.clientName,
          coach_name: args.coachName,
        })
        .select("id")
        .single();
      milestoneId = (created.data?.id as number) ?? null;
    }

    if (!milestoneId) return;

    await db
      .from("coach_milestones")
      .update({
        video_testimonial_completed: true,
        video_testimonial_completion_date: today,
        video_testimonial_prompted_date: today,
      })
      .eq("id", milestoneId);

    try {
      await db.from("milestone_activity_log").insert({
        milestone_id: milestoneId,
        client_name: args.clientName,
        coach_name: args.coachName,
        field: "Video Testimonial",
        new_status: "completed",
        changed_by: args.changedBy,
      });
    } catch {
      /* activity log is non-critical */
    }
  } catch (err) {
    console.warn("[testimonials/video] completeVideoMilestone failed:", err);
  }
}
