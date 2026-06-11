// Public-facing Ads Leaderboard — the front-facing view where competing client
// ads are shown, ranked. No login, no financials. Premium gallery.

import type { Metadata } from "next";
import PublicLeaderboard from "./PublicLeaderboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Leaderboard — Client Conversion",
  robots: { index: false, follow: false },
};

export default function BoardPage() {
  return <PublicLeaderboard />;
}
