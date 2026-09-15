"use client";

import { useMemo, useState } from "react";
import type { RetentionScore } from "@/lib/coaching-v3/types";
import { MessageSquarePlus, Send, Loader2, XCircle, Heart } from "lucide-react";

type HubClient = {
  id: number;
  name: string;
  coach: string;
  program: string;
  endDate: string | null;
  daysRemaining: number | null;
  latestCheckInScore: number | null;
  latestCheckInDaysAgo: number | null;
  workoutsCompleted7d: number | null;
  workoutsAssigned7d: number | null;
  lastClientMessageAt: string | null;
  lastCoachMessageDaysAgo: number | null;
  everfitSummary: string | null;
  everfitStale: boolean;
  retentionCycleOpen: boolean;
  hasExtensionRecordedThisCycle: boolean;
  score: RetentionScore;
  weeklyReports: {
    weekLabel: string;
    workoutPct: number | null;
    workoutsCompleted: number | null;
    workoutsAssigned: number | null;
    note: string | null;
  }[];
};

type OpenCycle = {
  id: number;
  clientId: number;
  enteredWindowAt: string;
  endDateAtEntry: string;
};

type Note = {
  id: number;
  cycleId: number;
  noteText: string;
  source: string;
  authorEmail: string;
  createdAt: string;
};

type MonthRetention = {
  windowStart: string;
  total: number;
  retained: number;
  lost: number;
  pct: number | null;
  byCoach: {
    coach: string;
    total: number;
    retained: number;
    lost: number;
    pct: number | null;
  }[];
};

type Props = {
  hubClients: HubClient[];
  openCycles: OpenCycle[];
  notes: Note[];
  monthRetention: MonthRetention;
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = (now.getTime() - d.getTime()) / (1000 * 60);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${Math.floor(diffMin)}m ago`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function bucketClass(b: RetentionScore["bucket"]): "g" | "a" | "r" | "u" {
  if (b === "likely") return "g";
  if (b === "coin_flip") return "a";
  if (b === "at_risk") return "r";
  return "u";
}

export default function RetentionsView({ hubClients, openCycles, notes, monthRetention }: Props) {
  // Only clients in the retention window (have an open cycle). Coaching v3
  // is deliberately narrower than the legacy Retentions tab — the score/notes/
  // detail all key off open cycles, and clients out of the window don't need
  // the working surface (they'll re-enter via sync later).
  const clientById = useMemo(() => new Map(hubClients.map((c) => [c.id, c])), [hubClients]);
  const openByClient = useMemo(() => new Map(openCycles.map((c) => [c.clientId, c])), [openCycles]);
  const notesByCycle = useMemo(() => {
    const m = new Map<number, Note[]>();
    for (const n of notes) {
      const arr = m.get(n.cycleId) ?? [];
      arr.push(n);
      m.set(n.cycleId, arr);
    }
    return m;
  }, [notes]);

  const [coachFilter, setCoachFilter] = useState<string>("__all__");
  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [manualId, setManualId] = useState<number | null>(null);
  const [manualText, setManualText] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const built = openCycles
      .map((cy) => {
        const c = clientById.get(cy.clientId);
        if (!c) return null;
        return { cycle: cy, client: c };
      })
      .filter((v): v is { cycle: OpenCycle; client: HubClient } => v !== null);
    // Sort by score ascending (worst first) so at-risk lands on top.
    built.sort(
      (a, b) =>
        a.client.score.score - b.client.score.score ||
        (a.client.daysRemaining ?? 999) - (b.client.daysRemaining ?? 999),
    );
    return built;
  }, [openCycles, clientById]);

  const coaches = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.client.coach || "Unassigned");
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const visible = useMemo(
    () =>
      coachFilter === "__all__"
        ? rows
        : rows.filter((r) => (r.client.coach || "Unassigned") === coachFilter),
    [rows, coachFilter],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, typeof visible>();
    for (const r of visible) {
      const k = r.client.coach || "Unassigned";
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  const postChat = async () => {
    const text = chatText.trim();
    if (!text || rows.length === 0) return;
    setChatSending(true);
    setError(null);
    try {
      const res = await fetch("/api/coaching/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add_note", text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setChatText("");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChatSending(false);
    }
  };

  const postManual = async (clientId: number) => {
    const text = manualText.trim();
    if (!text) return;
    setError(null);
    try {
      const res = await fetch("/api/coaching/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add_note", text, clientId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setManualId(null);
      setManualText("");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const oppLost = async (id: number, name: string) => {
    if (!confirm(`Mark ${name} as OPPORTUNITY LOST? This changes their status to Completed.`)) return;
    setBusyId(id);
    try {
      const res = await fetch("/api/coaching/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mark_opp_lost", clientId: id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const extend = async (id: number, name: string, weeks: 4 | 12) => {
    if (!confirm(`Extend ${name} by ${weeks} weeks?`)) return;
    setBusyId(id);
    try {
      const res = await fetch("/api/coaching/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "extend", clientId: id, weeks }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="h3-kpis">
        <div className="h3-kpi">
          <div className="l">Retention window</div>
          <div className="v">{rows.length}</div>
          <div className="d">Open cycles right now</div>
        </div>
        <div className="h3-kpi">
          <div className="l">This month</div>
          <div className={`v ${monthRetention.pct == null ? "" : monthRetention.pct >= 60 ? "g" : monthRetention.pct >= 40 ? "a" : "r"}`}>
            {monthRetention.pct == null ? "—" : `${monthRetention.pct}%`}
          </div>
          <div className="d">
            {monthRetention.retained} retained · {monthRetention.lost} lost · {monthRetention.total} decided
          </div>
        </div>
        <div className="h3-kpi">
          <div className="l">At-risk in window</div>
          <div className="v r">
            {rows.filter((r) => r.client.score.bucket === "at_risk").length}
          </div>
          <div className="d">Score under 40</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Likely to retain</div>
          <div className="v g">
            {rows.filter((r) => r.client.score.bucket === "likely").length}
          </div>
          <div className="d">Score 70+</div>
        </div>
      </div>

      {monthRetention.byCoach.length > 0 && (
        <section className="h3-sec">
          <h2>
            <span className="n">{monthRetention.byCoach.length}</span>
            Coaches, this month
          </h2>
          <div className="h3-coach-strip">
            {monthRetention.byCoach.map((c) => (
              <div className="h3-coach-cell" key={c.coach}>
                <div className="n">{c.coach}</div>
                <div className="m">
                  <span>{c.retained}/{c.total} retained</span>
                  <b style={{ color: c.pct == null ? "var(--text-muted)" : c.pct >= 60 ? "var(--success)" : c.pct >= 40 ? "var(--warning)" : "var(--danger)" }}>
                    {c.pct == null ? "—" : `${c.pct}%`}
                  </b>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Global chat */}
      <div className="h3-chat">
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontWeight: 600, color: "var(--text-primary)", fontSize: 12.5 }}>
          <MessageSquarePlus size={14} /> Note for every client in the window
        </div>
        <textarea
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          placeholder="Paste a transcript or type an update. Attaches to every currently open cycle."
        />
        <div className="toolbar">
          <span>Applies to {rows.length} open cycle{rows.length === 1 ? "" : "s"}.</span>
          <button
            className="h3-btn p"
            onClick={postChat}
            disabled={chatSending || !chatText.trim() || rows.length === 0}
          >
            {chatSending ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={12} />}
            Post to all
          </button>
        </div>
      </div>

      {coaches.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 12px" }}>
          <button
            className={`h3-btn s ${coachFilter === "__all__" ? "p" : ""}`}
            onClick={() => setCoachFilter("__all__")}
          >
            All ({rows.length})
          </button>
          {coaches.map((c) => {
            const n = rows.filter((r) => (r.client.coach || "Unassigned") === c).length;
            return (
              <button
                key={c}
                className={`h3-btn s ${coachFilter === c ? "p" : ""}`}
                onClick={() => setCoachFilter(c)}
              >
                {c} ({n})
              </button>
            );
          })}
        </div>
      )}

      {error && <div className="h3-notice err"><i />{error}</div>}

      {rows.length === 0 ? (
        <div className="h3-list"><div className="h3-empty">Nobody in the retention window. New cycles open automatically as end dates come within 14 days.</div></div>
      ) : (
        grouped.map(([coach, coachRows]) => (
          <section key={coach} className="h3-sec">
            <h2>
              <span className="n">{coachRows.length}</span>
              {coach}
            </h2>
            {coachRows.map(({ cycle, client }) => {
              const cls = bucketClass(client.score.bucket);
              const cyNotes = notesByCycle.get(cycle.id) ?? [];
              const days = client.daysRemaining;
              return (
                <div className="h3-retention-card" key={cycle.id}>
                  <div className="top">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="name">
                        <Heart size={13} style={{ marginRight: 4, color: "var(--danger)" }} />
                        {client.name}
                      </div>
                      <div className="meta">
                        <span className={days != null && days < 0 ? "r" : days != null && days <= 3 ? "a" : ""}>
                          {days == null ? "end date unknown" : days >= 0 ? `${days}d left` : `${-days}d past end`}
                        </span>
                        <span>{client.program}</span>
                        {client.workoutsAssigned7d != null && client.workoutsAssigned7d > 0 && (
                          <span>
                            Workouts{" "}
                            {client.workoutsAssigned7d === 100
                              ? `${client.workoutsCompleted7d ?? 0}%`
                              : `${client.workoutsCompleted7d ?? 0}/${client.workoutsAssigned7d}`}
                          </span>
                        )}
                        {client.latestCheckInScore != null && (
                          <span className={client.latestCheckInScore < 60 ? "r" : client.latestCheckInScore < 75 ? "a" : ""}>
                            Check-in {client.latestCheckInScore}/100
                          </span>
                        )}
                        {client.hasExtensionRecordedThisCycle && <span>Already extended</span>}
                      </div>
                      {client.weeklyReports.length > 0 && (
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                          {client.weeklyReports.map((w, i) => (
                            <div
                              key={i}
                              style={{
                                fontSize: 12,
                                color: "var(--text-secondary)",
                                padding: "6px 10px",
                                background: "var(--hover-bg-subtle, rgba(148,163,184,0.06))",
                                borderRadius: 6,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
                                <span>Week {w.weekLabel}</span>
                                <span>
                                  {w.workoutsAssigned != null && w.workoutsAssigned > 0
                                    ? `${w.workoutsCompleted ?? 0}/${w.workoutsAssigned}`
                                    : w.workoutPct == null
                                      ? "—"
                                      : `${Math.round(w.workoutPct)}%`}
                                </span>
                              </div>
                              {w.note && (
                                <div style={{ marginTop: 3, whiteSpace: "pre-wrap", fontStyle: "italic" }}>
                                  &ldquo;{w.note}&rdquo;
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="h3-reasons">
                        {client.score.reasons.slice(0, 4).map((r, i) => (
                          <span key={i}>· {r}</span>
                        ))}
                      </div>
                    </div>
                    <div className="score">
                      <div className={`pct ${cls}`}>
                        {client.score.bucket === "unknown" ? "—" : `${client.score.score}%`}
                      </div>
                      <div className="lbl">Retain chance</div>
                    </div>
                  </div>

                  <div className="actions" style={{ marginTop: 10 }}>
                    <button
                      className="h3-btn s"
                      disabled={busyId === client.id}
                      onClick={() => extend(client.id, client.name, 4)}
                    >
                      +4 weeks
                    </button>
                    <button
                      className="h3-btn s"
                      disabled={busyId === client.id}
                      onClick={() => extend(client.id, client.name, 12)}
                    >
                      +12 weeks
                    </button>
                    <button
                      className="h3-btn s r"
                      disabled={busyId === client.id}
                      onClick={() => oppLost(client.id, client.name)}
                    >
                      <XCircle size={11} /> Opp Lost
                    </button>
                  </div>

                  {cyNotes.length > 0 && (
                    <div className="h3-notes">
                      {cyNotes.map((n) => (
                        <div className="h3-note" key={n.id}>
                          <div className="body">{n.noteText}</div>
                          <div className="footer">
                            {n.source === "chat_batch" ? "chat" : "manual"} · {n.authorEmail} · {fmtWhen(n.createdAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {manualId === client.id ? (
                    <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                      <textarea
                        autoFocus
                        value={manualText}
                        onChange={(e) => setManualText(e.target.value)}
                        placeholder={`Note for ${client.name}…`}
                        rows={2}
                        style={{
                          flex: 1,
                          resize: "vertical",
                          fontFamily: "inherit",
                          fontSize: 12,
                          padding: 8,
                          background: "var(--bg-input, var(--bg-card))",
                          color: "var(--text-primary)",
                          border: "1px solid var(--border-primary)",
                          borderRadius: 6,
                        }}
                      />
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <button className="h3-btn s p" onClick={() => postManual(client.id)}>
                          Save
                        </button>
                        <button
                          className="h3-btn s"
                          onClick={() => {
                            setManualId(null);
                            setManualText("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="h3-btn s"
                      style={{ marginTop: 8, borderStyle: "dashed" }}
                      onClick={() => {
                        setManualId(client.id);
                        setManualText("");
                      }}
                    >
                      <MessageSquarePlus size={11} /> Add manual note
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        ))
      )}
    </>
  );
}
