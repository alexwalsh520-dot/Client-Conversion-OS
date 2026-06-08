/**
 * Admin video-testimonials log at /testimonials/videos.
 *
 * Lists every submitted client video testimonial with an inline player and a
 * download button. Like /testimonials/leads, this route is reachable by any
 * coach via AccessGate's startsWith() on the /testimonials allowed-tab, so it
 * is gated to admins here at the server (and the stream API is admin-only too).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { ShieldOff, Star } from "lucide-react";
import { getServiceSupabase } from "@/lib/supabase";
import VideoManager, { type VideoRow } from "@/components/testimonials/VideoManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Video Testimonials · CCOS",
  robots: { index: false, follow: false, nocache: true },
};

type Row = {
  id: number;
  client_name: string;
  coach_name: string | null;
  status: string;
  submitted_at: string | null;
  file_size: number | null;
  featured: boolean;
  created_at: string;
};

export default async function VideoTestimonialsPage() {
  const session = await auth();
  if (!session?.user?.email) return <AccessDenied reason="signed_out" />;
  if (session.user.role !== "admin") return <AccessDenied reason="not_admin" />;

  const db = getServiceSupabase();
  const { data } = await db
    .from("video_testimonials")
    .select("id, client_name, coach_name, status, submitted_at, file_size, featured, created_at")
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const rows = (data || []) as Row[];
  const submitted = rows.filter((r) => r.status === "submitted");
  const pending = rows.filter((r) => r.status !== "submitted");

  const submittedForManager: VideoRow[] = submitted.map((r) => ({
    id: r.id,
    client_name: r.client_name,
    coach_name: r.coach_name,
    submitted_at: r.submitted_at,
    file_size: r.file_size,
    featured: !!r.featured,
  }));

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Star size={20} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          Video Testimonials
        </h1>
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 20px", maxWidth: 640 }}>
        {pending.length} awaiting recording. Feature a video to show it in the gallery on the public
        testimonials page (alongside the written Senja reviews). Delete removes the video permanently.
      </p>

      <VideoManager initial={submittedForManager} />

      {pending.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 className="section-title" style={{ margin: "0 0 12px" }}>Awaiting recording</h2>
          <div className="glass-static" style={{ padding: 4 }}>
            {pending.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  borderBottom: "1px solid var(--border-primary)",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{r.client_name}</span>
                <span>{r.coach_name || "—"}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  requested {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AccessDenied({ reason }: { reason: "signed_out" | "not_admin" }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: 16,
        padding: 24,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: "rgba(239,68,68,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ShieldOff size={28} style={{ color: "var(--danger)" }} />
      </div>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 6px" }}>
          {reason === "signed_out" ? "Sign in required" : "Admins only"}
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, maxWidth: 380 }}>
          {reason === "signed_out"
            ? "This page is for CCOS admins. Sign in to continue."
            : "Video testimonials are restricted to admin users. Ask Alex or Saeed if you think you should have access."}
        </p>
      </div>
      <Link
        href={reason === "signed_out" ? "/login" : "/coaching"}
        style={{
          fontSize: 13,
          color: "var(--accent)",
          textDecoration: "none",
          padding: "8px 14px",
          border: "1px solid var(--accent)",
          borderRadius: 8,
        }}
      >
        {reason === "signed_out" ? "Sign in" : "← Back to Coaching"}
      </Link>
    </div>
  );
}
