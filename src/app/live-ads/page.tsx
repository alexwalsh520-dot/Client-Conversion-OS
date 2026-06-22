import { getLiveAdsDashboard } from "@/lib/live-ads";
import LiveAdsBrowser from "./LiveAdsBrowser";
import ShareLiveAdsButton from "./ShareLiveAdsButton";

export const dynamic = "force-dynamic";

export default async function LiveAdsPage() {
  const data = await getLiveAdsDashboard();
  return <LiveAdsBrowser data={data} headerSlot={<ShareLiveAdsButton account="antwan" />} />;
}
