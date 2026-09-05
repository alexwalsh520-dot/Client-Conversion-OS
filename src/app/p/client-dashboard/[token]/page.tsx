// Public, no-login client business dashboard — the client's ONE central place
// for marketing + sales numbers and the upcoming-call calendar.
//
// A client (e.g. Jake) opens
// https://client-conversion-os.vercel.app/p/client-dashboard/<token>.
// We validate the token SERVER-SIDE here (kind = 'client-dashboard', not
// revoked), then render the dashboard, which polls
// /api/public/client-dashboard/<token> — the actual data boundary. This page
// only decides what to render; it never touches data itself.
//
// Missing / revoked tokens get a clean "not available" page with no data.
import type { Metadata } from "next";
import { getServiceSupabase } from "@/lib/supabase";
import ClientDashboardView from "./ClientDashboardView";
import "./public.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Business Dashboard",
  robots: { index: false, follow: false },
};

async function tokenIsLive(token: string): Promise<boolean> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("kind, revoked")
      .eq("token", token)
      .maybeSingle();
    if (error || !data) return false;
    return !data.revoked && data.kind === "client-dashboard";
  } catch {
    return false;
  }
}

function NotAvailable() {
  return (
    <main className="pub-unavailable">
      <div className="pub-unavailable-card">
        <h1>Link not available</h1>
        <p>This share link is no longer active. Ask your team for a fresh link.</p>
      </div>
    </main>
  );
}

export default async function PublicClientDashboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!(await tokenIsLive(token))) return <NotAvailable />;
  return <ClientDashboardView token={token} />;
}
