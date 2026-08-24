"use client";

// Client-facing call-metrics dashboard (public token link, no CCOS login).
//
// Two tabs, styled to match the internal Sales Hub (dark charcoal + gold):
//   * Metrics — Cash Collected, AOV, Close Rate, Show Rate, Calls Booked,
//     Calls Taken, Wins, Losses (Sales Hub formulas), with the list of
//     everyone who booked and their outcome underneath. Tapping a tile
//     filters the list to the people behind that number.
//   * Call Calendar — the live GHL calendar of upcoming booked calls,
//     prospect name + time only. The "upcoming" count shown on the metrics
//     tab is THIS list's length, so the two tabs always agree.
//
// Data comes from /api/public/client-metrics/<token> (token-checked, scoped
// server-side to ONE client). Re-pulls every 5 minutes, on tab focus, and on
// demand.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Stage = "upcoming" | "taken" | "closed" | "no";

interface Row {
  date: string;
  name: string;
  setter: string;
  closer: string;
  stage: Stage;
  statusLabel: string;
  taken: boolean;
  cashCollected: number | null;
}

interface UpcomingCall {
  id: string;
  name: string;
  startTime: string; // ISO instant
}

interface Payload {
  from: string;
  to: string;
  earliestDate: string;
  latestDate: string;
  defaultFrom: string;
  defaultTo: string;
  clientLabel: string;
  generatedAt: string;
  metrics: {
    booked: number;
    taken: number;
    wins: number;
    losses: number;
    noShows: number;
    pending: number;
    cashCollected: number;
    aov: number | null;
    showRate: number | null;
    closeRate: number | null;
  };
  rows: Row[];
  upcomingCalls?: UpcomingCall[];
}

type TileId =
  | "cash"
  | "aov"
  | "closeRate"
  | "showRate"
  | "booked"
  | "taken"
  | "wins"
  | "losses";
type ViewId = "metrics" | "calendar";

const REFRESH_MS = 5 * 60_000;

function fmtMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

// Same thresholds the Sales Hub uses to color close/show rates.
function rateTone(value: number | null): "good" | "warn" | "bad" | "" {
  if (value === null || !Number.isFinite(value)) return "";
  return value >= 0.7 ? "good" : value >= 0.5 ? "warn" : "bad";
}

function fmtDay(dateStr: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

const ET_TZ = "America/New_York";

// YYYY-MM-DD in ET for an absolute instant — the calendar's day-bucket key.
const ET_DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const ET_DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TZ,
  weekday: "long",
  month: "long",
  day: "numeric",
});

const ET_TIME_LABEL = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TZ,
  hour: "numeric",
  minute: "2-digit",
});

function fmtRange(from: string, to: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${fmt.format(new Date(`${from}T00:00:00Z`))} – ${fmt.format(new Date(`${to}T00:00:00Z`))}`;
}

const TILE_META: Record<
  TileId,
  { label: string; filter: (row: Row) => boolean; empty: string; showCash?: boolean }
> = {
  cash: {
    label: "Cash Collected",
    filter: (row) => row.stage === "closed",
    empty: "No closed calls in this range.",
    showCash: true,
  },
  aov: {
    label: "AOV",
    filter: (row) => row.stage === "closed",
    empty: "No closed calls in this range.",
    showCash: true,
  },
  closeRate: {
    label: "Close Rate",
    filter: (row) => row.stage === "closed",
    empty: "No closed calls in this range.",
  },
  showRate: {
    label: "Show Rate",
    filter: (row) => row.taken,
    empty: "No calls taken in this range.",
  },
  booked: {
    label: "Calls Booked",
    filter: () => true,
    empty: "No calls booked in this range.",
  },
  taken: {
    label: "Calls Taken",
    filter: (row) => row.taken,
    empty: "No calls taken in this range.",
  },
  wins: {
    label: "Wins",
    filter: (row) => row.stage === "closed",
    empty: "No wins in this range.",
    showCash: true,
  },
  losses: {
    label: "Losses",
    filter: (row) => row.taken && row.stage !== "closed",
    empty: "No losses in this range.",
  },
};

export default function ClientMetricsView({ token }: { token: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // null = server default (current full calendar month).
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [tile, setTile] = useState<TileId>("booked");
  const [view, setView] = useState<ViewId>("metrics");
  // Query currently being fetched — dedupes identical requests without letting
  // a background poll swallow a range-change request.
  const inFlight = useRef<string | null>(null);

  const fetchData = useCallback(
    async (opts?: { silent?: boolean }) => {
      const qs = range ? `?from=${range.from}&to=${range.to}` : "";
      const url = `/api/public/client-metrics/${token}${qs}`;
      if (inFlight.current === url) return;
      inFlight.current = url;
      if (!opts?.silent) setRefreshing(true);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (inFlight.current !== url) return; // superseded by a newer request
        if (!res.ok) throw new Error(body?.error || "Could not load data.");
        setData(body as Payload);
        setError("");
      } catch (err) {
        if (inFlight.current !== url) return;
        setError(err instanceof Error ? err.message : "Could not load data.");
      } finally {
        if (inFlight.current === url) {
          inFlight.current = null;
          setRefreshing(false);
          setLoading(false);
        }
      }
    },
    [token, range],
  );

  // Initial load + reload when the range changes.
  useEffect(() => {
    setLoading(true);
    void fetchData();
  }, [fetchData]);

  // Background refresh — the tracker is the source of truth and it moves all day.
  useEffect(() => {
    const id = window.setInterval(() => void fetchData({ silent: true }), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [fetchData]);

  // Re-pull the moment the tab comes back into focus.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchData({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchData]);

  const list = useMemo(() => {
    if (!data) return [];
    return data.rows.filter(TILE_META[tile].filter);
  }, [data, tile]);

  // Upcoming calls bucketed by ET calendar day; API returns them time-sorted,
  // so insertion order keeps both days and calls-within-a-day ascending.
  const calendarDays = useMemo(() => {
    const groups = new Map<string, UpcomingCall[]>();
    for (const call of data?.upcomingCalls ?? []) {
      const key = ET_DAY_KEY.format(new Date(call.startTime));
      const bucket = groups.get(key);
      if (bucket) bucket.push(call);
      else groups.set(key, [call]);
    }
    return [...groups.entries()];
  }, [data]);

  if (loading && !data) {
    return (
      <main className="pub-cm-page">
        <div className="pub-cm-inner">
          <div className="pub-state">Loading call metrics…</div>
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="pub-cm-page">
        <div className="pub-cm-inner">
          <div className="pub-state pub-state-error">{error}</div>
        </div>
      </main>
    );
  }

  if (!data) return null;

  const m = data.metrics;
  // ONE upcoming number everywhere: the live calendar's count.
  const upcomingCount = data.upcomingCalls?.length ?? 0;
  const from = range?.from ?? data.from;
  const to = range?.to ?? data.to;
  const isDefaultRange = data.from === data.defaultFrom && data.to === data.defaultTo && !range;
  const showCash = Boolean(TILE_META[tile].showCash);

  const setFrom = (value: string) => {
    if (!value) return;
    setRange({ from: value, to: value > to ? value : to });
  };
  const setTo = (value: string) => {
    if (!value) return;
    setRange({ from: value < from ? value : from, to: value });
  };

  const tiles: Array<{
    id: TileId;
    value: string;
    sub: string;
    tone?: "good" | "warn" | "bad" | "";
  }> = [
    {
      id: "cash",
      value: fmtMoney(m.cashCollected),
      sub: `from ${m.wins} ${m.wins === 1 ? "win" : "wins"}`,
      tone: "good",
    },
    {
      id: "aov",
      value: fmtMoney(m.aov),
      sub: "per win",
    },
    {
      id: "closeRate",
      value: fmtPct(m.closeRate),
      sub: `${m.wins} of ${m.taken} taken`,
      tone: rateTone(m.closeRate),
    },
    {
      id: "showRate",
      value: fmtPct(m.showRate),
      sub: `${m.noShows} no-shows`,
      tone: rateTone(m.showRate),
    },
    {
      id: "booked",
      value: String(m.booked),
      sub: `${upcomingCount} upcoming`,
    },
    {
      id: "taken",
      value: String(m.taken),
      sub: "calls held",
    },
    {
      id: "wins",
      value: String(m.wins),
      sub: "closed won",
      tone: "good",
    },
    {
      id: "losses",
      value: String(m.losses),
      sub: "taken, not closed",
      tone: m.losses > 0 ? "bad" : "",
    },
  ];

  return (
    <main className="pub-cm-page">
      <div className="pub-cm-inner">
        <header className="pub-cm-header">
          <h1>{data.clientLabel} — Sales Call Metrics</h1>
        </header>

        <nav className="pub-tabs">
          <button
            type="button"
            className={`pub-tab${view === "metrics" ? " is-active" : ""}`}
            onClick={() => setView("metrics")}
          >
            Metrics
          </button>
          <button
            type="button"
            className={`pub-tab${view === "calendar" ? " is-active" : ""}`}
            onClick={() => setView("calendar")}
          >
            Call Calendar
            {upcomingCount > 0 ? (
              <span className="pub-tab-badge">{upcomingCount}</span>
            ) : null}
          </button>
        </nav>

        {view === "calendar" ? (
          <div className="pub-cal">
            <div className="pub-cal-head">
              <p className="pub-cal-title">Upcoming Calls</p>
              <span className="pub-cal-note">All times Eastern</span>
            </div>
            {calendarDays.length === 0 ? (
              <div className="pub-state">No upcoming calls on the calendar.</div>
            ) : (
              calendarDays.map(([dayKey, calls]) => {
                const todayKey = ET_DAY_KEY.format(new Date());
                const label = ET_DAY_LABEL.format(new Date(calls[0].startTime));
                return (
                  <section className="pub-cal-day" key={dayKey}>
                    <h2>
                      {label}
                      {dayKey === todayKey ? (
                        <span className="pub-cal-today">Today</span>
                      ) : null}
                    </h2>
                    <ul>
                      {calls.map((call) => (
                        <li key={call.id}>
                          <span className="pub-cal-time">
                            {ET_TIME_LABEL.format(new Date(call.startTime))}
                          </span>
                          <span className="pub-cal-name">{call.name}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </div>
        ) : (
        <>
        <div className="pub-range-bar">
          <label className="pub-range-field">
            <span>From</span>
            <input
              type="date"
              value={from}
              min={data.earliestDate}
              max={data.latestDate}
              disabled={refreshing}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="pub-range-field">
            <span>To</span>
            <input
              type="date"
              value={to}
              min={data.earliestDate}
              max={data.latestDate}
              disabled={refreshing}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {!isDefaultRange ? (
            <button
              type="button"
              className="pub-refresh-btn"
              onClick={() => setRange(null)}
              disabled={refreshing}
            >
              This month
            </button>
          ) : null}
          <button
            type="button"
            className="pub-refresh-btn"
            onClick={() => void fetchData()}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="pub-stat-grid">
          {tiles.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`pub-stat${tile === t.id ? " is-active" : ""}`}
              onClick={() => setTile(t.id)}
            >
              <p className="pub-stat-label">{TILE_META[t.id].label}</p>
              <p className={`pub-stat-value${t.tone ? ` tone-${t.tone}` : ""}`}>
                {t.value}
              </p>
              <p className="pub-stat-sub">{t.sub}</p>
            </button>
          ))}
        </div>

        <div className="pub-list">
          <p className="pub-list-title">
            {TILE_META[tile].label} — {fmtRange(data.from, data.to)}
          </p>
          {list.length === 0 ? (
            <div className="pub-state">{TILE_META[tile].empty}</div>
          ) : (
            <div className="pub-list-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Status</th>
                    {showCash ? <th>Cash</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {list.map((row, i) => (
                    <tr key={`${row.date}-${row.name}-${i}`}>
                      <td>{fmtDay(row.date)}</td>
                      <td className="pub-cell-name">{row.name}</td>
                      <td>
                        <span className={`pub-chip pub-chip-${row.stage}`}>
                          {row.statusLabel}
                        </span>
                      </td>
                      {showCash ? <td>{fmtMoney(row.cashCollected)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
        )}

        {error ? <div className="pub-state pub-state-error">{error}</div> : null}
      </div>
    </main>
  );
}
