"use client";

// Setter-facing live response-time view (public token link, no CCOS login).
//
// Built for the midday check-in: a setter opens the link on their phone, taps
// their name once (remembered per device), and reads off their shift numbers —
// average, median, single fastest/slowest reply, and the 5-minute miss rate —
// plus the same stats broken down by hour so they can see WHICH hours slipped.
//
// Data comes from /api/public/setters/<token> (token-checked, aggregate-only).
// The view re-pulls every 60s while it's today's shift, re-pulls when the tab
// comes back into focus, and always shows exactly when it was last updated.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface HourlyBucket {
  hour: number;
  count: number;
  avgSeconds: number | null;
  medianSeconds: number | null;
  missedCount: number;
}

interface Group {
  id: string;
  label: string;
  averageSeconds: number | null;
  medianSeconds: number | null;
  sampleCount: number;
  fastestSeconds: number | null;
  slowestSeconds: number | null;
  missedCount: number;
  hourly: HourlyBucket[];
}

interface Payload {
  date: string;
  today: string;
  generatedAt: string;
  missThresholdSeconds: number;
  latestMessageAt: string | null;
  staleMessageFeed: boolean;
  businessHours: string;
  team: Group;
  setters: Group[];
}

const REFRESH_MS = 60_000;
const LOOKBACK_DAYS = 30;
const PICK_STORAGE_KEY = "ccos-setter-view-pick";

function fmtDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${secs}s`;
}

function fmtHour(hour: number) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const period = hour < 12 ? "am" : "pm";
  return `${h12}${period}`;
}

function fmtEtClock(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

function fmtLongDate(dateStr: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

function shiftDate(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function currentEtHour() {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
}

// Color a reply time against the 5-minute target: green = inside the window,
// amber = up to double it, red = worse than double.
function paceClass(seconds: number | null, threshold: number) {
  if (seconds === null) return "pub-muted";
  if (seconds <= threshold) return "pub-good";
  if (seconds <= threshold * 2) return "pub-warn";
  return "pub-bad";
}

function missRateClass(rate: number | null) {
  if (rate === null) return "pub-muted";
  if (rate === 0) return "pub-good";
  if (rate <= 0.2) return "pub-warn";
  return "pub-bad";
}

export default function SetterLiveView({ token }: { token: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [date, setDate] = useState<string | null>(null); // null = today
  const [pick, setPick] = useState<string>("team");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  // Re-render every second so the "updated Xs ago" readout stays honest.
  const [, setTick] = useState(0);
  // Query currently being fetched — dedupes identical requests without letting
  // a background poll swallow a day-change request (a stale poll response that
  // lands after a newer request started is ignored).
  const inFlight = useRef<string | null>(null);

  const fetchData = useCallback(
    async (opts?: { silent?: boolean }) => {
      const url = `/api/public/setters/${token}${date ? `?date=${date}` : ""}`;
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
    [token, date],
  );

  // Initial load + reload when the shift date changes.
  useEffect(() => {
    setLoading(true);
    void fetchData();
  }, [fetchData]);

  // Live polling — only while looking at today's shift.
  useEffect(() => {
    const viewingToday = !date || (data ? date === data.today : true);
    if (!viewingToday) return;
    const id = window.setInterval(() => void fetchData({ silent: true }), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [fetchData, date, data]);

  // Re-pull the moment the tab comes back (phone unlocked at check-in time).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchData({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchData]);

  // Tick the "updated Xs ago" readout.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Remember which name this device picked.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PICK_STORAGE_KEY);
      if (saved) setPick(saved);
    } catch {}
  }, []);

  const choosePick = (id: string) => {
    setPick(id);
    try {
      localStorage.setItem(PICK_STORAGE_KEY, id);
    } catch {}
  };

  const group: Group | null = useMemo(() => {
    if (!data) return null;
    if (pick === "team") return data.team;
    return data.setters.find((s) => s.id === pick) || data.team;
  }, [data, pick]);

  if (loading && !data) {
    return (
      <main className="pub-setters-page">
        <div className="pub-setters-inner">
          <div className="pub-state">Loading response times…</div>
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="pub-setters-page">
        <div className="pub-setters-inner">
          <div className="pub-state pub-state-error">{error}</div>
        </div>
      </main>
    );
  }

  if (!data || !group) return null;

  const viewingToday = data.date === data.today;
  const threshold = data.missThresholdSeconds;
  const thresholdMin = Math.round(threshold / 60);
  const missRate = group.sampleCount ? group.missedCount / group.sampleCount : null;
  const showingTeam = group.id === "team";
  const nowHour = currentEtHour();
  const updatedAgoSec = lastUpdated
    ? Math.max(0, Math.round((Date.now() - new Date(lastUpdated).getTime()) / 1000))
    : null;
  const atEarliest = data.date <= shiftDate(data.today, -LOOKBACK_DAYS);
  // A different day was requested and is still loading — freeze the switcher
  // and say so (past-day pulls can take a while).
  const dayLoading = refreshing && (date ?? data.today) !== data.date;

  return (
    <main className="pub-setters-page">
      <div className="pub-setters-inner">
        <header className="pub-setters-header">
          <h1>Setter Response Times</h1>
          <p className="pub-date">{fmtLongDate(data.today)} · live</p>
          <div className="pub-live-row">
            <span className={`pub-live-dot${data.staleMessageFeed ? " is-stale" : ""}`} />
            {lastUpdated ? (
              <span>
                Updated {fmtEtClock(lastUpdated)}
                {updatedAgoSec !== null ? ` (${updatedAgoSec}s ago)` : ""} · auto-refreshes
                every minute
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

        <div className="pub-day-nav">
          <button
            type="button"
            className="pub-day-arrow"
            aria-label="Previous day"
            disabled={atEarliest || refreshing}
            onClick={() => setDate(shiftDate(data.date, -1))}
          >
            ‹
          </button>
          <span className="pub-day-label">
            {dayLoading ? "Loading…" : fmtLongDate(data.date)}
          </span>
          <button
            type="button"
            className="pub-day-arrow"
            aria-label="Next day"
            disabled={viewingToday || refreshing}
            onClick={() => {
              const next = shiftDate(data.date, 1);
              setDate(next >= data.today ? null : next);
            }}
          >
            ›
          </button>
          {viewingToday ? (
            <span className="pub-today-chip">TODAY</span>
          ) : (
            <button type="button" className="pub-refresh-btn" onClick={() => setDate(null)}>
              Jump to today
            </button>
          )}
        </div>

        <div className="pub-pills">
          <button
            type="button"
            className={`pub-pill${pick === "team" ? " is-active" : ""}`}
            onClick={() => choosePick("team")}
          >
            Team
          </button>
          {data.setters.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`pub-pill${pick === s.id ? " is-active" : ""}`}
              onClick={() => choosePick(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="pub-stat-grid">
          <div className="pub-stat">
            <p className="pub-stat-label">Average</p>
            <p className={`pub-stat-value ${paceClass(group.averageSeconds, threshold)}`}>
              {fmtDuration(group.averageSeconds)}
            </p>
            <p className="pub-stat-sub">target: under {thresholdMin} min</p>
          </div>
          <div className="pub-stat">
            <p className="pub-stat-label">Median</p>
            <p className={`pub-stat-value ${paceClass(group.medianSeconds, threshold)}`}>
              {fmtDuration(group.medianSeconds)}
            </p>
            <p className="pub-stat-sub">typical reply, outliers ignored</p>
          </div>
          <div className="pub-stat">
            <p className="pub-stat-label">Miss rate</p>
            <p className={`pub-stat-value ${missRateClass(missRate)}`}>
              {missRate === null ? "—" : `${Math.round(missRate * 100)}%`}
            </p>
            <p className="pub-stat-sub">
              {group.sampleCount
                ? `${group.missedCount} of ${group.sampleCount} over ${thresholdMin} min`
                : "no replies tracked yet"}
            </p>
          </div>
          <div className="pub-stat">
            <p className="pub-stat-label">Fastest</p>
            <p className={`pub-stat-value ${paceClass(group.fastestSeconds, threshold)}`}>
              {fmtDuration(group.fastestSeconds)}
            </p>
            <p className="pub-stat-sub">best single reply this shift</p>
          </div>
          <div className="pub-stat">
            <p className="pub-stat-label">Slowest</p>
            <p className={`pub-stat-value ${paceClass(group.slowestSeconds, threshold)}`}>
              {fmtDuration(group.slowestSeconds)}
            </p>
            <p className="pub-stat-sub">worst single reply this shift</p>
          </div>
          <div className="pub-stat">
            <p className="pub-stat-label">Replies tracked</p>
            <p className="pub-stat-value">{group.sampleCount}</p>
            <p className="pub-stat-sub">{showingTeam ? "whole team" : group.label} · this shift</p>
          </div>
        </div>

        <div className="pub-hourly">
          <p className="pub-hourly-title">
            Hour by hour — {showingTeam ? "Team" : group.label}
          </p>
          <div className="pub-hourly-scroll">
          <table>
            <thead>
              <tr>
                <th>Hour (ET)</th>
                <th>Replies</th>
                <th>Avg</th>
                <th>Median</th>
                <th>Missed</th>
              </tr>
            </thead>
            <tbody>
              {group.hourly.map((h) => {
                const isNow = viewingToday && h.hour === nowHour;
                const empty = h.count === 0;
                return (
                  <tr
                    key={h.hour}
                    className={`${isNow ? "is-now" : ""}${empty ? " is-empty" : ""}`}
                  >
                    <td>
                      {fmtHour(h.hour)}–{fmtHour(h.hour + 1)}
                      {isNow ? " · now" : ""}
                    </td>
                    <td>{h.count || "—"}</td>
                    <td className={empty ? "" : paceClass(h.avgSeconds, threshold)}>
                      {fmtDuration(h.avgSeconds)}
                    </td>
                    <td className={empty ? "" : paceClass(h.medianSeconds, threshold)}>
                      {fmtDuration(h.medianSeconds)}
                    </td>
                    <td className={h.missedCount > 0 ? "pub-bad" : ""}>
                      {empty ? "—" : h.missedCount}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>

        {error ? <div className="pub-state pub-state-error">{error}</div> : null}

        <p className="pub-rules">
          <strong>How this is measured:</strong> the clock starts when a lead&apos;s
          message comes in and stops at your first reply. Replies slower than{" "}
          <strong>{thresholdMin} minutes</strong> count as missed. Tracking runs during
          business hours ({data.businessHours}) — time outside those hours doesn&apos;t
          count against you. Green means inside the {thresholdMin}-minute window.
        </p>
      </div>
    </main>
  );
}
