/**
 * Admin single video-testimonial watch page at /testimonials/videos/<id>.
 *
 * This is the target of the "Watch testimonial" button in the Slack
 * #testimonials notification. Admin-gated server-side (same rationale as the
 * list page and the leads page); the underlying stream API is admin-only too.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { ShieldOff, ArrowLeft } from "lucide-react";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Video Testimonial · CCOS",
  robots: { index: false, follow: false, nocache: true },
};

export default async function VideoTestimonialPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return <AccessDenied reason="signed_out" />;
  if (session.user.role !== "admin") return <AccessDenied reason="not_admin" />;

  const { id } = await params;
  const rowId = Number(id);
  if (!Number.isFinite(rowId) || rowId <= 0) notFound();

  const db = getServiceSupabase();
  const { data: row } = await db
    .from("video_testimonials")
    .select("id, client_name, coach_name, status, submitted_at, file_size")
    .eq("id", rowId)
    .maybeSingle();

  if (!row || row.status !== "submitted") notFound();

  const src = `/api/testimonials/video/stream/${row.id}`;

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: "0 auto" }}>
      <Link
        href="/testimonials/videos"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)", textDecoration: "none", marginBottom: 16 }}
      >
        <ArrowLeft size={14} /> All testimonials
      </Link>

      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
        {row.client_name}
      </h1>
      <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "0 0 18px" }}>
        {row.coach_name || "Unassigned"}
        {row.submitted_at && ` · submitted ${new Date(row.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
        {row.file_size ? ` · ${(row.file_size / (1024 * 1024)).toFixed(1)} MB` : ""}
      </p>

      <video
        src={src}
        controls
        autoPlay
        playsInline
        style={{ width: "100%", borderRadius: 12, background: "#000", maxHeight: "70vh" }}
      />

      <a
        href={`${src}?download=1`}
        style={{
          display: "inline-block",
          marginTop: 16,
          padding: "9px 18px",
          fontSize: 14,
          fontWeight: 600,
          borderRadius: 8,
          textDecoration: "none",
          color: "var(--bg-primary)",
          background: "var(--accent)",
        }}
      >
        Download
      </a>
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
            : "Video testimonials are restricted to admin users."}
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
