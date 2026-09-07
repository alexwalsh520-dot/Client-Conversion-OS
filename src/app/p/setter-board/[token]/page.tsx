// Public, no-login setter leaderboard.
//
// A setter opens https://client-conversion-os.vercel.app/p/setter-board/<token>.
// The token is validated SERVER-SIDE (kind = 'setter-board', not revoked); the
// view then polls /api/public/setter-board/<token> — the actual data boundary.
// Missing / revoked tokens get a clean "not available" page with no data.
import type { Metadata } from "next";
import { getServiceSupabase } from "@/lib/supabase";
import SetterBoardView from "./SetterBoardView";
import "./public.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Setter Leaderboard",
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
    return !data.revoked && data.kind === "setter-board";
  } catch {
    return false;
  }
}

function NotAvailable() {
  return (
    <main className="pub-unavailable">
      <div className="pub-unavailable-card">
        <h1>Link not available</h1>
        <p>This share link is no longer active. Ask your manager for a fresh link.</p>
      </div>
    </main>
  );
}

export default async function PublicSetterBoardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!(await tokenIsLive(token))) return <NotAvailable />;
  return <SetterBoardView token={token} />;
}
