// Public, no-login creator share view for the LIVE ADS tab.
//
// A creator opens https://client-conversion-os.vercel.app/p/live-ads/<token>. We
// resolve the token -> creator SERVER-SIDE here, build the live ads dashboard,
// then HARD-FILTER it to that one creator's account before rendering the same
// LiveAdsBrowser the operator sees. There is no account switcher and no other
// creator's data on the page. The scope comes ONLY from the token row — never
// from a request param.
//
// The token-scoped public API /api/public/live-ads/<token> enforces the same
// boundary for any client-side calls; this page applies the identical filter so
// the very first server render can only ever contain the token's creator.
//
// Missing / revoked / wrong-kind tokens get a clean "not available" page.
import type { Metadata } from "next";
import { getServiceSupabase } from "@/lib/supabase";
import { isCreatorKey, type CreatorKey } from "@/lib/creators";
import { getLiveAdsDashboard, type LiveAdsPayload } from "@/lib/live-ads";
import LiveAdsBrowser from "../../../live-ads/LiveAdsBrowser";
import "./public.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Live Ads — Client Conversion",
  robots: { index: false, follow: false },
};

async function resolveToken(token: string): Promise<{ clientKey: CreatorKey } | null> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("client_key, kind, revoked")
      .eq("token", token)
      .maybeSingle();
    if (error || !data) return null;
    if (data.revoked || data.kind !== "live-ads") return null;
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

export default async function PublicLiveAdsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveToken(token);

  if (!resolved) return <NotAvailable />;

  // Build the dashboard and HARD-FILTER to the token's one account. The scope is
  // the resolved clientKey only — there is no request param that can widen it.
  const dashboard = await getLiveAdsDashboard();
  const accounts = dashboard.accounts.filter((account) => account.key === resolved.clientKey);
  const scoped: LiveAdsPayload = {
    ...dashboard,
    accounts,
    totalActiveAds: accounts.reduce((sum, account) => sum + account.activeAdsCount, 0),
  };

  return (
    <main className="pub-live-ads-page" aria-label="Live Ads">
      <LiveAdsBrowser data={scoped} />
    </main>
  );
}
