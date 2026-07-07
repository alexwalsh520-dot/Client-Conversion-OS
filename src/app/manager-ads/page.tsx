import type { Metadata } from "next";
import ManagerAdsView from "./ManagerAdsView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manager Ads View",
};

export default function ManagerAdsPage() {
  return <ManagerAdsView />;
}
