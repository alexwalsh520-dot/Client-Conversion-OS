"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, ClipboardList, Heart, Zap } from "lucide-react";
import CheckinModal, {
  ModalShell,
  daysAgo,
  fmtDate,
  type CheckInSubmission,
} from "./components/CheckinModal";
export type { CheckInSubmission };

export type ClientRow = {
  id: number;
  name: string;
  coach: string;
  endDate: string | null;
  daysRemaining: number | null;
  latestCheckInScore: number | null;
  latestCheckInDaysAgo: number | null;
  workoutsCompleted7d: number | null;
  workoutsAssigned7d: number | null;
  todayBuckets: string[];
  weeklyReports: {
    weekLabel: string;
    workoutPct: number | null;
    workoutsCompleted: number | null;
    workoutsAssigned: number | null;
    note: string | null;
  }[];
  isGhosting: boolean;
  zeroWorkoutStreakWeeks: number;
};

type Props = {
  clients: ClientRow[];
  checkIns: CheckInSubmission[];
  latestSheetSync: {
    pulledAt: string | null;
    clientsSeen: number;
    isStale: boolean;
  } | null;
  monthRetention: {
    retentionCount: number;
    retentionRevenue: number;
    refundCount: number;
    refundAmount: number;
  };
};

function workoutsCell(r: ClientRow): string {
  const a = r.workoutsAssigned7d;
  const d = r.workoutsCompleted7d;
  if (a == null || a === 0) return "—";
  if (a === 100) return `${d ?? 0}%`;
  return `${d ?? 0}/${a}`;
}

export default function TodayView({ clients, checkIns, latestSheetSync, monthRetention }: Props) {
  const [coachFilter, setCoachFilter] = useState("__all__");
  const [checkinPopup, setCheckinPopup] = useState<CheckInSubmission | null>(null);
  const [notesPopupClientId, setNotesPopupClientId] = useState<number | null>(null);

  const coaches = useMemo(() => {
    const s = new Set<string>();
    for (const c of clients) s.add(c.coach || "Unassigned");
    for (const c of checkIns) s.add(c.coachName || "Unassigned");
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [clients, checkIns]);

  const checkInsFiltered = useMemo(
    () =>
      coachFilter === "__all__"
        ? checkIns
        : checkIns.filter((r) => (r.coachName || "Unassigned") === coachFilter),
    [checkIns, coachFilter],
  );

  const pastEnd = useMemo(
    () =>
      clients
        .filter((c) => c.todayBuckets.includes("past_end"))
        .filter((c) => coachFilter === "__all__" || (c.coach || "Unassigned") === coachFilter)
        .sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0)),
    [clients, coachFilter],
  );

  const zeroWorkouts = useMemo(
    () =>
      clients
        .filter((c) => c.todayBuckets.includes("zero_workouts"))
        .filter((c) => coachFilter === "__all__" || (c.coach || "Unassigned") === coachFilter)
        .sort((a, b) => b.zeroWorkoutStreakWeeks - a.zeroWorkoutStreakWeeks),
    [clients, coachFilter],
  );

  const totalToday =
    new Set([
      ...checkInsFiltered.map((r) => `ci-${r.id}`),
      ...pastEnd.map((r) => `pe-${r.id}`),
      ...zeroWorkouts.map((r) => `zw-${r.id}`),
    ]).size;

  return (
    <>
      <div className="h3-kpis">
        <Kpi label="Need attention today" value={String(totalToday)} tone={totalToday > 0 ? "r" : "g"} sub="Across all sections" />
        <Kpi label="Active roster" value={String(clients.length)} sub="Every active client" />
        <Kpi
          label="This month retention"
          value={monthRetention.retentionCount === 0 ? "0" : `$${Math.round(monthRetention.retentionRevenue).toLocaleString("en-US")}`}
          tone={monthRetention.retentionCount > 0 ? "g" : undefined}
          sub={`${monthRetention.retentionCount} retentions · $${Math.round(monthRetention.refundAmount).toLocaleString("en-US")} refunded`}
        />
        <Kpi
          label="Sheet sync freshness"
          value={!latestSheetSync ? "None" : latestSheetSync.isStale ? "Stale" : "Fresh"}
          tone={!latestSheetSync ? "r" : latestSheetSync.isStale ? "a" : "g"}
          sub={latestSheetSync ? `${latestSheetSync.clientsSeen} clients` : "Pull to start"}
        />
      </div>

      {coaches.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 16px" }}>
          <button
            className={`h3-btn s ${coachFilter === "__all__" ? "p" : ""}`}
            onClick={() => setCoachFilter("__all__")}
          >
            All
          </button>
          {coaches.map((c) => (
            <button
              key={c}
              className={`h3-btn s ${coachFilter === c ? "p" : ""}`}
              onClick={() => setCoachFilter(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Section 1: Low check-ins */}
      <Section
        icon={<ClipboardList size={13} />}
        title="Low check-ins"
        count={checkInsFiltered.length}
        subtitle="Score under 60, last 7 days · click a row for full details"
        empty="No low check-ins this week."
      >
        {checkInsFiltered.map((r) => (
          <div className="h3-li" key={r.id} onClick={() => setCheckinPopup(r)} style={{ cursor: "pointer" }}>
            <span
              className={`dot ${r.score < 40 ? "r" : r.score < 55 ? "a" : "u"}`}
            />
            <div className="main">
              <div className="row1">
                <span className="name">{r.clientName}</span>
                <span className="coach">{r.coachName}</span>
              </div>
              <div className="row2">
                <span>{daysAgo(r.submittedAt)}d ago · {fmtDate(r.submittedAt)}</span>
                {r.text && (
                  <span
                    style={{
                      maxWidth: 620,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontStyle: "italic",
                      color: "var(--text-muted)",
                    }}
                    title={r.text}
                  >
                    &ldquo;{r.text}&rdquo;
                  </span>
                )}
              </div>
            </div>
            <div className="aside">
              <div className={`pct ${r.score < 40 ? "r" : r.score < 55 ? "a" : "u"}`}>{r.score}</div>
              <div className="lbl">check-in</div>
            </div>
          </div>
        ))}
      </Section>

      {/* Section 2: Past end date */}
      <Section
        icon={<Heart size={13} style={{ color: "var(--danger)" }} />}
        title="Past end date, no decision"
        count={pastEnd.length}
        subtitle="Open retention cycle, program has ended · click for notes"
        empty="Nobody is past their end date without a decision."
      >
        {pastEnd.map((r) => (
          <div className="h3-li" key={r.id} onClick={() => setNotesPopupClientId(r.id)} style={{ cursor: "pointer" }}>
            <span className="dot r" />
            <div className="main">
              <div className="row1">
                <span className="name">{r.name}</span>
                <span className="coach">{r.coach}</span>
              </div>
              <div className="row2">
                <span className="r">
                  {r.daysRemaining != null ? `${Math.abs(r.daysRemaining)}d past end` : "end unknown"}
                </span>
                <span>Workouts {workoutsCell(r)}</span>
                {r.latestCheckInScore != null && (
                  <span className={r.latestCheckInScore < 60 ? "r" : r.latestCheckInScore < 75 ? "a" : ""}>
                    Check-in {r.latestCheckInScore}/100
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </Section>

      {/* Section 3: Zero workouts */}
      <Section
        icon={<Zap size={13} style={{ color: "var(--warning)" }} />}
        title="Zero workouts last 7 days"
        count={zeroWorkouts.length}
        subtitle="2+ weeks in a row = ghosting"
        empty="Nobody is at zero workouts this week."
      >
        {zeroWorkouts.map((r) => (
          <div className="h3-li" key={r.id} style={{ alignItems: "flex-start" }}>
            <span className={`dot ${r.isGhosting ? "r" : "a"}`} />
            <div className="main">
              <div className="row1">
                <span className="name">{r.name}</span>
                <span className="coach">{r.coach}</span>
                {r.isGhosting && (
                  <span className="bucket r" title={`${r.zeroWorkoutStreakWeeks} straight weeks of 0%`}>
                    ghosting · {r.zeroWorkoutStreakWeeks}w
                  </span>
                )}
                {r.latestCheckInScore != null && (
                  <span
                    className="bucket u"
                    style={{
                      background:
                        r.latestCheckInScore < 50
                          ? "rgba(239,68,68,0.14)"
                          : r.latestCheckInScore < 75
                            ? "rgba(245,158,11,0.15)"
                            : "rgba(34,197,94,0.14)",
                      color:
                        r.latestCheckInScore < 50
                          ? "var(--danger)"
                          : r.latestCheckInScore < 75
                            ? "var(--warning)"
                            : "var(--success)",
                    }}
                  >
                    check-in {r.latestCheckInScore}
                  </span>
                )}
              </div>
              <div className="row2">
                <span>{r.daysRemaining != null ? (r.daysRemaining >= 0 ? `${r.daysRemaining}d left` : `${-r.daysRemaining}d past end`) : "end unknown"}</span>
                <span>Workouts {workoutsCell(r)}</span>
              </div>
              {/* Weekly notes from the sheet */}
              {r.weeklyReports.length > 0 && (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  {r.weeklyReports.slice(0, 3).map((w, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 11.5,
                        color: "var(--text-muted)",
                        padding: "5px 8px",
                        background: "var(--hover-bg-subtle, rgba(148,163,184,0.06))",
                        borderRadius: 5,
                      }}
                    >
                      <span style={{ fontWeight: 600, marginRight: 6 }}>
                        {w.weekLabel} ·{" "}
                        {w.workoutsAssigned != null && w.workoutsAssigned > 0
                          ? `${w.workoutsCompleted ?? 0}/${w.workoutsAssigned}`
                          : w.workoutPct != null
                            ? `${Math.round(w.workoutPct)}%`
                            : "—"}
                      </span>
                      {w.note ? (
                        <span style={{ fontStyle: "italic" }}>&ldquo;{w.note}&rdquo;</span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>no note</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </Section>

      {totalToday === 0 && (
        <div className="h3-list">
          <div className="h3-empty">Nothing needs a human today.</div>
        </div>
      )}

      {checkinPopup && (
        <CheckinModal submission={checkinPopup} onClose={() => setCheckinPopup(null)} />
      )}
      {notesPopupClientId !== null && (
        <NotesModal
          clientId={notesPopupClientId}
          onClose={() => setNotesPopupClientId(null)}
        />
      )}
    </>
  );
}

function Section({
  icon,
  title,
  count,
  subtitle,
  empty,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  subtitle: string;
  empty: string;
  children: React.ReactNode;
}) {
  const kids = Array.isArray(children) ? children : [children];
  const hasChildren = kids.filter(Boolean).length > 0 && count > 0;
  return (
    <section className="h3-sec">
      <h2>
        <span className="n">{count}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {icon}
          {title}
        </span>
        <span className="why">{subtitle}</span>
      </h2>
      <div className="h3-list">
        {hasChildren ? children : <div className="h3-empty">{empty}</div>}
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "r" | "a" | "g";
}) {
  return (
    <div className="h3-kpi">
      <div className="l">{label}</div>
      <div className={`v ${tone ?? ""}`}>{value}</div>
      {sub && <div className="d">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes modal (past-end popup). CheckinModal + ModalShell now live in the
// shared components file so the Clients drawer can reuse them.
// ---------------------------------------------------------------------------

type NoteDetail = {
  client: {
    id: number;
    name: string;
    coachName: string;
    program: string | null;
    endDate: string | null;
  };
  clientNotes: { text: string; by: string; at: string }[];
  cycles: {
    id: number;
    enteredWindowAt: string;
    outcome: string | null;
    outcomeAt: string | null;
    outcomeBy: string | null;
  }[];
  retentionNotes: {
    id: number;
    cycleId: number;
    text: string;
    source: string;
    author: string;
    at: string;
  }[];
};

function NotesModal({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const [data, setData] = useState<NoteDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/coaching-v3/client-detail?clientId=${clientId}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setData(body);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  return (
    <ModalShell onClose={onClose}>
      {!data && !err && (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>
          <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      )}
      {err && (
        <div style={{ padding: 12, color: "var(--danger)" }}>Failed to load: {err}</div>
      )}
      {data && (
        <>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
            {data.client.name}
          </h3>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>
            {data.client.coachName} · {data.client.program ?? "—"} · ends{" "}
            {data.client.endDate ? new Date(data.client.endDate).toLocaleDateString() : "—"}
          </div>

          <section style={{ marginTop: 16 }}>
            <h4 style={{ margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: 0.05, textTransform: "uppercase", color: "var(--text-muted)" }}>
              Client notes ({data.clientNotes.length})
            </h4>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
              {data.clientNotes.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                  No client notes.
                </div>
              )}
              {data.clientNotes.map((n, i) => (
                <div
                  key={i}
                  style={{
                    padding: "8px 10px",
                    background: "var(--hover-bg-subtle, rgba(148,163,184,0.06))",
                    borderRadius: 6,
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>{n.text}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 4 }}>
                    {n.by || "—"} · {fmtDate(n.at)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginTop: 16 }}>
            <h4 style={{ margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: 0.05, textTransform: "uppercase", color: "var(--text-muted)" }}>
              Retention cycles + notes ({data.retentionNotes.length})
            </h4>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 10 }}>
              {data.cycles.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                  No retention cycles yet.
                </div>
              )}
              {data.cycles.map((cy) => {
                const cyNotes = data.retentionNotes.filter((n) => n.cycleId === cy.id);
                return (
                  <div
                    key={cy.id}
                    style={{
                      padding: "8px 10px",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-primary)",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                      <span>Entered {new Date(cy.enteredWindowAt).toLocaleDateString()}</span>
                      <span>
                        {cy.outcome ? (
                          <b style={{ color: cy.outcome === "opp_lost" ? "var(--danger)" : "var(--success)" }}>
                            {cy.outcome}
                          </b>
                        ) : (
                          <b style={{ color: "var(--warning)" }}>open</b>
                        )}
                      </span>
                    </div>
                    {cyNotes.length === 0 ? (
                      <div style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 12 }}>
                        No notes on this cycle.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {cyNotes.map((n) => (
                          <div
                            key={n.id}
                            style={{
                              padding: "6px 8px",
                              background: "var(--hover-bg-subtle, rgba(148,163,184,0.06))",
                              borderRadius: 4,
                              fontSize: 12,
                            }}
                          >
                            <div style={{ whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>{n.text}</div>
                            <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 3 }}>
                              {n.source === "chat_batch" ? "chat" : "manual"} · {n.author} · {fmtDate(n.at)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </ModalShell>
  );
}

