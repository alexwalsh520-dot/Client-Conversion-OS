// Public, no-login client call-metrics dashboard.
//
// A client (e.g. Jake) opens
// https://client-conversion-os.vercel.app/p/client-metrics/<token>.
// We validate the token SERVER-SIDE here (kind = 'client-metrics', not
// revoked), then render the dashboard, which polls
// /api/public/client-metrics/<token> — the actual data boundary. This page
// only decides what to render; it never touches tracker data itself.
//
// Missing / revoked tokens get a clean "not available" page with no data.
import type { Metadata } from "next";
import { getServiceSupabase } from "@/lib/supabase";
import ClientMetricsView from "./ClientMetricsView";
import "./public.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Sales Call Metrics",
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
    return !data.revoked && data.kind === "client-metrics";
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

export default async function PublicClientMetricsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!(await tokenIsLive(token))) return <NotAvailable />;
  return <ClientMetricsView token={token} />;
}
