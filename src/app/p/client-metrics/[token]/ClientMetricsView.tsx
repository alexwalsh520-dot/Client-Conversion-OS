"use client";

// Client-facing call-metrics dashboard (public token link, no CCOS login).
//
// Four numbers off the sales tracker — calls booked, calls taken, calls
// closed, AOV — plus the upcoming bucket (booked rows whose "Call Taken" cell
// is still blank). Tapping a stat card shows exactly who is behind that
// number. Month navigation matches the tracker's month tabs; the current
// month is a full calendar month so upcoming calls stay visible.
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

interface Payload {
  month: string;
  currentMonth: string;
  earliestMonth: string;
  latestMonth: string;
  clientLabel: string;
  generatedAt: string;
  metrics: {
    booked: number;
    upcoming: number;
    taken: number;
    closed: number;
    cashCollected: number;
    aov: number | null;
  };
  rows: Row[];
}

type TileId = "booked" | "upcoming" | "taken" | "closed" | "aov";

const REFRESH_MS = 5 * 60_000;

function fmtMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtMonth(month: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function fmtDay(dateStr: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function fmtEtClock(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

const TILE_META: Record<
  TileId,
  { label: string; filter: (row: Row) => boolean; empty: string }
> = {
  booked: {
    label: "Calls Booked",
    filter: () => true,
    empty: "No calls booked this month yet.",
  },
  upcoming: {
    label: "Upcoming Calls",
    filter: (row) => row.stage === "upcoming",
    empty: "No upcoming calls on the tracker.",
  },
  taken: {
    label: "Calls Taken",
    filter: (row) => row.taken,
    empty: "No calls taken this month yet.",
  },
  closed: {
    label: "Calls Closed",
    filter: (row) => row.stage === "closed",
    empty: "No closed calls this month yet.",
  },
  aov: {
    label: "AOV",
    filter: (row) => row.stage === "closed",
    empty: "No closed calls this month yet.",
  },
};

export default function ClientMetricsView({ token }: { token: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [month, setMonth] = useState<string | null>(null); // null = current
  const [tile, setTile] = useState<TileId>("booked");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  // Query currently being fetched — dedupes identical requests without letting
  // a background poll swallow a month-change request.
  const inFlight = useRef<string | null>(null);

  const fetchData = useCallback(
    async (opts?: { silent?: boolean }) => {
      const url = `/api/public/client-metrics/${token}${month ? `?month=${month}` : ""}`;
      if (inFlight.current === url) return;
      inFlight.current = url;
      if (!opts?.silent) setRefreshing(true);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (inFlight.current !== url) return; // superseded by a newer request
        if (!res.ok) throw new Error(body?.error || "Could not load data.");
        setData(body as Payload);
        setLastUpdated(new Date().toISOString());
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
    [token, month],
  );

  // Initial load + reload when the month changes.
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
  const viewingCurrent = data.month === data.currentMonth;
  const showRate = m.taken > 0 && m.booked - m.upcoming > 0
    ? m.taken / (m.booked - m.upcoming)
    : null;
  const closeRate = m.taken > 0 ? m.closed / m.taken : null;
  const monthLoading = refreshing && (month ?? data.currentMonth) !== data.month;
  const showCash = tile === "closed" || tile === "aov";

  const tiles: Array<{
    id: TileId;
    value: string;
    sub: string;
  }> = [
    {
      id: "booked",
      value: String(m.booked),
      sub: `${m.upcoming} upcoming`,
    },
    {
      id: "upcoming",
      value: String(m.upcoming),
      sub: "call taken still blank",
    },
    {
      id: "taken",
      value: String(m.taken),
      sub: showRate !== null ? `${Math.round(showRate * 100)}% show rate` : "of calls held so far",
    },
    {
      id: "closed",
      value: String(m.closed),
      sub: closeRate !== null ? `${Math.round(closeRate * 100)}% of calls taken` : "no calls taken yet",
    },
    {
      id: "aov",
      value: fmtMoney(m.aov),
      sub: `${fmtMoney(m.cashCollected)} collected / ${m.closed} closed`,
    },
  ];

  return (
    <main className="pub-cm-page">
      <div className="pub-cm-inner">
        <header className="pub-cm-header">
          <h1>{data.clientLabel} — Sales Call Metrics</h1>
          <div className="pub-live-row">
            <span className="pub-live-dot" />
            {lastUpdated ? (
              <span>
                Updated {fmtEtClock(lastUpdated)} · auto-refreshes every 5 minutes
              </span>
            ) : (
              <span>Updating…</span>
            )}
            <button
              type="button"
              className="pub-refresh-btn"
              onClick={() => void fetchData()}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh now"}
            </button>
          </div>
        </header>

        <div className="pub-month-nav">
          <button
            type="button"
            className="pub-month-arrow"
            aria-label="Previous month"
            disabled={data.month <= data.earliestMonth || refreshing}
            onClick={() => setMonth(shiftMonth(data.month, -1))}
          >
            ‹
          </button>
          <span className="pub-month-label">
            {monthLoading ? "Loading…" : fmtMonth(data.month)}
          </span>
          <button
            type="button"
            className="pub-month-arrow"
            aria-label="Next month"
            disabled={data.month >= data.latestMonth || refreshing}
            onClick={() => {
              const next = shiftMonth(data.month, 1);
              setMonth(next === data.currentMonth ? null : next);
            }}
          >
            ›
          </button>
          {viewingCurrent ? (
            <span className="pub-month-chip">THIS MONTH</span>
          ) : (
            <button type="button" className="pub-refresh-btn" onClick={() => setMonth(null)}>
              Jump to this month
            </button>
          )}
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
              <p className="pub-stat-value">{t.value}</p>
              <p className="pub-stat-sub">{t.sub}</p>
            </button>
          ))}
        </div>

        <div className="pub-list">
          <p className="pub-list-title">
            {TILE_META[tile].label} — {fmtMonth(data.month)}
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
                    <th>Setter</th>
                    <th>Closer</th>
                    <th>Status</th>
                    {showCash ? <th>Cash</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {list.map((row, i) => (
                    <tr key={`${row.date}-${row.name}-${i}`}>
                      <td>{fmtDay(row.date)}</td>
                      <td className="pub-cell-name">{row.name}</td>
                      <td>{row.setter}</td>
                      <td>{row.closer}</td>
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

        {error ? <div className="pub-state pub-state-error">{error}</div> : null}

        <p className="pub-rules">
          <strong>How this is counted:</strong> every call booked lands on the
          sales tracker and counts as <strong>booked</strong>. A call with no
          Call&nbsp;Taken entry yet is <strong>upcoming</strong>; once it&apos;s
          marked Yes it counts as <strong>taken</strong>. A win on the tracker
          counts as <strong>closed</strong>, and AOV is cash collected divided
          by calls closed.
        </p>
      </div>
    </main>
  );
}
