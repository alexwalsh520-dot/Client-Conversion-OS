/**
 * Public testimonials page at /testimonials.
 *
 * Unauthenticated, indexable. The only CCOS surface visible to the public.
 * Renders Senja widget + lead-capture form. Logged-in admins also see a
 * floating "Manage leads" badge in the top-right that links to the team
 * view at /testimonials/leads.
 *
 * No CCOS sidebar shown here — handled in Sidebar.tsx by pathname check.
 */

import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import SenjaEmbed from "@/components/testimonials/SenjaEmbed";
import PublicLeadForm from "@/components/testimonials/PublicLeadForm";
import AdminBadge from "@/components/testimonials/AdminBadge";

export const metadata: Metadata = {
  title: "CCOS Testimonials",
  description:
    "Real stories from real clients of Client Conversion. Read what our coaches and program have done for them.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "CCOS Testimonials",
    description: "Real stories from real clients of Client Conversion.",
    type: "website",
  },
};

export default function TestimonialsPublicPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "60px 20px 80px",
        background: "var(--bg-primary)",
      }}
    >
      <AdminBadge />

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* Header */}
        <header style={{ textAlign: "center", marginBottom: 40 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <Sparkles size={20} style={{ color: "var(--accent)" }} />
            <h1
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: "var(--text-primary)",
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              CCOS Testimonials
            </h1>
          </div>
          <p
            style={{
              fontSize: 15,
              color: "var(--text-secondary)",
              margin: 0,
              maxWidth: 480,
              marginInline: "auto",
              lineHeight: 1.6,
            }}
          >
            Real stories from real clients.
          </p>
        </header>

        {/* Senja widget */}
        <section style={{ marginBottom: 56 }}>
          <SenjaEmbed />
        </section>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: "var(--border-primary)",
            margin: "0 auto 40px",
            maxWidth: 200,
          }}
        />

        {/* CTA / form */}
        <section style={{ marginBottom: 40 }}>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: "var(--text-primary)",
                margin: "0 0 8px",
              }}
            >
              Want to work with us?
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "var(--text-muted)",
                margin: 0,
              }}
            >
              Drop your details and we will reach out within 24 hours.
            </p>
          </div>
          <PublicLeadForm />
        </section>

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
