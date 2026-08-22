import type { Metadata } from "next";
import MetricsDashboardView from "./MetricsDashboardView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Master Dashboard",
};

export default function MasterDashboardPage() {
  return <MetricsDashboardView scope="master" />;
}
