"use client";

import { useEffect, useMemo, useState } from "react";
import type { RetentionScore } from "@/lib/coaching-v3/types";
import { Search, X, Filter, Loader2, ClipboardList, Calendar, Video, Pencil, Plus, Link2, Check } from "lucide-react";
import CheckinModal, { type CheckInSubmission } from "../components/CheckinModal";

type MeetingRow = {
  id: number;
  clientId: number | null;
  clientName: string;
  coachName: string;
  meetingDate: string;
  notes: string;
  fathomLink: string | null;
  fathomLinkAddedAt: string | null;
  createdAt: string | null;
};

type MilestoneRow = {
  id: number;
  videoTestimonial: {
    promptedDate: string | null;
    completed: boolean;
    completionDate: string | null;
  };
  writtenTestimonial: {
    promptedDate: string | null;
    completed: boolean;
    completionDate: string | null;
  };
};

export type Row = {
  id: number;
  status: "active" | "completed";
  name: string;
  coach: string;
  program: string;
  endDate: string | null;
  daysRemaining: number | null;
  startDate: string | null;
  score: RetentionScore;
  workoutsCompleted7d: number | null;
  workoutsAssigned7d: number | null;
  latestCheckInScore: number | null;
  latestCheckInDaysAgo: number | null;
  retentionCycleOpen: boolean;
  todayBuckets: string[];
  isGhosting: boolean;
  zeroWorkoutStreakWeeks: number;
  weeklyReports: {
    weekLabel: string;
    weekEndingAt: string;
    workoutPct: number | null;
    workoutsCompleted: number | null;
    workoutsAssigned: number | null;
    note: string | null;
  }[];
};

type Preset = "all" | "retention" | "ghost" | "recent" | "completed";

const PRESET_LABEL: Record<Preset, string> = {
  all: "All active",
  retention: "Retention window",
  ghost: "Ghost",
  recent: "Onboarded ≤ 14d",
  completed: "Completed",
};

type SortKey = "score" | "days" | "checkin" | "workouts" | "name" | "coach";
type SortDir = "asc" | "desc";

function daysToStart(startDate: string | null): number | null {
  if (!startDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate);
  if (!m) return null;
  const start = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - start) / 86_400_000);
}

function scoreColor(b: RetentionScore["bucket"]): "g" | "a" | "r" | "u" {
  if (b === "likely") return "g";
  if (b === "coin_flip") return "a";
  if (b === "at_risk") return "r";
  return "u";
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "6px 8px",
  fontSize: 12,
  background: "var(--bg-input, var(--bg-card))",
  color: "var(--text-primary)",
  border: "1px solid var(--border-primary)",
  borderRadius: 5,
};

function matchesPreset(r: Row, p: Preset): boolean {
  // Every preset except "completed" hides completed clients by default —
  // the "completed" chip is the single place a coach or MAS surfaces them.
  if (p !== "completed" && r.status === "completed") return false;
  switch (p) {
    case "all":
      return true;
    case "retention":
      return r.retentionCycleOpen;
    case "ghost":
      // Ghost = active client with 2+ consecutive weeks of zero-workout
      // reports on the assistant's sheet (MAS 2026-09-16).
      return r.isGhosting;
    case "recent": {
      const d = daysToStart(r.startDate);
      return d !== null && d >= 0 && d <= 14;
    }
    case "completed":
      return r.status === "completed";
  }
}

export default function ClientsView({ rows }: { rows: Row[] }) {
  const [preset, setPreset] = useState<Preset>("all");
  const [search, setSearch] = useState("");
  const [coachFilter, setCoachFilter] = useState<string>("__all__");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [drawerId, setDrawerId] = useState<number | null>(null);

  const coaches = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.coach || "Unassigned");
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // When the user is typing a search, ignore the preset — bring completed
    // clients into the results too, so an old client can be found by name.
    // Preset only constrains what shows when the search box is empty.
    return rows.filter((r) => {
      if (coachFilter !== "__all__" && (r.coach || "Unassigned") !== coachFilter) return false;
      if (q) return r.name.toLowerCase().includes(q);
      return matchesPreset(r, preset);
    });
  }, [rows, preset, coachFilter, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "score":
          cmp = a.score.score - b.score.score;
          break;
        case "days":
          cmp = (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999);
          break;
        case "checkin":
          cmp = (a.latestCheckInScore ?? 999) - (b.latestCheckInScore ?? 999);
          break;
        case "workouts": {
          const av = a.workoutsAssigned7d && a.workoutsAssigned7d > 0 ? (a.workoutsCompleted7d ?? 0) / a.workoutsAssigned7d : -1;
          const bv = b.workoutsAssigned7d && b.workoutsAssigned7d > 0 ? (b.workoutsCompleted7d ?? 0) / b.workoutsAssigned7d : -1;
          cmp = av - bv;
          break;
        }
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "coach":
          cmp = (a.coach || "").localeCompare(b.coach || "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "name" || k === "coach" ? "asc" : "asc");
    }
  };

  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  const drawerRow = drawerId != null ? rows.find((r) => r.id === drawerId) ?? null : null;

  const presetCount = (p: Preset) => rows.filter((r) => matchesPreset(r, p)).length;

  return (
    <>
      {/* Presets */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 12px" }}>
        {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
          <button
            key={p}
            className={`h3-btn s ${preset === p ? "p" : ""}`}
            onClick={() => setPreset(p)}
          >
            {PRESET_LABEL[p]} ({presetCount(p)})
          </button>
        ))}
      </div>

      {/* Search + coach filter */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 12px", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <Search
            size={13}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
            style={{
              width: "100%",
              padding: "7px 10px 7px 30px",
              fontSize: 13,
              background: "var(--bg-input, var(--bg-card))",
              color: "var(--text-primary)",
              border: "1px solid var(--border-primary)",
              borderRadius: 6,
              fontFamily: "inherit",
            }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Filter size={12} style={{ color: "var(--text-muted)" }} />
          <select
            value={coachFilter}
            onChange={(e) => setCoachFilter(e.target.value)}
            style={{
              padding: "6px 8px",
              background: "var(--bg-input, var(--bg-card))",
              color: "var(--text-primary)",
              border: "1px solid var(--border-primary)",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "inherit",
            }}
          >
            <option value="__all__">All coaches ({rows.length})</option>
            {coaches.map((c) => (
              <option key={c} value={c}>
                {c} ({rows.filter((r) => (r.coach || "Unassigned") === c).length})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="h3-list" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <Th onClick={() => toggleSort("name")}>Client{arrow("name")}</Th>
              <Th onClick={() => toggleSort("coach")}>Coach{arrow("coach")}</Th>
              <Th onClick={() => toggleSort("days")}>Days left{arrow("days")}</Th>
              <Th onClick={() => toggleSort("workouts")}>Workouts 7d{arrow("workouts")}</Th>
              <Th onClick={() => toggleSort("checkin")}>Check-in{arrow("checkin")}</Th>
              <Th onClick={() => toggleSort("score")}>Retain %{arrow("score")}</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="h3-empty">
                  No clients match.
                </td>
              </tr>
            )}
            {sorted.map((r) => {
              const cls = scoreColor(r.score.bucket);
              const wo =
                r.workoutsAssigned7d != null && r.workoutsAssigned7d > 0
                  ? r.workoutsAssigned7d === 100
                    ? `${r.workoutsCompleted7d ?? 0}%`
                    : `${r.workoutsCompleted7d ?? 0}/${r.workoutsAssigned7d}`
                  : "—";
              return (
                <tr
                  key={r.id}
                  onClick={() => setDrawerId(r.id)}
                  style={{ cursor: "pointer", borderTop: "1px solid var(--border-primary)" }}
                >
                  <Td>
                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{r.name}</span>
                    {r.status === "completed" && (
                      <span
                        style={{
                          marginLeft: 6,
                          padding: "1px 6px",
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: 0.04,
                          textTransform: "uppercase",
                          background: "rgba(148,163,184,0.15)",
                          color: "var(--text-muted)",
                        }}
                      >
                        completed
                      </span>
                    )}
                  </Td>
                  <Td muted>{r.coach || "Unassigned"}</Td>
                  <Td>
                    <span
                      style={{
                        color:
                          r.daysRemaining != null && r.daysRemaining < 0
                            ? "var(--danger)"
                            : r.daysRemaining != null && r.daysRemaining <= 14
                              ? "var(--warning)"
                              : "inherit",
                      }}
                    >
                      {r.daysRemaining == null
                        ? "?"
                        : r.daysRemaining >= 0
                          ? `${r.daysRemaining}d`
                          : `${r.daysRemaining}d`}
                    </span>
                  </Td>
                  <Td>{wo}</Td>
                  <Td>
                    <span
                      style={{
                        color:
                          r.latestCheckInScore == null
                            ? "var(--text-muted)"
                            : r.latestCheckInScore < 60
                              ? "var(--danger)"
                              : r.latestCheckInScore < 75
                                ? "var(--warning)"
                                : "inherit",
                      }}
                    >
                      {r.latestCheckInScore != null ? `${r.latestCheckInScore}` : "—"}
                    </span>
                  </Td>
                  <Td>
                    <span className={`pct ${cls}`} style={{ fontWeight: 700, color: pctColor(cls) }}>
                      {r.score.bucket === "unknown" ? "—" : `${r.score.score}`}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drawerRow && <ClientDrawer row={drawerRow} onClose={() => setDrawerId(null)} />}
    </>
  );
}

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <th
      onClick={onClick}
      style={{
        padding: "10px 14px",
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: 0.05,
        textTransform: "uppercase",
        userSelect: "none",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <td
      style={{
        padding: "10px 14px",
        fontVariantNumeric: "tabular-nums",
        color: muted ? "var(--text-muted)" : "inherit",
      }}
    >
      {children}
    </td>
  );
}

function pctColor(cls: string) {
  if (cls === "g") return "var(--success)";
  if (cls === "a") return "var(--warning)";
  if (cls === "r") return "var(--danger)";
  return "var(--text-muted)";
}

function ClientDrawer({ row, onClose }: { row: Row; onClose: () => void }) {
  // Lazy-load client detail — check-in history + meeting history.
  const [checkIns, setCheckIns] = useState<CheckInSubmission[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [milestone, setMilestone] = useState<MilestoneRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [openCheckin, setOpenCheckin] = useState<CheckInSubmission | null>(null);
  const [videoBusy, setVideoBusy] = useState<"copy" | "done" | null>(null);
  const [videoMsg, setVideoMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // Meeting-form state. Draft is the row being edited or created;
  // `mode` says which. formErr surfaces the API's friendly errors
  // (e.g. duplicate Fathom link 409).
  const [meetingMode, setMeetingMode] = useState<"idle" | "new" | "edit">("idle");
  const [meetingDraft, setMeetingDraft] = useState<Partial<MeetingRow>>({});
  const [meetingSaving, setMeetingSaving] = useState(false);
  const [meetingErr, setMeetingErr] = useState<string | null>(null);

  const reloadDetail = async () => {
    setDetailLoading(true);
    setDetailErr(null);
    try {
      const res = await fetch(`/api/coaching-v3/client-detail?clientId=${row.id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setCheckIns((body.checkIns ?? []) as CheckInSubmission[]);
      setMeetings((body.meetings ?? []) as MeetingRow[]);
      setMilestone((body.milestone ?? null) as MilestoneRow | null);
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setDetailLoading(true);
    setDetailErr(null);
    (async () => {
      try {
        const res = await fetch(`/api/coaching-v3/client-detail?clientId=${row.id}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setCheckIns((body.checkIns ?? []) as CheckInSubmission[]);
        setMeetings((body.meetings ?? []) as MeetingRow[]);
        setMilestone((body.milestone ?? null) as MilestoneRow | null);
      } catch (e) {
        if (!cancelled) setDetailErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  const copyVideoLink = async () => {
    setVideoBusy("copy");
    setVideoMsg(null);
    try {
      const res = await fetch("/api/testimonials/video/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: row.id }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) throw new Error(body.error ?? "Could not get link");
      await navigator.clipboard.writeText(body.url as string);
      setVideoMsg({ tone: "ok", text: "Link copied to clipboard" });
      setTimeout(() => setVideoMsg(null), 2500);
    } catch (e) {
      setVideoMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setVideoBusy(null);
    }
  };

  const markVideoDone = async () => {
    if (!confirm(`Mark video testimonial as completed for ${row.name}?`)) return;
    setVideoBusy("done");
    setVideoMsg(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch("/api/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_milestone",
          payload: {
            id: milestone?.id,
            clientId: row.id,
            clientName: row.name,
            coachName: row.coach || "Unassigned",
            videoTestimonialCompleted: true,
            videoTestimonialCompletionDate: today,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setVideoMsg({ tone: "ok", text: "Marked done." });
      await reloadDetail();
      setTimeout(() => setVideoMsg(null), 2500);
    } catch (e) {
      setVideoMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setVideoBusy(null);
    }
  };

  const openNewMeetingForm = () => {
    setMeetingMode("new");
    setMeetingErr(null);
    setMeetingDraft({
      meetingDate: new Date().toISOString().slice(0, 10),
      notes: "",
      fathomLink: "",
    });
  };
  const openEditMeetingForm = (m: MeetingRow) => {
    setMeetingMode("edit");
    setMeetingErr(null);
    setMeetingDraft({ ...m, fathomLink: m.fathomLink ?? "" });
  };
  const cancelMeetingForm = () => {
    setMeetingMode("idle");
    setMeetingDraft({});
    setMeetingErr(null);
  };

  const saveMeeting = async () => {
    setMeetingErr(null);
    const date = (meetingDraft.meetingDate ?? "").toString().trim();
    const notes = (meetingDraft.notes ?? "").toString().trim();
    if (!date) {
      setMeetingErr("Meeting date is required.");
      return;
    }
    if (!notes) {
      setMeetingErr("Notes are required.");
      return;
    }
    setMeetingSaving(true);
    try {
      const rawFathom = (meetingDraft.fathomLink ?? "").toString().trim();
      const res = await fetch("/api/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_meeting",
          payload: {
            id: meetingMode === "edit" ? meetingDraft.id : undefined,
            clientId: row.id,
            clientName: row.name,
            // MAS 2026-09-16: coach is the client's assigned coach.
            coachName: row.coach || "Unassigned",
            meetingDate: date,
            durationMinutes: 0,
            notes,
            fathomLink: rawFathom.length > 0 ? rawFathom : null,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      cancelMeetingForm();
      await reloadDetail();
    } catch (e) {
      setMeetingErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMeetingSaving(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          zIndex: 200,
        }}
      />
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(520px, 95vw)",
          background: "var(--bg-primary, #0b0b0b)",
          borderLeft: "1px solid var(--border-primary)",
          zIndex: 201,
          overflowY: "auto",
          padding: 18,
          fontSize: 13,
          color: "var(--text-secondary)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>{row.name}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>
              {row.coach || "Unassigned"} · {row.program || "—"}
            </div>
          </div>
          <button className="h3-btn s" onClick={onClose}>
            <X size={12} /> Close
          </button>
        </div>

        <div className="h3-kpis" style={{ marginTop: 14, gridTemplateColumns: "1fr 1fr" }}>
          <div className="h3-kpi">
            <div className="l">Retain chance</div>
            <div className={`v ${scoreColor(row.score.bucket)}`}>
              {row.score.bucket === "unknown" ? "—" : `${row.score.score}%`}
            </div>
            <div className="d">
              {row.score.bucket === "likely"
                ? "likely to retain"
                : row.score.bucket === "coin_flip"
                  ? "coin flip"
                  : row.score.bucket === "at_risk"
                    ? "at risk"
                    : "not enough data"}
            </div>
          </div>
          <div className="h3-kpi">
            <div className="l">Program</div>
            <div className="v">
              {row.daysRemaining == null
                ? "?"
                : row.daysRemaining >= 0
                  ? `${row.daysRemaining}d`
                  : `${row.daysRemaining}d`}
            </div>
            <div className="d">ends {row.endDate ?? "—"}</div>
          </div>
        </div>

        <section className="h3-sec">
          <h2>Why this score</h2>
          <div className="h3-list" style={{ padding: "10px 14px" }}>
            {row.score.reasons.map((rz, i) => (
              <div key={i} style={{ padding: "3px 0" }}>
                · {rz}
              </div>
            ))}
          </div>
        </section>

        <section className="h3-sec">
          <h2>Latest week</h2>
          <div className="h3-list" style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Workouts (last 7d)</div>
              <div>
                {row.workoutsAssigned7d != null && row.workoutsAssigned7d > 0
                  ? row.workoutsAssigned7d === 100
                    ? `${row.workoutsCompleted7d ?? 0}%`
                    : `${row.workoutsCompleted7d ?? 0}/${row.workoutsAssigned7d}`
                  : "—"}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Zero-workout streak</div>
              <div
                style={{
                  color: row.isGhosting ? "var(--danger)" : row.zeroWorkoutStreakWeeks > 0 ? "var(--warning)" : "inherit",
                  fontWeight: row.isGhosting ? 700 : 400,
                }}
              >
                {row.zeroWorkoutStreakWeeks === 0
                  ? "0 weeks"
                  : `${row.zeroWorkoutStreakWeeks} week${row.zeroWorkoutStreakWeeks === 1 ? "" : "s"}`}
                {row.isGhosting && <span style={{ marginLeft: 6 }}>· ghosting</span>}
              </div>
            </div>
          </div>
        </section>

        <section className="h3-sec">
          <h2>Check-in</h2>
          <div className="h3-list" style={{ padding: "10px 14px" }}>
            {row.latestCheckInScore == null ? (
              <div style={{ color: "var(--text-muted)" }}>No check-in on file.</div>
            ) : (
              <div>
                <div>
                  Latest score{" "}
                  <b
                    style={{
                      color:
                        row.latestCheckInScore < 60
                          ? "var(--danger)"
                          : row.latestCheckInScore < 75
                            ? "var(--warning)"
                            : "var(--success)",
                    }}
                  >
                    {row.latestCheckInScore}
                  </b>
                  , {row.latestCheckInDaysAgo}d ago
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Full check-in history — most recent first, click a row for the
            same full-detail modal Today uses. */}
        <section className="h3-sec">
          <h2>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <ClipboardList size={12} /> Check-in history
            </span>
            {!detailLoading && !detailErr && checkIns.length > 0 && (
              <span className="n" style={{ marginLeft: 6 }}>{checkIns.length}</span>
            )}
          </h2>
          <div className="h3-list" style={{ padding: detailLoading || detailErr || checkIns.length === 0 ? "10px 14px" : 0 }}>
            {detailLoading && (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 6 }}>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              </div>
            )}
            {detailErr && (
              <div style={{ color: "var(--danger)" }}>Failed to load: {detailErr}</div>
            )}
            {!detailLoading && !detailErr && checkIns.length === 0 && (
              <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                No check-ins on file.
              </div>
            )}
            {!detailLoading && !detailErr && checkIns.map((ci) => {
              const cls = ci.score < 40 ? "r" : ci.score < 55 ? "a" : ci.score < 75 ? "" : "g";
              const days = Math.max(
                0,
                Math.floor((Date.now() - Date.parse(ci.submittedAt)) / 86_400_000),
              );
              return (
                <div
                  key={ci.id}
                  onClick={() => setOpenCheckin(ci)}
                  className="h3-li"
                  style={{ cursor: "pointer", gridTemplateColumns: "8px 1fr auto" }}
                >
                  <span className={`dot ${cls || "u"}`} />
                  <div className="main">
                    <div className="row1">
                      <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 12.5 }}>
                        {new Date(ci.submittedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      <span className="coach">{days}d ago</span>
                    </div>
                    {ci.text && (
                      <div
                        style={{
                          marginTop: 2,
                          fontStyle: "italic",
                          color: "var(--text-muted)",
                          fontSize: 11.5,
                          maxWidth: 360,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={ci.text}
                      >
                        &ldquo;{ci.text}&rdquo;
                      </div>
                    )}
                  </div>
                  <div className="aside">
                    <div
                      className="pct"
                      style={{
                        fontWeight: 700,
                        color:
                          ci.score < 40
                            ? "var(--danger)"
                            : ci.score < 55
                              ? "var(--warning)"
                              : ci.score < 75
                                ? "var(--text-primary)"
                                : "var(--success)",
                      }}
                    >
                      {ci.score}
                    </div>
                    <div className="lbl">score</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {openCheckin && (
          <CheckinModal submission={openCheckin} onClose={() => setOpenCheckin(null)} />
        )}

        {/* Meetings — appears right after check-in history per MAS spec.
            Log button opens an inline form. Existing meetings are
            editable (to add a Fathom link later) but not deletable. */}
        <section className="h3-sec">
          <h2>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Calendar size={12} /> Meetings
            </span>
            {!detailLoading && !detailErr && meetings.length > 0 && (
              <span className="n" style={{ marginLeft: 6 }}>{meetings.length}</span>
            )}
            {meetingMode === "idle" && !detailLoading && !detailErr && (
              <button
                onClick={openNewMeetingForm}
                className="h3-btn s p"
                style={{ marginLeft: "auto" }}
              >
                <Plus size={11} /> Log meeting
              </button>
            )}
          </h2>

          {meetingMode !== "idle" && (
            <div
              style={{
                padding: 12,
                border: "1px solid var(--border-primary)",
                borderRadius: 8,
                background: "var(--bg-card)",
                marginBottom: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label style={{ fontSize: 11, color: "var(--text-muted)", width: 90 }}>Date</label>
                <input
                  type="date"
                  value={(meetingDraft.meetingDate ?? "").slice(0, 10)}
                  onChange={(e) =>
                    setMeetingDraft((d) => ({ ...d, meetingDate: e.target.value }))
                  }
                  style={inputStyle}
                />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <label style={{ fontSize: 11, color: "var(--text-muted)", width: 90, paddingTop: 6 }}>Notes</label>
                <textarea
                  value={meetingDraft.notes ?? ""}
                  onChange={(e) =>
                    setMeetingDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                  placeholder="What happened, what you agreed on, next step…"
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label style={{ fontSize: 11, color: "var(--text-muted)", width: 90 }}>Fathom link</label>
                <input
                  type="url"
                  value={meetingDraft.fathomLink ?? ""}
                  onChange={(e) =>
                    setMeetingDraft((d) => ({ ...d, fathomLink: e.target.value }))
                  }
                  placeholder="Optional — earns +10 in the weekly score"
                  style={inputStyle}
                />
              </div>
              {meetingErr && (
                <div style={{ color: "var(--danger)", fontSize: 12 }}>{meetingErr}</div>
              )}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button className="h3-btn s" onClick={cancelMeetingForm} disabled={meetingSaving}>
                  Cancel
                </button>
                <button className="h3-btn s p" onClick={saveMeeting} disabled={meetingSaving}>
                  {meetingSaving ? (
                    <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                  ) : null}
                  {meetingMode === "edit" ? "Save changes" : "Log meeting"}
                </button>
              </div>
            </div>
          )}

          <div
            className="h3-list"
            style={{
              padding: detailLoading || detailErr || meetings.length === 0 ? "10px 14px" : 0,
            }}
          >
            {detailLoading && (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: 6 }}>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              </div>
            )}
            {!detailLoading && !detailErr && meetings.length === 0 && meetingMode === "idle" && (
              <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                No meetings logged yet.
              </div>
            )}
            {!detailLoading &&
              !detailErr &&
              meetings.map((m) => (
                <div
                  key={m.id}
                  className="h3-li"
                  style={{ gridTemplateColumns: "1fr auto" }}
                >
                  <div className="main">
                    <div className="row1" style={{ alignItems: "center" }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 12.5 }}>
                        {new Date(m.meetingDate).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                      <span className="coach">{m.coachName}</span>
                      {m.fathomLink ? (
                        <a
                          href={m.fathomLink}
                          target="_blank"
                          rel="noreferrer"
                          className="bucket g"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Video size={10} /> Fathom
                        </a>
                      ) : (
                        <span className="bucket u" title="No Fathom link on this meeting">
                          No Fathom
                        </span>
                      )}
                    </div>
                    {m.notes && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          color: "var(--text-secondary)",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {m.notes}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => openEditMeetingForm(m)}
                    className="h3-btn s"
                    title="Edit — add a Fathom link, fix a typo. No delete."
                  >
                    <Pencil size={11} />
                  </button>
                </div>
              ))}
          </div>
        </section>

        {/* Video Testimonial — lives right after Meetings per MAS spec.
            Shows status, copy-link button (per-client recording URL),
            and Mark Done. When completed the video ends up in the
            separate Video Testimonials tab. */}
        <section className="h3-sec">
          <h2>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Video size={12} /> Video testimonial
            </span>
            {milestone?.videoTestimonial.completed && (
              <span
                className="bucket g"
                style={{ marginLeft: 6, display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Check size={10} /> completed{milestone.videoTestimonial.completionDate ? ` · ${milestone.videoTestimonial.completionDate}` : ""}
              </span>
            )}
            {!milestone?.videoTestimonial.completed && milestone?.videoTestimonial.promptedDate && (
              <span className="bucket a" style={{ marginLeft: 6 }}>
                asked · {new Date(milestone.videoTestimonial.promptedDate).toLocaleDateString()}
              </span>
            )}
            {!milestone?.videoTestimonial.completed && !milestone?.videoTestimonial.promptedDate && (
              <span className="bucket u" style={{ marginLeft: 6 }}>not asked yet</span>
            )}
          </h2>
          <div
            className="h3-list"
            style={{
              padding: "10px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              A unique recording link opens the CCOS recorder for this client. Their
              submission lands in the Video Testimonials tab, tagged to them.
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <button
                className="h3-btn s p"
                onClick={copyVideoLink}
                disabled={videoBusy !== null}
              >
                {videoBusy === "copy" ? (
                  <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <Link2 size={11} />
                )}
                Copy recording link
              </button>
              {!milestone?.videoTestimonial.completed && (
                <button
                  className="h3-btn s"
                  onClick={markVideoDone}
                  disabled={videoBusy !== null}
                >
                  {videoBusy === "done" ? (
                    <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                  ) : (
                    <Check size={11} />
                  )}
                  Mark done
                </button>
              )}
              {videoMsg && (
                <span
                  style={{
                    fontSize: 11,
                    color: videoMsg.tone === "err" ? "var(--danger)" : "var(--success)",
                  }}
                >
                  {videoMsg.text}
                </span>
              )}
            </div>
          </div>
        </section>

        {row.weeklyReports.length > 0 && (
          <section className="h3-sec">
            <h2>Weekly reports (from Assistant Sheet)</h2>
            <div className="h3-list" style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              {row.weeklyReports.map((w) => (
                <div key={w.weekEndingAt} style={{ borderTop: "1px solid var(--border-primary)", paddingTop: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <b>{w.weekLabel}</b>
                    <span
                      style={{
                        color:
                          w.workoutPct == null
                            ? "var(--text-muted)"
                            : w.workoutPct >= 70
                              ? "var(--success)"
                              : w.workoutPct >= 40
                                ? "var(--warning)"
                                : "var(--danger)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {w.workoutsAssigned != null && w.workoutsAssigned > 0
                        ? `${w.workoutsCompleted ?? 0}/${w.workoutsAssigned}`
                        : w.workoutPct == null
                          ? "—"
                          : `${Math.round(w.workoutPct)}%`}
                    </span>
                  </div>
                  {w.note && (
                    <div style={{ marginTop: 4, fontStyle: "italic", color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                      &ldquo;{w.note}&rdquo;
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {row.todayBuckets.length > 0 && (
          <section className="h3-sec">
            <h2>Today buckets</h2>
            <div className="h3-list" style={{ padding: "10px 14px" }}>
              {row.todayBuckets.map((b) => (
                <div key={b}>· {b}</div>
              ))}
            </div>
          </section>
        )}
      </aside>
    </>
  );
}
