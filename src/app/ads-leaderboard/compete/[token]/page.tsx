// Public, tokenized contestant flow for the Ads Leaderboard contest.
// No CCOS login — the contestant opens this via their unguessable token link and
// resumes exactly where they left off (state is DB-backed via the token).

import type { Metadata } from "next";
import CompeteFlow from "./CompeteFlow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Make Your Ad — Client Conversion",
  robots: { index: false, follow: false },
};

export default async function CompetePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CompeteFlow token={token} />;
}
