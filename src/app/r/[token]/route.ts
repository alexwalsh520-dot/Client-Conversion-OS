import { NextRequest, NextResponse } from "next/server";
import {
  decodeLeadToken,
  getGammaDocUrl,
  isLikelyBot,
  notifyGammaOpen,
} from "@/lib/outreach-link";

// Per-lead tracked redirect. The email's {{custom_doc_link}} points here;
// this logs the click (Slack ping with lead identity, from the bot) and
// 302-forwards to the shared Gamma doc. The recipient just lands on Gamma.
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const destination = getGammaDocUrl();

  const lead = decodeLeadToken(token);
  const userAgent = req.headers.get("user-agent");

  if (lead && lead.email && !isLikelyBot(userAgent)) {
    // Fire-and-forget: never block or fail the redirect on Slack issues.
    notifyGammaOpen(lead).catch((err) => {
      console.warn("[outreach] Gamma-open Slack notify failed:", err);
    });
  }

  return NextResponse.redirect(destination, 302);
}
