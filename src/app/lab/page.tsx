// The Lab tab runs the Tyson ad system (Test → Graduate → Scale) as a weekly
// cockpit. Like the Ads tab, it's a static instrument served in an iframe so it
// stays visually uniform with the Deep Dive and never pins a stale cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function LabPage() {
  const cacheBust = Date.now();
  return (
    <main className="ads-export-page" aria-label="Lab">
      <iframe
        className="ads-export-frame"
        src={`/lab.html?v=phase1-preview&t=${cacheBust}`}
        title="Lab"
      />
    </main>
  );
}
