import type { Metadata } from "next";
import SalesDashboardView from "./SalesDashboardView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sales Dashboard",
};

export default function SalesDashboardPage() {
  return <SalesDashboardView />;
}
