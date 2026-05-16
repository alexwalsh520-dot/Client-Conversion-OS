import type { Metadata } from "next";
import MarketingBrainDashboard from "@/components/marketing-brain/MarketingBrainDashboard";
import { marketingBrainOverview } from "@/lib/marketing-brain/data";
import "./marketing-brain.css";

export const metadata: Metadata = {
  title: "Marketing Brain - CCOS",
  description: "The closed-loop marketing intelligence layer for Client Conversion OS.",
};

export default function MarketingBrainPage() {
  return <MarketingBrainDashboard data={marketingBrainOverview} />;
}
