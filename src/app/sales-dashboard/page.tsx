import type { Metadata } from "next";
import MetricsDashboardView from "../master-dashboard/MetricsDashboardView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sales Dashboard",
};

export default function SalesDashboardPage() {
  return <MetricsDashboardView scope="sales" />;
}
