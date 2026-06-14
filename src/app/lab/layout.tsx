// The Lab tab renders its instrument in a full-bleed iframe, exactly like the
// Ads tab. It reuses the Ads tracker's CSS so `.ads-export-page` /
// `.ads-export-frame` size the iframe to the full viewport (without this the
// iframe falls back to the ~300x150 default box).
import "../ads/tracker.css";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
