/**
 * Public shareable watch page at /testimonials/watch/<token>.
 *
 * This is the target of the "Watch testimonial" button in the Slack
 * #testimonials notification. Anyone with the link can view — no CCOS login —
 * so coaches (and whoever they forward it to) can see their client's
 * submission. Access is gated by the row's unguessable token, not the numeric
 * id, so testimonials can't be enumerated. No CCOS chrome (see Sidebar.tsx /
 * AccessGate.tsx public-route exceptions).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Video Testimonial",
  robots: { index: false, follow: false, nocache: true },
};

const COLORS = {
  bg: "#0f1115",
  card: "#181b22",
  line: "#262b35",
  text: "#f3f4f6",
  sub: "#aab1bd",
  accent: "#e0b15e",
  accentInk: "#1a1205",
};

export default async function WatchTestimonialPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let clientName = "";
  let coachName: string | null = null;
  let submittedAt: string | null = null;
  let ok = false;

  try {
    const db = getServiceSupabase();
    const { data } = await db
      .from("video_testimonials")
      .select("client_name, coach_name, status, submitted_at")
      .eq("token", token)
      .maybeSingle();
    if (data && data.status === "submitted") {
      clientName = data.client_name || "Client";
      coachName = data.coach_name;
      submittedAt = data.submitted_at;
      ok = true;
    }
  } catch {
    // fall through to notFound
  }

  if (!ok) notFound();

  const src = `/api/testimonials/video/watch/${token}`;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.bg,
        color: COLORS.text,
        padding: "32px 18px 64px",
        fontFamily: "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px", letterSpacing: "-0.01em" }}>
          {clientName}
        </h1>
        <p style={{ color: COLORS.sub, fontSize: 14, margin: "0 0 18px" }}>
          {coachName ? `Coach: ${coachName}` : "Client testimonial"}
          {submittedAt &&
            ` · ${new Date(submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
        </p>

        <video
          src={src}
          controls
          autoPlay
          playsInline
          style={{
            width: "100%",
            borderRadius: 14,
            background: "#000",
            maxHeight: "75vh",
            border: `1px solid ${COLORS.line}`,
          }}
        />

        <a
          href={`${src}?download=1`}
          style={{
            display: "inline-block",
            marginTop: 16,
            padding: "11px 20px",
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 10,
            textDecoration: "none",
            color: COLORS.accentInk,
            background: COLORS.accent,
          }}
        >
          Download video
        </a>
      </div>
    </div>
  );
}
