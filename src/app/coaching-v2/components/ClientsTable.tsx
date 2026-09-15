"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Level } from "@/lib/coaching-v2/hub";
import { Dot } from "./bits";

export type Row = {
  id: number;
  name: string;
  coach: string;
  stage: string;
  days: number | null;
  score: number | null;
  lastCall: number | null;
  owed: number | null;
  health: Level;
  status: string;
  lastMsg: { who: "client" | "coach"; text: string; daysAgo: number } | null;
  nutritionWait: number | null;
};

const STAGES = ["All", "Onboarding", "Active", "Ending soon", "Needs a decision", "Completed"];
const VIEWS = ["Inbox", "Nutrition queue", "Low check ins"];
const ORDER: Record<Level, number> = { r: 0, a: 1, g: 2 };

export default function ClientsTable({ rows, manager }: { rows: Row[]; manager: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState("All");
  const [view, setView] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<[keyof Row, 1 | -1]>(["health", 1]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of STAGES) m[s] = s === "All" ? rows.filter((r) => r.status === "active").length : rows.filter((r) => r.stage === s).length;
    return m;
  }, [rows]);

  const shown = useMemo(() => {
    let list = rows.slice();
    if (view === null) list = stage === "All" ? list.filter((r) => r.status === "active") : list.filter((r) => r.stage === stage);
    if (view === "Inbox") list = list.filter((r) => r.lastMsg).sort((a, b) => (b.owed ?? 0) - (a.owed ?? 0) || (a.lastMsg?.daysAgo ?? 99) - (b.lastMsg?.daysAgo ?? 99));
    if (view === "Nutrition queue") list = list.filter((r) => r.nutritionWait !== null).sort((a, b) => (b.nutritionWait ?? 0) - (a.nutritionWait ?? 0));
    if (view === "Low check ins") list = list.filter((r) => r.score !== null && r.score < 60).sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
    if (q) list = list.filter((r) => (r.name + " " + r.coach).toLowerCase().includes(q.toLowerCase()));
    if (view === null) {
      const [k, dir] = sort;
      list.sort((a, b) => {
        let x: unknown = a[k], y: unknown = b[k];
        if (k === "health") { x = ORDER[a.health]; y = ORDER[b.health]; }
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        if (typeof x === "string" && typeof y === "string") return x.localeCompare(y) * dir;
        return ((x as number) - (y as number)) * dir;
      });
    }
    return list;
  }, [rows, stage, view, q, sort]);

  const th = (k: keyof Row, label: string, num = false) => (
    <th className={`sort ${num ? "num" : ""}`} onClick={() => setSort((s) => (s[0] === k ? [k, s[1] === 1 ? -1 : 1] : [k, 1]))}>
      {label}
      {sort[0] === k ? (sort[1] === 1 ? " ↑" : " ↓") : ""}
    </th>
  );
  const open = (id: number) => router.push(`/coaching-v2/clients/${id}`);
  const inbox = view === "Inbox";

  return (
    <>
      <div className="h2-head">
        <div>
          <h1>Clients</h1>
          <p className="h2-sub">{inbox ? "Conversations from Everfit, unanswered first" : manager ? "Every client" : "Your clients"}</p>
        </div>
      </div>
      <div className="h2-chips">
        {STAGES.map((s) => (
          <button key={s} className={`h2-chip ${stage === s && view === null ? "on" : ""}`} onClick={() => { setStage(s); setView(null); }}>
            {s}<span className="n">{counts[s]}</span>
          </button>
        ))}
        <span className="div" />
        {VIEWS.map((v) => (
          <button key={v} className={`h2-chip ${view === v ? "on" : ""}`} onClick={() => setView(view === v ? null : v)}>
            {v}
            {v === "Inbox" && <span className="n">{rows.filter((r) => r.owed).length} waiting</span>}
          </button>
        ))}
      </div>
      <div className="h2-search"><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>

      <div className="h2-tw">
        <table className="h2-table">
          {inbox ? (
            <>
              <thead><tr><th /><th>Client</th><th>Coach</th><th>Last message</th><th className="num">From</th><th className="num">When</th><th className="num">Reply owed</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="row" onClick={() => open(r.id)}>
                    <td><Dot lvl={r.health} /></td>
                    <td className="name">{r.name}</td>
                    <td>{r.coach || "–"}</td>
                    <td className="w" style={{ maxWidth: 360, color: r.lastMsg?.who === "client" ? "var(--text-primary)" : undefined }}>{r.lastMsg?.text}</td>
                    <td className="num">{r.lastMsg?.who === "client" ? "Client" : r.coach}</td>
                    <td className="num">{r.lastMsg?.daysAgo}d ago</td>
                    <td className={`num ${(r.owed ?? 0) >= 2 ? "h2-r" : ""}`}>{r.owed ? `${r.owed}d` : "–"}</td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={7} className="h2-empty">No conversations matched to clients yet.</td></tr>}
              </tbody>
            </>
          ) : (
            <>
              <thead>
                <tr>
                  {th("health", "")}
                  {th("name", "Client")}
                  {th("coach", "Coach")}
                  {th("stage", "Stage")}
                  {th("days", "Days left", true)}
                  {th("score", "Check in", true)}
                  {th("lastCall", "Last call", true)}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="row" onClick={() => open(r.id)}>
                    <td><Dot lvl={r.health} /></td>
                    <td className="name">{r.name}</td>
                    <td>{r.coach || "–"}</td>
                    <td><span className={`h2-pill ${r.stage === "Needs a decision" ? "r" : r.stage === "Ending soon" ? "a" : ""}`}>{r.stage}</span></td>
                    <td className={`num ${(r.days ?? 0) < 0 ? "h2-r" : ""}`}>{r.days ?? "–"}</td>
                    <td className={`num ${r.score !== null && r.score < 60 ? "h2-r" : r.score !== null && r.score < 75 ? "h2-a" : ""}`}>{r.score ?? "–"}</td>
                    <td className={`num ${(r.lastCall ?? 0) > 14 ? "h2-a" : ""}`}>{r.lastCall === null ? "–" : `${r.lastCall}d`}</td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={7} className="h2-empty">No clients match. Clear a filter.</td></tr>}
                {shown.length > 0 && (
                  <tr className="total">
                    <td />
                    <td>{shown.length} clients</td>
                    <td /><td />
                    <td className="num">{shown.filter((r) => (r.days ?? 0) < 0).length} expired</td>
                    <td className="num">{(() => { const s = shown.filter((r) => r.score !== null); return s.length ? Math.round(s.reduce((a, r) => a + (r.score ?? 0), 0) / s.length) + " avg" : "–"; })()}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </>
          )}
        </table>
      </div>
    </>
  );
}
