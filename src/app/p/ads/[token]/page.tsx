// Public, no-login creator share view for the Ads tab.
//
// A creator opens https://client-conversion-os.vercel.app/p/ads/<token>. We
// resolve the token -> creator SERVER-SIDE here, then render the exact same live
// Ads tracker UI (the shared /ads-tracker-export.html) in PUBLIC MODE: the
// iframe is told the token (?pub=) so it fetches from the token-scoped public
// API, and the creator (?acct=) so the UI locks to that creator and hides the
// selector. The data boundary is enforced by /api/public/ads/<token> — this page
// only decides what to render.
//
// Missing / revoked tokens get a clean "not available" page with no data.
import type { Metadata } from "next";
import { getServiceSupabase } from "@/lib/supabase";
import { isCreatorKey } from "@/lib/creators";
import "../../../ads/tracker.css";
import "./public.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Ads — Client Conversion",
  robots: { index: false, follow: false },
};

async function resolveToken(token: string): Promise<{ clientKey: string } | null> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("client_key, kind, revoked")
      .eq("token", token)
      .maybeSingle();
    if (error || !data) return null;
    if (data.revoked || data.kind !== "ads") return null;
    if (!isCreatorKey(data.client_key)) return null;
    return { clientKey: data.client_key };
  } catch {
    return null;
  }
}

function NotAvailable() {
  return (
    <main className="pub-unavailable">
      <div className="pub-unavailable-card">
        <h1>Link not available</h1>
        <p>This share link is no longer active. Ask your contact for a fresh link.</p>
      </div>
    </main>
  );
}

export default async function PublicAdsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveToken(token);

  if (!resolved) return <NotAvailable />;

  // Fresh cache-bust so the newest tracker UI always loads.
  const cacheBust = Date.now();
  const src =
    `/ads-tracker-export.html?v=dollar-split-2026-05-31&t=${cacheBust}` +
    `&pub=${encodeURIComponent(token)}&acct=${encodeURIComponent(resolved.clientKey)}`;

  return (
    <main className="ads-export-page pub-ads-page" aria-label="Ads">
      <iframe className="ads-export-frame" src={src} title="Ads" />
    </main>
  );
}
