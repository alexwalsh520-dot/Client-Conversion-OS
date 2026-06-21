// Reuse the Ads tab's full-bleed CSS so the embedded inbox iframe gets a real
// height (100vh) instead of collapsing to a tiny default. Without this import the
// .ads-export-page / .ads-export-frame classes the /dms page uses are unstyled and
// the iframe renders as a sliver. Mirrors src/app/ads/layout.tsx exactly.
import "../ads/tracker.css";

export default function DmsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
