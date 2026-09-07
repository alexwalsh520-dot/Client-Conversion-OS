"use client";

import { useCallback, useEffect, useState } from "react";

interface BoardRow {
  name: string;
  newLeads: number;
  callsBooked: number;
  callsTaken: number;
  noShows: number;
  wins: number;
  cashCollected: number;
  subsSold: number;
  bookingRate: number | null;
  showRate: number | null;
  subRate: number | null;
}

interface BoardResult {
  rows: BoardRow[];
  totals: BoardRow;
  dateFrom: string;
  dateTo: string;
  clients: string[];
  generatedAt: string;
  range: string;
}

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 Days" },
  { key: "mtd", label: "Month to Date" },
] as const;

const REFRESH_MS = 60_000;
const MEDALS = ["🥇", "🥈", "🥉"];

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function pct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

export default function SetterBoardView({ token }: { token: string }) {
  const [range, setRange] = useState<string>("mtd");
  const [data, setData] = useState<BoardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (background = false) => {
      if (!background) setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/public/setter-board/${token}?range=${range}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load the leaderboard");
        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the leaderboard");
      } finally {
        setLoading(false);
      }
    },
    [token, range],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(true), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <main className="pub-board-page">
      <header className="pb-head">
        <div>
          <h1>Setter Leaderboard</h1>
          <p className="pb-sub">
            {data ? `${data.dateFrom} → ${data.dateTo}` : "…"}
            {data?.clients?.length ? ` · ${data.clients.join(" + ")}` : ""} · updates every minute
          </p>
        </div>
        <div className="pb-tabs">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={`pb-tab ${range === r.key ? "on" : ""}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="pb-note">Loading…</div>
      ) : error ? (
        <div className="pb-note pb-error">{error}</div>
      ) : !data ? null : (
        <>
          <section className="pb-boards">
            <Leaderboard
              title="Cash Collected"
              rows={data.rows}
              value={(r) => r.cashCollected}
              format={(r) => usd(r.cashCollected)}
            />
            <Leaderboard
              title="Booking Rate"
              subtitle="booked ÷ new leads"
              rows={data.rows.filter((r) => r.newLeads > 0)}
              value={(r) => r.bookingRate ?? -1}
              format={(r) => `${pct(r.bookingRate)} (${r.callsBooked}/${r.newLeads})`}
            />
            <Leaderboard
              title="Show Rate"
              subtitle="taken ÷ (taken + no-shows)"
              rows={data.rows.filter((r) => r.callsTaken + r.noShows > 0)}
              value={(r) => r.showRate ?? -1}
              format={(r) => `${pct(r.showRate)} (${r.callsTaken}/${r.callsTaken + r.noShows})`}
            />
            <Leaderboard
              title="Subscription Rate"
              subtitle="subs sold ÷ new leads"
              rows={data.rows.filter((r) => r.newLeads > 0 || r.subsSold > 0)}
              value={(r) => r.subRate ?? -1}
              format={(r) => `${pct(r.subRate)} (${r.subsSold}/${r.newLeads})`}
            />
          </section>

          <section className="pb-tablewrap">
            <table className="pb-table">
              <thead>
                <tr>
                  <th>Setter</th>
                  <th>New Leads</th>
                  <th>Booked</th>
                  <th>Booking %</th>
                  <th>Taken</th>
                  <th>No-Shows</th>
                  <th>Show %</th>
                  <th>Wins</th>
                  <th>Cash</th>
                  <th>Subs</th>
                  <th>Sub %</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.name}>
                    <td className="pb-name">{r.name}</td>
                    <td>{r.newLeads}</td>
                    <td>{r.callsBooked}</td>
                    <td>{pct(r.bookingRate)}</td>
                    <td>{r.callsTaken}</td>
                    <td>{r.noShows}</td>
                    <td>{pct(r.showRate)}</td>
                    <td>{r.wins}</td>
                    <td className="pb-cash">{usd(r.cashCollected)}</td>
                    <td>{r.subsSold}</td>
                    <td>{pct(r.subRate)}</td>
                  </tr>
                ))}
                <tr className="pb-total">
                  <td className="pb-name">Team</td>
                  <td>{data.totals.newLeads}</td>
                  <td>{data.totals.callsBooked}</td>
                  <td>{pct(data.totals.bookingRate)}</td>
                  <td>{data.totals.callsTaken}</td>
                  <td>{data.totals.noShows}</td>
                  <td>{pct(data.totals.showRate)}</td>
                  <td>{data.totals.wins}</td>
                  <td className="pb-cash">{usd(data.totals.cashCollected)}</td>
                  <td>{data.totals.subsSold}</td>
                  <td>{pct(data.totals.subRate)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}

function Leaderboard({
  title,
  subtitle,
  rows,
  value,
  format,
}: {
  title: string;
  subtitle?: string;
  rows: BoardRow[];
  value: (r: BoardRow) => number;
  format: (r: BoardRow) => string;
}) {
  const ranked = [...rows].sort((a, b) => value(b) - value(a));
  return (
    <div className="pb-card">
      <div className="pb-card-title">
        {title}
        {subtitle ? <span className="pb-card-sub">{subtitle}</span> : null}
      </div>
      {ranked.length === 0 ? (
        <div className="pb-empty">No data yet</div>
      ) : (
        <ol className="pb-ranks">
          {ranked.map((r, i) => (
            <li key={r.name} className={i === 0 ? "first" : ""}>
              <span className="pb-medal">{MEDALS[i] || `${i + 1}.`}</span>
              <span className="pb-rname">{r.name}</span>
              <span className="pb-rval">{format(r)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
