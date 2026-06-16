"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { nextPayDateAfter, payDateOnOrBefore, recentPayDates } from "@/lib/payouts/compute";

// ---- shapes returned by /api/payouts (mirror of PayoutRun) ----
interface PayoutLine {
  payee: string;
  role: "closer" | "manager" | "setter";
  kind: string;
  windowStart: string;
  windowEnd: string;
  ratePct: number | null;
  basis: number;
  confirmed: number;
  forecast: number;
  windowComplete: boolean;
  notStarted: boolean;
}
interface PayeeSummary {
  payee: string;
  role: "closer" | "manager" | "setter";
  confirmed: number;
  forecast: number;
  lines: PayoutLine[];
}
interface PayoutRun {
  payDate: string;
  runType: "first" | "fifteenth";
  asOf: string;
  priorMonthLabel: string;
  windows: { closer: { start: string; end: string } | null; setter: { start: string; end: string } | null };
  byPayee: PayeeSummary[];
  totals: { confirmed: number; forecast: number };
  fullyConfirmed: boolean;
  warnings: string[];
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}, ${y}`;
}

async function fetchRun(endpoint: string, payDate: string, asOf: string): Promise<PayoutRun> {
  const res = await fetch(`${endpoint}?payDate=${payDate}&asOf=${asOf}`, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json as PayoutRun;
}

export default function TeamPayouts({ endpoint = "/api/payouts" }: { endpoint?: string }) {
  const today = useMemo(() => todayET(), []);
  const upcomingDate = useMemo(() => nextPayDateAfter(today), [today]);
  const payDateOptions = useMemo(() => recentPayDates(today, 8, 2), [today]);

  const [upcoming, setUpcoming] = useState<PayoutRun | null>(null);
  const [upErr, setUpErr] = useState<string | null>(null);

  const [selDate, setSelDate] = useState(() => payDateOnOrBefore(today));
  const [detail, setDetail] = useState<PayoutRun | null>(null);
  const [detErr, setDetErr] = useState<string | null>(null);
  const [detLoading, setDetLoading] = useState(false);

  useEffect(() => {
    fetchRun(endpoint, upcomingDate, today).then(setUpcoming).catch((e) => setUpErr(e.message));
  }, [endpoint, upcomingDate, today]);

  const loadDetail = useCallback(() => {
    setDetLoading(true);
    setDetErr(null);
    fetchRun(endpoint, selDate, today)
      .then(setDetail)
      .catch((e) => {
        setDetErr(e.message);
        setDetail(null);
      })
      .finally(() => setDetLoading(false));
  }, [endpoint, selDate, today]);
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  return (
    <div>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: -6, marginBottom: 18, lineHeight: 1.55 }}>
        Closers are paid the <strong>1st &amp; 15th</strong> on the prior month&apos;s matching half (10% of cash collected).
        Setters are paid on the <strong>1st</strong> for the whole prior month (5% Amara/Erin · 3% Gideon/Kelechi/Debbie, plus 20% of New MRR).
        Will adds a $2,000 base each run + a 2.5% override on everyone else&apos;s cash and New MRR. All dates America/New_York.
      </p>

      {/* ===================== UPCOMING ===================== */}
      <h3 style={h3Style}>Upcoming payout</h3>
      {upErr && <Banner tone="danger">{upErr}</Banner>}
      {!upcoming && !upErr && <div style={{ color: "var(--text-muted)", padding: 16 }}>Computing forecast…</div>}
      {upcoming && (
        <>
          <div className="glass-static" style={periodBanner}>
            <span style={{ color: "var(--text-secondary)" }}>
              Pays <strong style={{ color: "var(--accent)" }}>{prettyDate(upcoming.payDate)}</strong> · earns{" "}
              <strong style={{ color: "var(--text-primary)" }}>{upcoming.priorMonthLabel}</strong>{" "}
              {upcoming.runType === "first" ? "(closers 1st–14th · setters full month)" : "(closers 15th–end)"}
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>as of {prettyDate(upcoming.asOf)}</span>
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
            <TotalCard label="Confirmed (locked)" value={upcoming.totals.confirmed} sub="earn windows already closed" />
            <TotalCard label="Projected (not yet earned)" value={upcoming.totals.forecast - upcoming.totals.confirmed} sub="run-rate on days still open" />
            <TotalCard label="Forecast — expected to leave your account" value={upcoming.totals.forecast} emphasis sub="confirmed + projected at current pace" />
          </div>

          <RunTable run={upcoming} showForecast />
          <Warnings run={upcoming} />
        </>
      )}

      {/* ===================== HISTORY / DETAIL ===================== */}
      <h3 style={{ ...h3Style, marginTop: 34 }}>Payout detail &amp; history</h3>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Pay date</span>
          <select className="form-input" value={selDate} onChange={(e) => setSelDate(e.target.value)} style={{ minWidth: 220 }}>
            {payDateOptions.map((d) => (
              <option key={d} value={d}>
                {prettyDate(d)}
                {d === payDateOnOrBefore(today) ? " — most recent" : ""}
                {d === upcomingDate ? " — upcoming" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {detErr && <Banner tone="danger">{detErr}</Banner>}
      {detLoading && !detail && <div style={{ color: "var(--text-muted)", padding: 16 }}>Computing…</div>}
      {detail && (
        <>
          <div className="glass-static" style={periodBanner}>
            <span style={{ color: "var(--text-secondary)" }}>
              Pays <strong style={{ color: "var(--accent)" }}>{prettyDate(detail.payDate)}</strong> · earns{" "}
              <strong style={{ color: "var(--text-primary)" }}>{detail.priorMonthLabel}</strong>
            </span>
            <span style={{ color: detail.fullyConfirmed ? "var(--success)" : "var(--text-muted)", fontSize: 13 }}>
              {detail.fullyConfirmed ? "✓ fully confirmed" : "in progress — forecast"}
            </span>
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
            <TotalCard label={detail.fullyConfirmed ? "Payout total" : "Confirmed so far"} value={detail.totals.confirmed} emphasis={detail.fullyConfirmed} />
            {!detail.fullyConfirmed && <TotalCard label="Forecast — full run" value={detail.totals.forecast} emphasis sub="if this pace holds" />}
          </div>

          <RunDetail run={detail} />
          <Warnings run={detail} />
        </>
      )}
    </div>
  );
}

/* ---------- per-payee summary table (upcoming) ---------- */
function RunTable({ run, showForecast }: { run: PayoutRun; showForecast?: boolean }) {
  return (
    <div className="glass-static" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <Th>Payee</Th>
            <Th>Role</Th>
            <Th right>Confirmed</Th>
            {showForecast && <Th right>Forecast</Th>}
          </tr>
        </thead>
        <tbody>
          {run.byPayee.map((p) => (
            <tr key={p.payee} style={{ borderBottom: "1px solid var(--border, #1f1f1f)" }}>
              <td style={{ ...td, color: "var(--text-primary)", fontWeight: 600 }}>{p.payee}</td>
              <td style={{ ...td, color: "var(--text-muted)", textTransform: "capitalize" }}>{p.role}</td>
              <td style={{ ...td, textAlign: "right", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{usd(p.confirmed)}</td>
              {showForecast && (
                <td style={{ ...td, textAlign: "right", color: p.forecast > p.confirmed ? "var(--accent)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                  {usd(p.forecast)}
                </td>
              )}
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid var(--border, #2a2a2a)" }}>
            <td style={{ ...td, fontWeight: 700, color: "var(--text-primary)" }} colSpan={2}>
              Total
            </td>
            <td style={{ ...td, textAlign: "right", fontWeight: 700, fontSize: 16, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
              {usd(run.totals.confirmed)}
            </td>
            {showForecast && (
              <td style={{ ...td, textAlign: "right", fontWeight: 700, fontSize: 16, color: "var(--accent)", fontVariantNumeric: "tabular-nums" }}>{usd(run.totals.forecast)}</td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ---------- per-payee breakdown with line detail (history) ---------- */
function RunDetail({ run }: { run: PayoutRun }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
      {run.byPayee.map((p) => (
        <div key={p.payee} className="glass-static" style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {p.payee} <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 12, textTransform: "capitalize" }}>· {p.role}</span>
            </span>
            <span style={{ color: run.fullyConfirmed ? "var(--text-primary)" : "var(--accent)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {usd(run.fullyConfirmed ? p.confirmed : p.forecast)}
            </span>
          </div>
          {p.lines.map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13, color: "var(--text-muted)" }}>
              <span>
                {l.kind}
                {l.basis > 0 && <span style={{ marginLeft: 6 }}>· on {usd(l.basis)}</span>}
                {!l.windowComplete && !l.notStarted && <span style={{ color: "var(--accent)", marginLeft: 6 }}>· in progress</span>}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}>
                {usd(l.confirmed)}
                {l.forecast > l.confirmed && <span style={{ color: "var(--accent)" }}> → {usd(l.forecast)}</span>}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Warnings({ run }: { run: PayoutRun }) {
  if (!run.warnings.length) return null;
  return (
    <div style={{ marginTop: 4 }}>
      {run.warnings.map((w, i) => (
        <Banner key={i} tone="warn">
          {w}
        </Banner>
      ))}
    </div>
  );
}

/* ---------- presentational helpers (mirror InvoicingClient) ---------- */
const h3Style: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 };
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 14 };
const td: React.CSSProperties = { padding: "11px 16px", color: "var(--text-secondary)" };
const periodBanner: React.CSSProperties = { padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 };

function TotalCard({ label, value, sub, emphasis }: { label: string; value: number; sub?: string; emphasis?: boolean }) {
  return (
    <div className="glass-static metric-card" style={{ flex: "1 1 220px", borderColor: emphasis ? "var(--accent)" : undefined }}>
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value" style={{ color: emphasis ? "var(--accent)" : "var(--text-primary)" }}>{usd(value)}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{ ...td, textAlign: right ? "right" : "left", fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, borderBottom: "1px solid var(--border, #2a2a2a)" }}>
      {children}
    </th>
  );
}
function Banner({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  const color = tone === "danger" ? "var(--danger)" : "var(--accent)";
  return (
    <div style={{ border: `1px solid ${color}`, background: "rgba(255,255,255,0.02)", color, padding: "9px 13px", borderRadius: 8, fontSize: 13, marginBottom: 8 }}>
      {children}
    </div>
  );
}
