// Presentational, read-only Content view. No hooks/actions so it renders in BOTH the
// authed tab (ContentClient) and the public no-login page (/p/content/[token]).
import type { CreatorContent } from "@/lib/content-data";

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}
function dateShort(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

const SRC_LABEL: Record<string, string> = { buyer_trend: "from a buyer", dm_pain: "from DMs", caption_topic: "topic", call_pain: "from a call" };

export default function ContentView({ data, publicView = false }: { data: CreatorContent; publicView?: boolean }) {
  const { name, reels, ideas, words, summary } = data;
  const maxWord = words[0]?.count || 1;

  const stat = (label: string, value: string) => (
    <div className="glass" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: "14px 16px", minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>{value}</div>
      <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Summary */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {stat("Posts pulled", String(summary.posts))}
        {stat("Avg likes", fmt(summary.avgLikes))}
        {stat("Avg comments", fmt(summary.avgComments))}
        {stat("Transcribed", `${summary.transcribed}/${summary.posts}`)}
        {stat("Range", `${dateShort(summary.firstAt)} – ${dateShort(summary.lastAt)}`)}
      </div>

      {summary.posts === 0 && (
        <div className="glass" style={{ background: "var(--bg-card)", border: "1px dashed var(--border-hover)", borderRadius: 14, padding: 24, color: "var(--text-secondary)" }}>
          No content pulled yet for {name}. {publicView ? "Check back soon." : "Run an ingest from the Content tab to pull their reels."}
        </div>
      )}

      {/* Word intelligence */}
      {words.length > 0 && (
        <section>
          <h3 style={{ fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 12px" }}>
            What {name} talks about ({words.length} words across captions{summary.transcribed ? " + transcripts" : ""})
          </h3>
          <div className="glass" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, padding: 18, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {words.map((w) => {
              const scale = 0.85 + (w.count / maxWord) * 0.9;
              return (
                <span key={w.word} title={`${w.count}×`} style={{ fontSize: `${scale}rem`, fontWeight: scale > 1.3 ? 700 : 500, color: scale > 1.2 ? "var(--accent)" : "var(--text-secondary)", padding: "2px 8px", borderRadius: 8, background: "var(--bg-glass)" }}>
                  {w.word}<span style={{ fontSize: ".62rem", color: "var(--text-muted)", marginLeft: 4 }}>{w.count}</span>
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* Ideas bank */}
      <section>
        <h3 style={{ fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 12px" }}>
          Content idea bank — built from who actually buys + DM pain ({ideas.length})
        </h3>
        {ideas.length === 0 ? (
          <div className="glass" style={{ background: "var(--bg-card)", border: "1px dashed var(--border-hover)", borderRadius: 14, padding: 20, color: "var(--text-secondary)" }}>
            No ideas generated yet.{!publicView && " Hit “Generate ideas” to mine the buyer + DM data."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {ideas.map((idea) => (
              <div key={idea.id} className="glass" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 15 }}>{idea.title}</div>
                {idea.hook && <div style={{ color: "var(--accent)", fontStyle: "italic", fontSize: 13.5 }}>“{idea.hook}”</div>}
                {idea.angle && <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>{idea.angle}</div>}
                {idea.evidence && (
                  <div style={{ color: "var(--text-muted)", fontSize: 12, borderLeft: "2px solid var(--border-hover)", paddingLeft: 8 }}>
                    {idea.evidence}
                  </div>
                )}
                <span style={{ alignSelf: "flex-start", fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--accent)", background: "var(--accent-soft)", padding: "2px 8px", borderRadius: 6 }}>
                  {SRC_LABEL[idea.source || ""] || idea.source || "idea"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reels */}
      {reels.length > 0 && (
        <section>
          <h3 style={{ fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", margin: "0 0 12px" }}>
            Posts ({reels.length})
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
            {reels.map((r) => (
              <a key={r.id} href={r.permalink || "#"} target="_blank" rel="noreferrer"
                className="glass"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, overflow: "hidden", textDecoration: "none", display: "flex", flexDirection: "column" }}>
                <div style={{ aspectRatio: "9/16", background: "var(--bg-glass)", position: "relative" }}>
                  {r.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumbnail_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
                  ) : (
                    <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-muted)", fontSize: 11 }}>{r.media_type || "post"}</div>
                  )}
                  <span style={{ position: "absolute", top: 6, left: 6, fontSize: 9.5, letterSpacing: ".05em", textTransform: "uppercase", color: "#fff", background: "rgba(0,0,0,.55)", padding: "2px 6px", borderRadius: 5 }}>{r.media_type || "post"}</span>
                </div>
                <div style={{ padding: "10px 11px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {(r.caption || "(no caption)").slice(0, 140)}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
                    <span>♥ {fmt(r.like_count || 0)} · 💬 {fmt(r.comment_count || 0)}</span>
                    <span>{dateShort(r.taken_at)}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
