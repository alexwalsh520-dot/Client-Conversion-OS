// Always serve fresh so the embedded inbox iframe never pins to a stale cache token.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function DmsPage() {
  const cacheBust = Date.now();
  return (
    <main className="ads-export-page" aria-label="DMs">
      <iframe
        className="ads-export-frame"
        src={`/dms-export.html?v=dms-v4&t=${cacheBust}`}
        title="DMs"
      />
    </main>
  );
}
