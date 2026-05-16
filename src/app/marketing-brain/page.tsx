import type { Metadata } from "next";
import MarketingBrainDashboard from "@/components/marketing-brain/MarketingBrainDashboard";
import { getMarketingBrainOverview } from "@/lib/marketing-brain/engine";
import "./marketing-brain.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketing Brain - CCOS",
  description: "The closed-loop marketing intelligence layer for Client Conversion OS.",
};

export default async function MarketingBrainPage() {
  const data = await getMarketingBrainOverview();
  return <MarketingBrainDashboard data={data} />;
}
