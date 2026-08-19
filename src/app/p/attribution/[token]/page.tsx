// Public, no-login share view for the Attribution workspace.
//
// Someone opens /p/attribution/<token> and gets the attribution panel ALONE:
// no sidebar, no other tabs, no ads table, no CCOS login. The token is
// validated server-side here for the page and again by
// /api/public/attribution/<token> for every read and write. Missing or
// revoked tokens get a clean, dataless page.
import type { Metadata } from "next";
import { getServiceSupabase } from "@/lib/supabase";
import { resolveAttributionToken } from "@/lib/ads-v2/attribution-workspace";
import "../../../ads-v2/ads-v2.css";
import AttributionWorkspace from "../../../ads-v2/AttributionWorkspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Attribution",
  robots: { index: false, follow: false },
};

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

export default async function PublicAttributionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const ok = await resolveAttributionToken(getServiceSupabase(), token).catch(() => false);
  if (!ok) return <NotAvailable />;

  return (
    <main className="adsv2 pub-attribution-page" aria-label="Attribution">
      <div className="av2-head">
        <div className="av2-title">
          Attribution<span className="av2-tag">review</span>
        </div>
      </div>
      <AttributionWorkspace publicToken={token} />
    </main>
  );
}
