"use client";

// Client-facing business dashboard (public token link, no CCOS login).
//
// The client's ONE central place, on a single scrolling page styled like the
// internal Sales Hub (dark charcoal + gold):
//   * Headline money row — Cash Collected, New MRR, Ad Spend, ROAS.
//   * Sales — Booked / Taken / Wins / Losses / Close Rate / Show Rate tiles
//     (Sales Hub formulas), with the list of everyone who booked and their
//     outcome underneath. Tapping a tile filters the list.
//   * Marketing — impressions, clicks, CTR, CPC, cost per booked call, cost
//     per new client. Hidden if the client runs no ads in the window.
//   * Upcoming Calls — the live GHL calendar, prospect name + time only.
//
// Window presets: Today / This Week / This Month / Custom, all on ET days —
// the same day boundaries every other CCOS surface uses.
//
// Data comes from /api/public/client-dashboard/<token> (token-checked, scoped
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

interface Marketing {
  spend: number;
  impressions: number;
  linkClicks: number;
  ctr: number | null;
  cpc: number | null;
  costPerBooked: number | null;
  costPerAcquisition: number | null;
  roas: number | null;
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
  marketing: Marketing | null;
  sales: {
    booked: number;
    taken: number;
    wins: number;
    losses: number;
    noShows: number;
    pending: number;
    cashCollected: number;
    newMrr: number | null;
    aov: number | null;
    showRate: number | null;
    closeRate: number | null;
  };
  rows: Row[];
  upcomingCalls?: UpcomingCall[];
}

type TileId = "booked" | "taken" | "wins" | "losses" | "closeRate" | "showRate";
type PresetId = "today" | "week" | "month" | "custom";

const REFRESH_MS = 5 * 60_000;
const ET_TZ = "America/New_York";

function fmtMoney(value: number | null, cents = false) {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents ? 2 : 0,
    minimumFractionDigits: cents ? 2 : 0,
  });
}

function fmtInt(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

function fmtPct(value: number | null, decimals = 0) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

function fmtRoas(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}x`;
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

function etTodayIso(): string {
  return ET_DAY_KEY.format(new Date());
}

function shiftIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday..Sunday of the current ET week. */
function etWeekBounds(): { from: string; to: string } {
  const today = etTodayIso();
  // getUTCDay on the date-only string gives the ET weekday since the string
  // itself was rendered in ET. Monday-start week.
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  const from = shiftIso(today, -sinceMonday);
  return { from, to: shiftIso(from, 6) };
}

const SALES_TILE_META: Record<
  TileId,
  { label: string; filter: (row: Row) => boolean; empty: string; showCash?: boolean }
> = {
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
};

export default function ClientDashboardView({ token }: { token: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // null = server default (current full calendar month).
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [preset, setPreset] = useState<PresetId>("month");
  const [tile, setTile] = useState<TileId>("booked");
  // Query currently being fetched — dedupes identical requests without letting
  // a background poll swallow a range-change request.
  const inFlight = useRef<string | null>(null);

  const fetchData = useCallback(
    async (opts?: { silent?: boolean }) => {
      const qs = range ? `?from=${range.from}&to=${range.to}` : "";
      const url = `/api/public/client-dashboard/${token}${qs}`;
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
    return data.rows.filter(SALES_TILE_META[tile].filter);
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
      <main className="pub-cd-page">
        <div className="pub-cd-inner">
          <div className="pub-state">Loading your dashboard…</div>
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="pub-cd-page">
        <div className="pub-cd-inner">
          <div className="pub-state pub-state-error">{error}</div>
        </div>
      </main>
    );
  }

  if (!data) return null;

  const s = data.sales;
  const mk = data.marketing;
  const upcomingCount = data.upcomingCalls?.length ?? 0;
  const from = range?.from ?? data.from;
  const to = range?.to ?? data.to;
  const hasAds = Boolean(mk && (mk.spend > 0 || mk.impressions > 0));

  const applyPreset = (id: PresetId) => {
    setPreset(id);
    if (id === "today") {
      const today = etTodayIso();
      setRange({ from: today, to: today });
    } else if (id === "week") {
      setRange(etWeekBounds());
    } else if (id === "month") {
      setRange(null);
    }
    // "custom" keeps the current range and just reveals the date inputs.
  };

  const setFrom = (value: string) => {
    if (!value) return;
    setRange({ from: value, to: value > to ? value : to });
  };
  const setTo = (value: string) => {
    if (!value) return;
    setRange({ from: value < from ? value : from, to: value });
  };

  const salesTiles: Array<{
    id: TileId;
    value: string;
    sub: string;
    tone?: "good" | "warn" | "bad" | "";
  }> = [
    { id: "booked", value: String(s.booked), sub: `${upcomingCount} upcoming` },
    { id: "taken", value: String(s.taken), sub: "calls held" },
    { id: "wins", value: String(s.wins), sub: "closed won", tone: "good" },
    {
      id: "losses",
      value: String(s.losses),
      sub: "taken, not closed",
      tone: s.losses > 0 ? "bad" : "",
    },
    {
      id: "closeRate",
      value: fmtPct(s.closeRate),
      sub: `${s.wins} of ${s.taken} taken`,
      tone: rateTone(s.closeRate),
    },
    {
      id: "showRate",
      value: fmtPct(s.showRate),
      sub: `${s.noShows} no-shows`,
      tone: rateTone(s.showRate),
    },
  ];

  const showCash = Boolean(SALES_TILE_META[tile].showCash);

  return (
    <main className="pub-cd-page">
      <div className="pub-cd-inner">
        <header className="pub-cd-header">
          <h1>{data.clientLabel}</h1>
          <p className="pub-cd-subtitle">Business Dashboard</p>
        </header>

        <div className="pub-preset-bar">
          {(
            [
              ["today", "Today"],
              ["week", "This Week"],
              ["month", "This Month"],
              ["custom", "Custom"],
            ] as Array<[PresetId, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`pub-preset${preset === id ? " is-active" : ""}`}
              disabled={refreshing}
              onClick={() => applyPreset(id)}
            >
              {label}
            </button>
          ))}
          <span className="pub-preset-range">{fmtRange(data.from, data.to)}</span>
          <button
            type="button"
            className="pub-refresh-btn"
            onClick={() => void fetchData()}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {preset === "custom" ? (
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
          </div>
        ) : null}

        {/* Headline money row. */}
        <div className="pub-hero-grid">
          <div className="pub-hero">
            <p className="pub-stat-label">Cash Collected</p>
            <p className="pub-stat-value tone-good">{fmtMoney(s.cashCollected)}</p>
            <p className="pub-stat-sub">
              from {s.wins} {s.wins === 1 ? "win" : "wins"} · AOV {fmtMoney(s.aov)}
            </p>
          </div>
          <div className="pub-hero">
            <p className="pub-stat-label">New MRR</p>
            <p className="pub-stat-value tone-good">{fmtMoney(s.newMrr)}</p>
            <p className="pub-stat-sub">subscriptions started</p>
          </div>
          <div className="pub-hero">
            <p className="pub-stat-label">Ad Spend</p>
            <p className="pub-stat-value">{mk ? fmtMoney(mk.spend) : "—"}</p>
            <p className="pub-stat-sub">{hasAds ? "Meta, USD" : "no ads in range"}</p>
          </div>
          <div className="pub-hero">
            <p className="pub-stat-label">ROAS</p>
            <p className="pub-stat-value">{mk ? fmtRoas(mk.roas) : "—"}</p>
            <p className="pub-stat-sub">cash ÷ ad spend</p>
          </div>
        </div>

        {/* Sales. */}
        <h2 className="pub-section-title">Sales</h2>
        <div className="pub-stat-grid">
          {salesTiles.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`pub-stat${tile === t.id ? " is-active" : ""}`}
              onClick={() => setTile(t.id)}
            >
              <p className="pub-stat-label">{SALES_TILE_META[t.id].label}</p>
              <p className={`pub-stat-value${t.tone ? ` tone-${t.tone}` : ""}`}>
                {t.value}
              </p>
              <p className="pub-stat-sub">{t.sub}</p>
            </button>
          ))}
        </div>

        <div className="pub-list">
          <p className="pub-list-title">
            {SALES_TILE_META[tile].label} — {fmtRange(data.from, data.to)}
          </p>
          {list.length === 0 ? (
            <div className="pub-state">{SALES_TILE_META[tile].empty}</div>
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

        {/* Marketing. */}
        {hasAds && mk ? (
          <>
            <h2 className="pub-section-title">Marketing</h2>
            <div className="pub-stat-grid pub-stat-grid-static">
              <div className="pub-stat is-static">
                <p className="pub-stat-label">Impressions</p>
                <p className="pub-stat-value">{fmtInt(mk.impressions)}</p>
                <p className="pub-stat-sub">ad views</p>
              </div>
              <div className="pub-stat is-static">
                <p className="pub-stat-label">Link Clicks</p>
                <p className="pub-stat-value">{fmtInt(mk.linkClicks)}</p>
                <p className="pub-stat-sub">CTR {fmtPct(mk.ctr, 1)}</p>
              </div>
              <div className="pub-stat is-static">
                <p className="pub-stat-label">Cost / Click</p>
                <p className="pub-stat-value">{fmtMoney(mk.cpc, true)}</p>
                <p className="pub-stat-sub">spend ÷ clicks</p>
              </div>
              <div className="pub-stat is-static">
                <p className="pub-stat-label">Cost / Booked Call</p>
                <p className="pub-stat-value">{fmtMoney(mk.costPerBooked)}</p>
                <p className="pub-stat-sub">spend ÷ {s.booked} booked</p>
              </div>
              <div className="pub-stat is-static">
                <p className="pub-stat-label">Cost / New Client</p>
                <p className="pub-stat-value">{fmtMoney(mk.costPerAcquisition)}</p>
                <p className="pub-stat-sub">spend ÷ {s.wins} wins</p>
              </div>
              <div className="pub-stat is-static">
                <p className="pub-stat-label">ROAS</p>
                <p className="pub-stat-value">{fmtRoas(mk.roas)}</p>
                <p className="pub-stat-sub">cash ÷ ad spend</p>
              </div>
            </div>
          </>
        ) : null}

        {/* Upcoming calls — the live calendar. */}
        <h2 className="pub-section-title">
          Upcoming Calls
          {upcomingCount > 0 ? (
            <span className="pub-tab-badge">{upcomingCount}</span>
          ) : null}
        </h2>
        <div className="pub-cal">
          <div className="pub-cal-head">
            <p className="pub-cal-title">Next {upcomingCount === 1 ? "call" : "calls"} on the calendar</p>
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
                  <h3>
                    {label}
                    {dayKey === todayKey ? (
                      <span className="pub-cal-today">Today</span>
                    ) : null}
                  </h3>
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

        {error ? <div className="pub-state pub-state-error">{error}</div> : null}
      </div>
    </main>
  );
}
