"use client";

// Playbook: the ideal buyer as a whole (the ICP), what is working on social right now for that
// buyer type, and 10 filmable video ideas graded against the current moment.

import { useState } from "react";
import { Clapperboard, Radar } from "lucide-react";
import { VideoIdeaCard, type VideoIdea } from "./VideoIdeaCard";

type Icp = {
  one_line?: string;
  who_they_are?: string;
  top_pains?: string[];
  desires?: string[];
  triggers?: string[];
  language?: string[];
};

export type TrendBriefView = {
  summary?: string;
  formats?: { name?: string; why?: string; signal?: string }[];
  hooks?: string[];
  do?: string[];
  avoid?: string[];
  searched?: boolean;
  asOf?: string;
};

const GREEN = "#8ce0ab", RED = "#e0794d";

function list(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

function chip(t: string, color: string, key: string) {
  return (
    <span key={key} style={{ fontSize: 12, color, border: `1px solid ${color}44`, background: `${color}12`, borderRadius: 999, padding: "4px 10px" }}>{t}</span>
  );
}

export default function IcpIdeasView({ icp, ideas, trend }: { icp: Icp | null; ideas: VideoIdea[]; trend: TrendBriefView | null }) {
  const [icpOpen, setIcpOpen] = useState(false);
  const [trendOpen, setTrendOpen] = useState(false);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* The buyer this playbook targets */}
      {icp && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--accent)", marginBottom: 8 }}>Your buyer</div>
          {icp.one_line && <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.5, marginBottom: 12 }}>{icp.one_line}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {list(icp.top_pains).slice(0, 3).map((p, i) => chip(p, RED, `p${i}`))}
            {list(icp.desires).slice(0, 2).map((p, i) => chip(p, GREEN, `d${i}`))}
            {list(icp.triggers).slice(0, 2).map((p, i) => chip(p, "var(--accent)", `t${i}`))}
          </div>
          <button onClick={() => setIcpOpen((v) => !v)} style={{ marginTop: 12, background: "none", border: "none", color: "var(--text-muted)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
            {icpOpen ? "Hide the full picture" : "See the full picture"}
          </button>
          {icpOpen && (
            <div style={{ marginTop: 12, fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              {icp.who_they_are && <p style={{ margin: "0 0 10px" }}>{icp.who_they_are}</p>}
              {list(icp.language).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{list(icp.language).slice(0, 10).map((w, i) => chip(w, "var(--text-muted)", `w${i}`))}</div>}
            </div>
          )}
        </div>
      )}

      {/* What is working right now */}
      {trend && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Radar size={15} style={{ color: "var(--accent)" }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--accent)" }}>Working on social right now</span>
            {trend.asOf && <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>as of {new Date(trend.asOf).toLocaleDateString()}</span>}
          </div>
          {trend.summary && <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.65, margin: "0 0 12px" }}>{trend.summary}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {(trend.formats || []).slice(0, 6).map((f, i) => f.name ? chip(f.name, GREEN, `f${i}`) : null)}
            {list(trend.avoid).slice(0, 3).map((a, i) => chip(`avoid: ${a}`, RED, `a${i}`))}
          </div>
          <button onClick={() => setTrendOpen((v) => !v)} style={{ marginTop: 12, background: "none", border: "none", color: "var(--text-muted)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
            {trendOpen ? "Hide the breakdown" : "See the breakdown"}
          </button>
          {trendOpen && (
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              {(trend.formats || []).map((f, i) => (
                <div key={i} style={{ border: "1px solid var(--border-primary)", borderRadius: 10, padding: "10px 13px" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", marginBottom: 3 }}>{f.name}</div>
                  {f.why && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>{f.why}</div>}
                  {f.signal && <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 4 }}>{f.signal}</div>}
                </div>
              ))}
              {list(trend.hooks).length > 0 && (
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>Hook styles landing now</div>
                  <div style={{ display: "grid", gap: 4 }}>{list(trend.hooks).map((h, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>&ldquo;{h}&rdquo;</div>)}</div>
                </div>
              )}
              {list(trend.do).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{list(trend.do).map((x, i) => chip(x, GREEN, `do${i}`))}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* The 10 ideas */}
      {ideas.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 2px" }}>
            10 videos built for your buyer as a whole, from everyone who has paid premium. Each one graded against what is working right now.
          </p>
          {ideas.map((idea, i) => <VideoIdeaCard key={i} idea={idea} index={i} />)}
        </div>
      ) : (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 40, textAlign: "center" }}>
          <Clapperboard size={26} style={{ color: "var(--text-muted)", marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>Your playbook is being built</div>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
            10 videos built from everyone who has bought, graded against what is working on social right now. Check back soon.
          </p>
        </div>
      )}
    </div>
  );
}
