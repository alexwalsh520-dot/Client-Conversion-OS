// Public, no-login setter team view of the Sales Hub.
//
// One link for the whole team: everybody sees everybody's numbers
// (owner, 2026-09-14). The token is validated SERVER-SIDE (kind =
// 'setter-view', not revoked); the view then polls
// /api/public/setter-view/<token> — the actual data boundary. The date
// picker is the hub's own DateDropdown, clamped so data only starts from
// yesterday (ET).
import type { Metadata } from "next";
import { getServiceSupabase } from "@/lib/supabase";
import SetterViewView from "./SetterViewView";
import "./setter-view.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Setter Stats",
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
    return !data.revoked && data.kind === "setter-view";
  } catch {
    return false;
  }
}

function NotAvailable() {
  return (
    <main className="pub-sv-unavailable">
      <div className="pub-sv-unavailable-card">
        <h1>Link not available</h1>
        <p>This share link is no longer active. Ask your manager for a fresh link.</p>
      </div>
    </main>
  );
}

export default async function PublicSetterViewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!(await tokenIsLive(token))) return <NotAvailable />;
  return <SetterViewView token={token} />;
}
