import "./ads-v2.css";
import AdsV2Client from "./AdsV2Client";

// Behind the same login gate as every other CCOS tab (AccessGate in the root
// layout). No public route in this piece.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ads v2",
};

export default function AdsV2Page() {
  return <AdsV2Client />;
}
