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
import PublicVideoGallery, { type GalleryItem } from "@/components/testimonials/PublicVideoGallery";
import { getServiceSupabase } from "@/lib/supabase";

// Re-generate periodically so newly featured videos appear without a deploy,
// while keeping this public/indexable page cacheable.
export const revalidate = 300;

async function getFeaturedVideos(): Promise<GalleryItem[]> {
  try {
    const db = getServiceSupabase();
    const { data } = await db
      .from("video_testimonials")
      .select("id, client_name")
      .eq("featured", true)
      .eq("status", "submitted")
      .order("featured_at", { ascending: false });
    return (data || []).map((r) => ({ id: r.id as number, clientName: (r.client_name as string) || "Client" }));
  } catch {
    // Never let a DB hiccup break the public page; just show no video gallery.
    return [];
  }
}

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

export default async function TestimonialsPublicPage() {
  const featuredVideos = await getFeaturedVideos();

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

        {/* Native client video gallery (admin-featured testimonials) */}
        <PublicVideoGallery items={featuredVideos} />

        {/* Senja widget (written reviews) */}
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
