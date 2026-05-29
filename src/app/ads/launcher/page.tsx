// Always serve this page fresh so the browser can never freeze a stale copy.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function CampaignLauncherPage() {
  const cacheBust = Date.now();
  return (
    <main className="ads-export-page campaign-launcher-frame-page" aria-label="Campaign Launcher">
      <iframe
        className="ads-export-frame campaign-launcher-frame"
        src={`/campaign-launcher.html?v=launcher-safe-v1-2026-05-12&t=${cacheBust}`}
        title="Campaign Launcher"
      />
    </main>
  );
}
