"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ChevronDown } from "lucide-react";

type Icp = {
  one_line?: string;
  who_they_are?: string;
  top_pains?: string[];
  limiting_beliefs?: string[];
  desires?: string[];
  objections?: string[];
  triggers?: string[];
  language?: string[];
  disqualifiers?: string[];
};
type IcpRow = { version: number; mode: string; buyer_count: number; threshold_cents: number | null; icp: Icp; generated_at: string };
type Research = {
  summary?: string;
  what_brought_them_in?: string;
  pains?: string[];
  limiting_beliefs?: string[];
  objections?: string[];
  deciding_moment?: string;
  their_words?: string[];
};
type Dossier = {
  person_key: string;
  display_name: string;
  close_date: string | null;
  amount_cents: number | null;
  first_keyword: string | null;
  ad_on_image_text: string | null;
  data_completeness: { has_call?: boolean; has_dms?: boolean; dm_count?: number; has_ad?: boolean } | null;
  research: Research | null;
};
type Angle = { angle_type: string; title: string; hook: string | null; rationale: string | null };
type Grade = {
  ig_media_id: string;
  score: number;
  band: string;
  hits: string[];
  misses: string[];
  feedback: string;
  verdict: string;
  post: { caption: string | null; permalink: string | null; thumbnail_url: string | null; stored_thumb_url: string | null; like_count: number | null } | null;
};
type Payload = {
  icp: IcpRow | null;
  counts: { dossiers: number; researched: number; graded: number };
  dossiers: Dossier[];
  angles: Angle[];
  grades: Grade[];
};

const scoreColor = (s: number) => (s >= 70 ? "#37d67a" : s >= 45 ? "#e4c66a" : "#e0794d");

function Chips({ label, items, tone }: { label: string; items?: string[]; tone?: string }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "grid", gap: 6 }}>
        {items.map((x, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            <span style={{ color: tone || "var(--accent)", flexShrink: 0 }}>•</span>
            <span>{x}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BuyersView({ creator }: { creator: string }) {
  const [d, setD] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"icp" | "angles" | "buyers" | "grades">("icp");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/buyer-dna?creator=${creator}`, { cache: "no-store" });
      setD(await r.json());
    } finally {
      setLoading(false);
    }
  }, [creator]);
  useEffect(() => {
    load();
  }, [load]);

  const gradeStats = useMemo(() => {
    const g = d?.grades || [];
    if (!g.length) return null;
    const avg = Math.round(g.reduce((s, x) => s + (x.score || 0), 0) / g.length);
    const on = g.filter((x) => x.score >= 70).length;
    const partial = g.filter((x) => x.score >= 45 && x.score < 70).length;
    const off = g.filter((x) => x.score < 45).length;
    return { avg, on, partial, off, total: g.length };
  }, [d]);

  if (loading) return <div style={{ color: "var(--text-muted)", padding: 50, textAlign: "center" }}><Loader2 className="spin" /> Loading…</div>;
  if (!d) return <div style={{ color: "var(--text-muted)", padding: 40 }}>No data.</div>;

  const icp = d.icp?.icp;
  const withResearch = (d.dossiers || []).filter((x) => x.research && Object.keys(x.research).length);
  const sortedGrades = [...(d.grades || [])].sort((a, b) => a.score - b.score);

  const card: React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 22 };
  const tabs: [typeof tab, string, number][] = [
    ["icp", "The buyer", 0],
    ["angles", "Content angles", d.angles?.length || 0],
    ["buyers", "Who bought", withResearch.length],
    ["grades", "Scores", d.grades?.length || 0],
  ];

  return (
    <div>
      {/* sub-tabs */}
      <div style={{ display: "inline-flex", gap: 4, background: "var(--bg-glass)", borderRadius: 12, padding: 4, border: "1px solid var(--border-primary)", marginBottom: 20, flexWrap: "wrap" }}>
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: tab === k ? "var(--bg-card)" : "transparent", color: tab === k ? "var(--accent)" : "var(--text-muted)" }}>
            {label}{n ? <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.7 }}>{n}</span> : null}
          </button>
        ))}
      </div>

      {/* THE BUYER (ICP) */}
      {tab === "icp" && (
        !icp ? (
          <div style={card}>
            <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>No ideal-buyer profile yet for {creator}.</div>
          </div>
        ) : (
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#1a1a1a", background: "var(--accent)", padding: "3px 10px", borderRadius: 999 }}>
                {d.icp?.mode === "derived" ? "Learned from buyers" : "Chosen up front"}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {d.icp?.mode === "derived" ? `Learned from ${d.icp?.buyer_count} buyers who paid $${Math.round((d.icp?.threshold_cents || 0) / 100)}+` : "Fixed standard"} · v{d.icp?.version}
              </span>
            </div>
            {icp.one_line && <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.5, marginBottom: 12 }}>{icp.one_line}</div>}
            {icp.who_they_are && <p style={{ fontSize: 14.5, color: "var(--text-secondary)", lineHeight: 1.7, margin: "0 0 20px" }}>{icp.who_they_are}</p>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "8px 32px" }}>
              <Chips label="Top pains" items={icp.top_pains} tone="#e0794d" />
              <Chips label="Limiting beliefs" items={icp.limiting_beliefs} tone="#e4c66a" />
              <Chips label="What they want" items={icp.desires} tone="#37d67a" />
              <Chips label="What they hesitate on" items={icp.objections} tone="#e4c66a" />
              <Chips label="What was going on when they reached out" items={icp.triggers} />
              <Chips label="Words they use" items={icp.language} tone="var(--accent)" />
              <Chips label="Not this buyer if" items={icp.disqualifiers} tone="var(--text-muted)" />
            </div>
          </div>
        )
      )}

      {/* CONTENT ANGLES */}
      {tab === "angles" && (
        !d.angles?.length ? (
          <div style={card}><div style={{ color: "var(--text-secondary)", fontSize: 14 }}>No angles yet.</div></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
            {d.angles.map((a, i) => (
              <div key={i} style={{ ...card, padding: 18, borderLeft: "3px solid var(--accent)" }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 8px", lineHeight: 1.4 }}>{a.title}</div>
                {a.hook && <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 8 }}>&ldquo;{a.hook}&rdquo;</div>}
                {a.rationale && <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>Speaks to: {a.rationale}</div>}
              </div>
            ))}
          </div>
        )
      )}

      {/* WHO BOUGHT (dossiers) */}
      {tab === "buyers" && (
        !withResearch.length ? (
          <div style={card}><div style={{ color: "var(--text-secondary)", fontSize: 14 }}>No researched buyers yet.</div></div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{withResearch.length} buyers researched from their call and DMs.</div>
            {withResearch.map((b) => {
              const isOpen = !!open[b.person_key];
              const r = b.research || {};
              const dc = b.data_completeness || {};
              return (
                <div key={b.person_key} style={{ ...card, padding: 0, overflow: "hidden" }}>
                  <button onClick={() => setOpen((o) => ({ ...o, [b.person_key]: !isOpen }))}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                        {b.display_name}
                        {b.amount_cents ? <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", marginLeft: 10 }}>${Math.round(b.amount_cents / 100).toLocaleString()}</span> : null}
                      </div>
                      {r.summary && <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isOpen ? "normal" : "nowrap" }}>{r.summary}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {b.first_keyword && <span style={{ fontSize: 10.5, color: "var(--text-muted)", border: "1px solid var(--border-primary)", borderRadius: 999, padding: "2px 8px" }}>{b.first_keyword}</span>}
                      {dc.has_call && <span style={{ fontSize: 10.5, color: "#37d67a" }}>call</span>}
                      {dc.has_dms && <span style={{ fontSize: 10.5, color: "#7aa2f7" }}>DMs</span>}
                    </div>
                    <ChevronDown size={16} style={{ color: "var(--text-muted)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s", flexShrink: 0 }} />
                  </button>
                  {isOpen && (
                    <div style={{ padding: "0 20px 20px", borderTop: "1px solid var(--border-primary)" }}>
                      <div style={{ paddingTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "8px 32px" }}>
                        {r.what_brought_them_in && (
                          <div style={{ marginBottom: 16, gridColumn: "1 / -1" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>What brought them in</div>
                            <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>{r.what_brought_them_in}</div>
                          </div>
                        )}
                        <Chips label="Pains" items={r.pains} tone="#e0794d" />
                        <Chips label="Limiting beliefs" items={r.limiting_beliefs} tone="#e4c66a" />
                        <Chips label="Objections" items={r.objections} tone="#e4c66a" />
                        <Chips label="Their words" items={r.their_words} tone="var(--accent)" />
                      </div>
                      {r.deciding_moment && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>What tipped them into buying</div>
                          <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>{r.deciding_moment}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* POST GRADES */}
      {tab === "grades" && (
        !d.grades?.length ? (
          <div style={card}>
            <div style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>
              No posts scored yet for {creator}. Scoring runs automatically against your buyer as content comes in.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {gradeStats && (
              <div style={{ ...card, display: "flex", gap: 26, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: scoreColor(gradeStats.avg), lineHeight: 1 }}>{gradeStats.avg}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>average score, {gradeStats.total} posts</div>
                </div>
                <div style={{ display: "flex", gap: 18, fontSize: 13 }}>
                  <span style={{ color: "#8ce0ab" }}>{gradeStats.on} ON TARGET</span>
                  <span style={{ color: "#e4c66a" }}>{gradeStats.partial} CLOSE</span>
                  <span style={{ color: "#e0794d" }}>{gradeStats.off} DRIFT</span>
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Weakest first, so you know what to fix.</div>
              </div>
            )}
            {sortedGrades.map((g) => (
              <div key={g.ig_media_id} style={{ ...card, padding: 16, display: "flex", gap: 14 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor(g.score), width: 42, textAlign: "center", flexShrink: 0 }}>{g.score}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {g.post?.caption && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{g.post.caption}</div>}
                  {g.feedback && <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6 }}>{g.feedback}</div>}
                  {g.misses?.length ? <div style={{ fontSize: 12, color: "#e0794d", marginTop: 5 }}>Misses: {g.misses.slice(0, 2).join("; ")}</div> : null}
                  {g.post?.permalink && <a href={g.post.permalink} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--accent)", textDecoration: "none", marginTop: 5, display: "inline-block" }}>view post</a>}
                </div>
              </div>
            ))}
          </div>
        )
      )}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
