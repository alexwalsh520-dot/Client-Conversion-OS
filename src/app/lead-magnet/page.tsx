import type { Metadata } from "next";
import LeadMagnetView from "./LeadMagnetView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lead Magnet Funnel",
};

export default function LeadMagnetPage() {
  return <LeadMagnetView />;
}
