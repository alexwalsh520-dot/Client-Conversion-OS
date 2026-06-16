"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ---- shapes returned by /api/invoicing ----
interface StripeSource {
  label: string;
  cash: number;
  net: number;
  ok: boolean;
  error?: string;
}
interface Lines {
  sales: number;
  coaching: number;
  adSpend: number;
  software: number;
  profitSplit: number;
  total: number;
  cashCollected: number;
  netDeposited: number;
  netProfit: number;
  netProfitPct: number;
  totalPct: number;
}
interface InvoiceResult {
  client: string;
  clientLabel: string;
  window: { from: string; to: string };
  period: { start: string; end: string; label: string; totalDays: number; elapsedDays: number; complete: boolean };
  inputs: { stripe: StripeSource[]; whop: number; adSpend: number; programMonths: number };
  lines: Lines;
  forecast: Lines | null;
  warnings: string[];
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${n.toFixed(1)}%`;

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date()
  );
}

const CLIENT_OPTIONS = [
  { key: "tyson", label: "Tyson Sonnek", live: true },
  { key: "antwan", label: "Antwan Rarcus", live: false },
];

export default function InvoicingClient() {
  const [client, setClient] = useState("tyson");
  const [date, setDate] = useState(todayET());
  const [whopInput, setWhopInput] = useState("");
  const [data, setData] = useState<InvoiceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ client, date });
      if (whopInput.trim()) qs.set("whop", whopInput.trim());
      const res = await fetch(`/api/invoicing?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
      setData(json as InvoiceResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [client, date, whopInput]);

  // Auto-load on client/date change; Whop is applied via the "Apply" button so typing isn't spammy.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, date]);

  return (
    <div style={{ padding: "32px 28px", maxWidth: 1080, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">Invoicing &amp; Payouts</h1>
        <p className="page-subtitle">Private · Matthew only · all figures in America/New_York</p>
      </div>

      {/* ===================== INVOICING ===================== */}
      <Section title="Invoicing">
        {/* Controls */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 18 }}>
          <Field label="Client">
            <select className="form-input" value={client} onChange={(e) => setClient(e.target.value)} style={selStyle}>
              {CLIENT_OPTIONS.map((c) => (
                <option key={c.key} value={c.key} disabled={!c.live}>
                  {c.label}
                  {c.live ? "" : " — coming soon"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="As-of date (picks the period)">
            <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} style={selStyle} />
          </Field>
          <Field label="Whop completed withdrawals ($)">
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="number"
                step="0.01"
                placeholder="e.g. 3212.60"
                className="form-input"
                value={whopInput}
                onChange={(e) => setWhopInput(e.target.value)}
                style={{ ...selStyle, width: 150 }}
              />
              <button className="btn-primary" onClick={() => void load()} style={{ whiteSpace: "nowrap" }}>
                Apply
              </button>
            </div>
          </Field>
        </div>

        {err && <Banner tone="danger">{err}</Banner>}
        {loading && !data && <div style={{ color: "var(--text-muted)", padding: 24 }}>Computing…</div>}

        {data && (
          <>
            {/* Period banner */}
            <div className="glass-static" style={{ padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={{ color: "var(--text-secondary)" }}>
                <strong style={{ color: "var(--text-primary)" }}>{data.clientLabel}</strong> · Period{" "}
                <strong style={{ color: "var(--accent)" }}>{data.period.label}</strong>
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                Day {data.period.elapsedDays} of {data.period.totalDays} ·{" "}
                {data.period.complete ? "✓ period complete" : "in progress"}
              </span>
            </div>

            {/* Headline totals */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
              <TotalCard
                label={data.period.complete ? "Invoice total" : "Invoice to date"}
                value={data.lines.total}
                emphasis
              />
              {data.forecast && (
                <TotalCard
                  label="Forecast — full period"
                  sub="if the rest of the period holds this pace"
                  value={data.forecast.total}
                />
              )}
            </div>

            {/* Line breakdown */}
            <div className="glass-static" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <Th>Line</Th>
                    <Th right>{data.period.complete ? "Amount" : "To date"}</Th>
                    {data.forecast && <Th right>Forecast</Th>}
                  </tr>
                </thead>
                <tbody>
                  <Row n="①" label="Sales team (20% of cash collected)" v={data.lines.sales} f={data.forecast?.sales} hasF={!!data.forecast} />
                  <Row n="②" label="Coaching ($30 × program-months)" v={data.lines.coaching} f={data.forecast?.coaching} hasF={!!data.forecast} note={`${Math.round(data.inputs.programMonths)} mo (WIN)`} />
                  <Row n="③" label="Ad spend (Meta, ET)" v={data.lines.adSpend} f={data.forecast?.adSpend} hasF={!!data.forecast} />
                  <Row n="④" label="Software" v={data.lines.software} f={data.forecast?.software} hasF={!!data.forecast} />
                  <Row n="⑤" label="Profit split (50% of net)" v={data.lines.profitSplit} f={data.forecast?.profitSplit} hasF={!!data.forecast} />
                  <tr style={{ borderTop: "2px solid var(--border, #2a2a2a)" }}>
                    <td style={{ ...td, fontWeight: 700, color: "var(--text-primary)" }}>Total invoice</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, fontSize: 17, color: "var(--accent)" }}>{usd(data.lines.total)}</td>
                    {data.forecast && (
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, fontSize: 17, color: "var(--text-secondary)" }}>{usd(data.forecast.total)}</td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Source breakdown + sanity */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div className="glass-static" style={{ padding: 16, flex: "1 1 320px" }}>
                <div style={subHead}>Cash collected · {usd(data.lines.cashCollected)}</div>
                {data.inputs.stripe.map((s) => (
                  <KV key={s.label} k={s.label} v={s.ok ? usd(s.cash) : `⚠ ${s.error}`} />
                ))}
                <KV k="Whop (withdrawals)" v={usd(data.inputs.whop)} muted={data.inputs.whop === 0} />
                <div style={{ ...subHead, marginTop: 14 }}>Net deposited · {usd(data.lines.netDeposited)}</div>
                {data.inputs.stripe.map((s) => (
                  <KV key={s.label} k={`${s.label} net`} v={s.ok ? usd(s.net) : "—"} />
                ))}
                <KV k="Whop" v={usd(data.inputs.whop)} muted={data.inputs.whop === 0} />
              </div>

              <div className="glass-static" style={{ padding: 16, flex: "1 1 240px" }}>
                <div style={subHead}>Sanity checks</div>
                <SanityRow label="Net profit ÷ gross" value={data.lines.netProfitPct} lo={40} hi={60} />
                <SanityRow label="Total ÷ gross" value={data.lines.totalPct} lo={65} hi={75} />
                <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Net profit {usd(data.lines.netProfit)} → split ÷2. Stripe + ad spend on America/New_York; ad spend re-bucketed Pacific→Eastern.
                </div>
              </div>
            </div>

            {data.warnings.length > 0 && (
              <div style={{ marginTop: 14 }}>
                {data.warnings.map((w, i) => (
                  <Banner key={i} tone="warn">{w}</Banner>
                ))}
              </div>
            )}

            <p style={{ marginTop: 14, fontSize: 12, color: "var(--text-muted)" }}>
              Whop is the one manual input: in Whop go to Balances → Withdrawals, total the <strong>Completed</strong> payouts
              dated inside the period (exclude in-progress), and enter it above.
            </p>
          </>
        )}
      </Section>

      {/* ===================== TEAM PAYOUTS (placeholder) ===================== */}
      <Section title="Team Payouts">
        <div className="glass-static" style={{ padding: 28, textAlign: "center", color: "var(--text-muted)" }}>
          Coming soon — not built yet.
        </div>
      </Section>
    </div>
  );
}

/* ---------- small presentational helpers ---------- */
const selStyle: React.CSSProperties = { minWidth: 180 };
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 14 };
const td: React.CSSProperties = { padding: "11px 16px", color: "var(--text-secondary)" };
const subHead: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section" style={{ marginBottom: 36 }}>
      <h2 className="section-title" style={{ marginBottom: 14 }}>{title}</h2>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
      {children}
    </label>
  );
}
function TotalCard({ label, value, sub, emphasis }: { label: string; value: number; sub?: string; emphasis?: boolean }) {
  return (
    <div className="glass-static metric-card" style={{ flex: "1 1 240px", borderColor: emphasis ? "var(--accent)" : undefined }}>
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
function Row({ n, label, v, f, hasF, note }: { n: string; label: string; v: number; f?: number; hasF: boolean; note?: string }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--border, #1f1f1f)" }}>
      <td style={td}>
        <span style={{ color: "var(--accent)", marginRight: 8 }}>{n}</span>
        {label}
        {note && <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>· {note}</span>}
      </td>
      <td style={{ ...td, textAlign: "right", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{usd(v)}</td>
      {hasF && <td style={{ ...td, textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{f != null ? usd(f) : "—"}</td>}
    </tr>
  );
}
function KV({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{k}</span>
      <span style={{ color: muted ? "var(--text-muted)" : "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );
}
function SanityRow({ label, value, lo, hi }: { label: string; value: number; lo: number; hi: number }) {
  const ok = value >= lo && value <= hi;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ color: ok ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
        {pct(value)} {ok ? "✓" : "⚠"}
      </span>
    </div>
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
