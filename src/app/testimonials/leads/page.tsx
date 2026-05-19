/**
 * Admin leads page at /testimonials/leads.
 *
 * Auth is enforced at THREE layers:
 *   1. Middleware (src/proxy.ts) excludes `testimonials` so prospects can
 *      reach the public page, but that means /testimonials/leads also
 *      bypasses middleware. AccessGate's startsWith() check on allowed_tabs
 *      would otherwise grant non-admin coaches access here (they have
 *      /testimonials in their allowed_tabs for the sidebar link to work).
 *   2. This page server-checks the session and returns an explicit
 *      "admin only" view for non-admins.
 *   3. The API routes the page calls also require admin role.
 *
 * Standard CCOS layout (sidebar present, gold/dark theme).
 */

import Link from "next/link";
import { auth } from "@/auth";
import { ShieldOff } from "lucide-react";
import AdminLeadsView from "@/components/testimonials/AdminLeadsView";

export const dynamic = "force-dynamic";

export default async function TestimonialsLeadsPage() {
  const session = await auth();

  // Server-side enforcement — render an unmistakable "admin only" view
  // for non-admins instead of relying on the API to 403 the whole table.
  if (!session?.user?.email) {
    return <AccessDenied reason="signed_out" />;
  }
  if (session.user.role !== "admin") {
    return <AccessDenied reason="not_admin" />;
  }

  return <AdminLeadsView />;
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
            : "Lead management is restricted to admin users. Ask Alex or Saeed if you think you should have access."}
        </p>
      </div>
      <Link
        href={reason === "signed_out" ? "/login" : "/testimonials"}
        style={{
          fontSize: 13,
          color: "var(--accent)",
          textDecoration: "none",
          padding: "8px 14px",
          border: "1px solid var(--accent)",
          borderRadius: 8,
        }}
      >
        {reason === "signed_out" ? "Sign in" : "← Back to Testimonials"}
      </Link>
    </div>
  );
}
