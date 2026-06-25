// Public, no-login Content view (auth bypassed for /p/content via proxy.ts).
// Shows the creator their Analytics + the audience read / verbatim quotes (read-only).
// The interactive coach chat stays in the authed app.
import { getContentForCreator, resolveContentToken } from "@/lib/content-data";
import AnalyticsView from "@/components/content/AnalyticsView";

export const dynamic = "force-dynamic";

const BUCKETS: { key: string; label: string }[] = [
  { key: "avatar", label: "Who's showing up" },
  { key: "pain", label: "Pain points" },
  { key: "objection", label: "Objections" },
  { key: "desire", label: "Desires" },
  { key: "lead_quality", label: "Lead-quality signals" },
];

export default async function PublicContentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const slug = await resolveContentToken(token);
  if (!slug) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg-primary, #0c0c0c)", color: "#aaa", fontFamily: "system-ui" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>This link isn’t available</div>
          <div style={{ marginTop: 6, fontSize: 14 }}>It may have been revoked. Ask for a fresh link.</div>
        </div>
      </main>
    );
  }
  const data = await getContentForCreator(slug);

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg-primary, #0c0c0c)", padding: "30px 22px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--accent, #c9a96e)" }}>Content</div>
          <h1 style={{ fontSize: 27, fontWeight: 700, color: "var(--text-primary, #fff)", margin: "4px 0 0" }}>{data.name}</h1>
        </div>

        {data.audience?.summary && (
          <div className="glass" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 16, marginBottom: 22 }}>
            <div style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>Who&apos;s actually showing up</div>
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.55 }}>{data.audience.summary}</p>
          </div>
        )}

        <AnalyticsView data={data} />

        {data.voc.length > 0 && (
          <div style={{ marginTop: 30 }}>
            <h3 style={{ fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 14px" }}>What your audience says — in their words</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {BUCKETS.map((b) => {
                const qs = data.voc.filter((q) => q.bucket === b.key);
                if (!qs.length) return null;
                return (
                  <div key={b.key} className="glass" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 12, padding: 14 }}>
                    <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 13.5, marginBottom: 8 }}>{b.label}</div>
                    {qs.slice(0, 6).map((q) => (
                      <div key={q.id} style={{ fontSize: 12.5, color: "var(--text-secondary)", fontStyle: "italic", borderLeft: "2px solid var(--accent)", paddingLeft: 8, marginBottom: 7, lineHeight: 1.45 }}>“{q.quote}”</div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
