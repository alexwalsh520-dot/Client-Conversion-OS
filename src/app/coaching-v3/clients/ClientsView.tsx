"use client";

import { useMemo, useState } from "react";
import type { RetentionScore } from "@/lib/coaching-v3/types";
import { Search, X, Filter } from "lucide-react";

export type Row = {
  id: number;
  name: string;
  coach: string;
  program: string;
  endDate: string | null;
  daysRemaining: number | null;
  startDate: string | null;
  score: RetentionScore;
  workoutsCompleted7d: number | null;
  workoutsAssigned7d: number | null;
  lastClientMessageAt: string | null;
  lastCoachMessageDaysAgo: number | null;
  latestCheckInScore: number | null;
  latestCheckInDaysAgo: number | null;
  retentionCycleOpen: boolean;
  nutritionStatus: string;
  everfitReplies7d: number | null;
  everfitActivity7d: number | null;
  everfitStale: boolean;
  everfitSummary: string | null;
  todayBuckets: string[];
  weeklyReports: {
    weekLabel: string;
    weekEndingAt: string;
    workoutPct: number | null;
    note: string | null;
  }[];
};

type Preset = "all" | "retention" | "reply_owed" | "ghost" | "nutrition" | "recent";

const PRESET_LABEL: Record<Preset, string> = {
  all: "All active",
  retention: "Retention window",
  reply_owed: "Owed a reply ≥ 2d",
  ghost: "Ghost",
  nutrition: "Nutrition pending",
  recent: "Onboarded ≤ 7d",
};

type SortKey = "score" | "days" | "checkin" | "workouts" | "name" | "coach";
type SortDir = "asc" | "desc";

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

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

function replyOwed(r: Row): number | null {
  if (!r.lastClientMessageAt) return null;
  const clientDays = daysAgo(r.lastClientMessageAt);
  if (clientDays === null) return null;
  // Coach msg age >= client msg age means the coach hasn't replied since.
  const coachDays = r.lastCoachMessageDaysAgo;
  if (coachDays !== null && coachDays < clientDays) return null; // coach replied more recently
  return clientDays;
}

function matchesPreset(r: Row, p: Preset): boolean {
  switch (p) {
    case "all":
      return true;
    case "retention":
      return r.retentionCycleOpen;
    case "reply_owed": {
      const d = replyOwed(r);
      return d !== null && d >= 2;
    }
    case "ghost":
      return (
        (r.everfitReplies7d ?? 0) === 0 &&
        (r.everfitActivity7d ?? 0) === 0 &&
        r.lastClientMessageAt !== null
      );
    case "nutrition":
      return r.nutritionStatus === "pending" || r.nutritionStatus === "assigned";
    case "recent": {
      const d = daysToStart(r.startDate);
      return d !== null && d >= 0 && d <= 7;
    }
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
    return rows.filter((r) => {
      if (!matchesPreset(r, preset)) return false;
      if (coachFilter !== "__all__" && (r.coach || "Unassigned") !== coachFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
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
              <Th>Reply owed</Th>
              <Th onClick={() => toggleSort("score")}>Retain %{arrow("score")}</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="h3-empty">
                  No clients match.
                </td>
              </tr>
            )}
            {sorted.map((r) => {
              const cls = scoreColor(r.score.bucket);
              const owed = replyOwed(r);
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
                    {owed != null && owed >= 2 ? (
                      <span style={{ color: "var(--danger)", fontWeight: 600 }}>{owed}d</span>
                    ) : owed != null ? (
                      <span style={{ color: "var(--warning)" }}>{owed}d</span>
                    ) : (
                      "—"
                    )}
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
          <h2>Everfit V3 sync {row.everfitStale ? "· stale" : ""}</h2>
          <div className="h3-list" style={{ padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Workouts 7d</div>
              <div>
                {row.workoutsAssigned7d != null && row.workoutsAssigned7d > 0
                  ? row.workoutsAssigned7d === 100
                    ? `${row.workoutsCompleted7d ?? 0}%`
                    : `${row.workoutsCompleted7d ?? 0}/${row.workoutsAssigned7d}`
                  : "—"}
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Client replies 7d</div>
              <div>{row.everfitReplies7d ?? "—"}</div>
            </div>
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Activity 7d</div>
              <div>{row.everfitActivity7d ?? "—"}</div>
            </div>
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Last client msg</div>
              <div>
                {row.lastClientMessageAt
                  ? `${daysAgo(row.lastClientMessageAt)}d ago`
                  : "—"}
              </div>
            </div>
          </div>
          {row.everfitSummary && (
            <div style={{ marginTop: 8, fontStyle: "italic", color: "var(--text-secondary)" }}>
              &ldquo;{row.everfitSummary}&rdquo;
            </div>
          )}
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
                      {w.workoutPct == null ? "—" : `${Math.round(w.workoutPct)}%`}
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
