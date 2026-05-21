/**
 * Public client check-in form at /check-in.
 *
 * Unauthenticated, noindex (coach-shared URL — no SEO value, and not
 * something we want surfacing for random search queries containing
 * client names).
 *
 * Bypasses middleware via the `check-in` entry in src/proxy.ts and the
 * `pathname === "/check-in"` entry in AccessGate.tsx. Sidebar hides
 * itself on this path so the page renders chrome-free.
 *
 * Same dark CCOS aesthetic as /testimonials — single-column, ~640px max.
 */

import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import CheckInForm from "@/components/check-in/CheckInForm";

export const metadata: Metadata = {
  title: "Client Check-In · CCOS",
  description: "Bi-weekly self check-in for Client Conversion clients.",
  robots: { index: false, follow: false, nocache: true },
};

export default function CheckInPublicPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "60px 20px 80px",
        background: "var(--bg-primary)",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* Header */}
        <header style={{ textAlign: "center", marginBottom: 36 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <ClipboardCheck size={20} style={{ color: "var(--accent)" }} />
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "var(--text-primary)",
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              Client Check-In
            </h1>
          </div>
          <p
            style={{
              fontSize: 14,
              color: "var(--text-secondary)",
              margin: 0,
              maxWidth: 480,
              marginInline: "auto",
              lineHeight: 1.6,
            }}
          >
            Quick bi-weekly check-in for your coach. Takes under a minute.
          </p>
        </header>

        <CheckInForm />

        {/* Footer */}
        <footer
          style={{
            marginTop: 60,
            paddingTop: 24,
            borderTop: "1px solid var(--border-primary)",
            textAlign: "center",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          © Client Conversion · CCOS
        </footer>
      </div>
    </div>
  );
}
