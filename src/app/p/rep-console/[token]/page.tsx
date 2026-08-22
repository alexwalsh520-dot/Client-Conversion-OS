// Public, no-login rep console.
//
// A closer opens https://client-conversion-os.vercel.app/p/rep-console/<token>
// on their phone. We validate the token SERVER-SIDE here (kind = 'rep-console',
// not revoked), then render the console, which polls
// /api/public/rep-console/<token> — the actual data boundary (it also decides
// can_edit / rep_scope per token). This page only decides what to render; it
// never touches appointment or leaderboard data itself.
//
// Missing / revoked tokens get a clean "not available" page with no data.
import type { Metadata } from "next";
import { getServiceSupabase } from "@/lib/supabase";
import RepConsoleView from "./RepConsoleView";
import "./public.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Rep Console",
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
    return !data.revoked && data.kind === "rep-console";
  } catch {
    return false;
  }
}

function NotAvailable() {
  return (
    <main className="pub-rc-unavailable">
      <div className="pub-rc-unavailable-card">
        <h1>Link not available</h1>
        <p>This console link is no longer active. Ask your manager for a fresh link.</p>
      </div>
    </main>
  );
}

export default async function PublicRepConsolePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!(await tokenIsLive(token))) return <NotAvailable />;
  return <RepConsoleView token={token} />;
}
