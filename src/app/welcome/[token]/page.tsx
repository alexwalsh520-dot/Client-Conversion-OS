/**
 * Public partner onboarding portal at /welcome/<token>.
 *
 * Unauthenticated, noindex. The only "key" is the unguessable token in the
 * URL, which the team generates per partner in the back office. Bypasses the
 * auth proxy via the `api/onboarding/public` + `welcome` entries in
 * src/proxy.ts and the `/welcome/` prefix in AccessGate.tsx. The Sidebar
 * hides itself on this path so the partner sees a clean, branded page.
 */

import type { Metadata } from "next";
import WelcomePortal from "@/components/onboarding/WelcomePortal";

export const metadata: Metadata = {
  title: "Welcome aboard · CoreShift",
  description: "Your quick onboarding — a few small steps to get you set up.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function WelcomePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <WelcomePortal token={token} />;
}
