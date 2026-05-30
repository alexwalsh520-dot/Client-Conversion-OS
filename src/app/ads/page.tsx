// Never let the browser (or Next.js) freeze a stale copy of this page.
// The /ads route is always served fresh so the iframe below can never be
// pinned to an old cache-bust token.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdsTrackerPage() {
  // Fresh token every render so the iframe URL is one the browser has never
  // cached. This guarantees the newest ads tracker always loads.
  const cacheBust = Date.now();
  return (
    <main className="ads-export-page" aria-label="Ads Tracker">
      <iframe
        className="ads-export-frame"
        src={`/ads-tracker-export.html?v=roas-first-deep-dive-2026-05-31&t=${cacheBust}`}
        title="Ads Tracker"
      />
    </main>
  );
}
