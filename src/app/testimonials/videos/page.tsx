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
  created_at: string;
};

export default async function VideoTestimonialsPage() {
  const session = await auth();
  if (!session?.user?.email) return <AccessDenied reason="signed_out" />;
  if (session.user.role !== "admin") return <AccessDenied reason="not_admin" />;

  const db = getServiceSupabase();
  const { data } = await db
    .from("video_testimonials")
    .select("id, client_name, coach_name, status, submitted_at, file_size, created_at")
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const rows = (data || []) as Row[];
  const submitted = rows.filter((r) => r.status === "submitted");
  const pending = rows.filter((r) => r.status !== "submitted");

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Star size={20} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          Video Testimonials
        </h1>
      </div>
      <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "0 0 24px" }}>
        {submitted.length} submitted · {pending.length} awaiting recording
      </p>

      {submitted.length === 0 ? (
        <div className="glass-static" style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>
          No testimonials submitted yet.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {submitted.map((r) => (
            <VideoCard key={r.id} row={r} />
          ))}
        </div>
      )}

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

function VideoCard({ row }: { row: Row }) {
  const src = `/api/testimonials/video/stream/${row.id}`;
  return (
    <div className="glass-static" style={{ padding: 14 }}>
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        style={{ width: "100%", borderRadius: 10, background: "#000", aspectRatio: "9 / 16", objectFit: "contain" }}
      />
      <div style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 15 }}>{row.client_name}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
          {row.coach_name || "Unassigned"}
          {row.submitted_at && ` · ${new Date(row.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
          {row.file_size ? ` · ${(row.file_size / (1024 * 1024)).toFixed(1)} MB` : ""}
        </div>
      </div>
      <a
        href={`${src}?download=1`}
        style={{
          display: "inline-block",
          marginTop: 10,
          padding: "7px 14px",
          fontSize: 13,
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
