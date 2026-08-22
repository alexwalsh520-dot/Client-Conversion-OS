import type { Metadata } from "next";
import MetricsDashboardView from "../master-dashboard/MetricsDashboardView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketing Dashboard",
};

export default function MarketingDashboardPage() {
  return <MetricsDashboardView scope="marketing" />;
}
