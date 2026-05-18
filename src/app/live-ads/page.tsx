import { getLiveAdsDashboard } from "@/lib/live-ads";
import LiveAdsBrowser from "./LiveAdsBrowser";

export const dynamic = "force-dynamic";

export default async function LiveAdsPage() {
  const data = await getLiveAdsDashboard();
  return <LiveAdsBrowser data={data} />;
}
