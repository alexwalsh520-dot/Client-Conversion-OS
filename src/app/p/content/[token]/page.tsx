// Public, no-login Content view for a creator (Tyson / Antwan).
// Auth is bypassed via AccessGate's /p/content/ allowlist; chrome is stripped via
// public.css. Shows the creator their Analytics + audience read + verbatim quotes
// (read-only). The interactive coach chat stays in the authed app.
import type { Metadata } from "next";
import { getContentForCreator, resolveContentToken } from "@/lib/content-data";
import AnalyticsView from "@/components/content/AnalyticsView";
import "./public.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Content — Client Conversion",
  robots: { index: false, follow: false },
};

// The full voice-of-customer taxonomy (more than the old 4–5 — built for content ideation).
const BUCKETS: { key: string; label: string; hint: string }[] = [
  { key: "avatar", label: "Who's showing up", hint: "the real person watching + buying" },
  { key: "pain", label: "Pain points", hint: "what hurts, in their words" },
  { key: "desire", label: "Desires", hint: "what they actually want" },
  { key: "objection", label: "Objections", hint: "what stops them" },
  { key: "hook", label: "Hooks that land", hint: "lines that stop the scroll" },
  { key: "topic", label: "Topics they ask about", hint: "questions = reel ideas" },
  { key: "transformation", label: "Transformation language", hint: "how wins get described" },
  { key: "vocabulary", label: "Their exact words", hint: "phrases to mirror in copy" },
  { key: "lead_quality", label: "Lead-quality signals", hint: "buyers vs tire-kickers" },
];

export default async function PublicContentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const slug = await resolveContentToken(token);
  if (!slug) {
    return (
      <div className="pub-unavailable">
        <div className="pub-unavailable-card">
          <h1>This link isn&apos;t available</h1>
          <p>It may have been revoked. Ask for a fresh link.</p>
        </div>
      </div>
    );
  }
  const data = await getContentForCreator(slug);

  return (
    <main className="pub-content-page" style={{ minHeight: "100vh", background: "var(--bg-primary, #0c0c0c)", padding: "30px 22px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--accent, #c9a96e)" }}>Content Studio</div>
          <h1 style={{ fontSize: 27, fontWeight: 700, color: "var(--text-primary, #fff)", margin: "4px 0 0" }}>{data.name}</h1>
          <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13.5 }}>
            Your content, ranked by what works — plus exactly who&apos;s showing up and what they say, so you always know what to post next.
          </p>
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
            <h3 style={{ fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 14px" }}>
              What your audience says — in their words
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {BUCKETS.map((b) => {
                const qs = data.voc.filter((q) => q.bucket === b.key);
                if (!qs.length) return null;
                return (
                  <div key={b.key} className="glass" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 12, padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 9 }}>
                      <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 13.5 }}>{b.label}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{b.hint}</span>
                      {(data.vocCounts[b.key] || qs.length) > 6 && (
                        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--accent)" }}>{data.vocCounts[b.key] || qs.length}</span>
                      )}
                    </div>
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
