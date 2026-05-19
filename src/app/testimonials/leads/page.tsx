/**
 * Admin leads page at /testimonials/leads.
 *
 * Auth: gated by AccessGate (default behavior — non-admins see the
 * "no access" view). The API routes additionally enforce admin role.
 *
 * Renders inside the standard CCOS layout (sidebar present).
 */

import AdminLeadsView from "@/components/testimonials/AdminLeadsView";

export const dynamic = "force-dynamic";

export default function TestimonialsLeadsPage() {
  return <AdminLeadsView />;
}
