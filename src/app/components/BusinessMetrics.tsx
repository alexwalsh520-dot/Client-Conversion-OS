"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { CLIENTS } from "@/lib/mock-data";
import { fmtDollars } from "@/lib/formatters";

interface BusinessMetricValues {
  gp30: number | null;
  cac: number | null;
  ltgp: number | null;
  capacityPct: number | null;
}

interface AcquisitionSoftwareLine {
  label: string;
  perClientCents: number;
  totalCents: number;
  splitNote: string;
}

interface BusinessMetricBreakdown {
  newClientCount: number;
  aovCents: number;
  cohortRevenueCents: number;

  coachingCostPerNewClientCents: number;
  feeDragPerNewClientCents: number;
  setterCommissionsPerNewClientCents: number;
  closerCommissionsPerNewClientCents: number;
  directCostsPerNewClientCents: number;
  gp30Cents: number;

  fulfillmentPayrollMonthlyCents: number;
  fulfillmentSoftwareMonthlyCents: number;
  totalActiveEndClients: number;

  cacAdSpendCents: number;
  cacMercurySoftwareCents: number;
  cacTotalCents: number;
  cacAdSpendSource: "Meta API" | "Keith Ad Tracker Sheet" | "none";
  cacAcquisitionLines: AcquisitionSoftwareLine[];
  cacManychatPerClientCents: number;

  ltgpSalesTrackerCents: number;
  ltgpWindowStart: string;
  ltgpWindowEnd: string;
  ltgpUniqueCustomers: number;
  ltgpTotalPurchases: number;
  ltgpAvgPurchasesPerCustomer: number;
  ltgpAovCents: number;
  ltgpGrossMarginPct: number;
  ltgpDirectCostPerSaleCents: number;

  monthlyGpPerActiveClientCents: number;
  ltvPerCustomerCents: number;
  ltvMedianCents: number;
  ltvCustomerCount: number;
  avgTenureMonths: number;

  activeClients: number;
}

export interface BusinessMetricsCardData {
  key: "total" | keyof typeof CLIENTS;
  label: string;
  state: "live" | "needs_setup";
  metrics: BusinessMetricValues;
  notes: string[];
  breakdown?: BusinessMetricBreakdown;
}

export interface BusinessMetricsResponse {
  cards: BusinessMetricsCardData[];
  syncedAt: string | null;
  missingSetup: string[];
}

export function BusinessMetricsCard({
  card,
  accent,
  style,
}: {
  card: BusinessMetricsCardData;
  accent: string;
  style?: CSSProperties;
}) {
  const [openMetric, setOpenMetric] = useState<"gp30" | "cac" | "ltgp" | "capacity" | null>(null);
  const noteLines = Array.from(new Set(card.notes)).filter(Boolean);
  const b = card.breakdown;
  const toggle = (m: "gp30" | "cac" | "ltgp" | "capacity") => setOpenMetric((v) => (v === m ? null : m));

  return (
    <div className="glass-static" style={{ padding: 18, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: accent,
              display: "inline-block",
            }}
          />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
              {card.label}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Last 30 days</div>
          </div>
        </div>

        <div
          style={{
            padding: "4px 8px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            background: card.state === "live" ? "rgba(34,197,94,0.14)" : "rgba(245,158,11,0.14)",
            color: card.state === "live" ? "var(--success)" : "var(--warning)",
          }}
        >
          {card.state === "live" ? "Live" : "Needs setup"}
        </div>
      </div>

      <div className="metric-grid metric-grid-4" style={{ marginTop: 16 }}>
        <BusinessMetricStat label="30-Day GP" value={fmtCentsMetric(card.metrics.gp30)} active={openMetric === "gp30"} onClick={() => toggle("gp30")} />
        <BusinessMetricStat label="CAC" value={fmtCentsMetric(card.metrics.cac)} active={openMetric === "cac"} onClick={() => toggle("cac")} />
        <BusinessMetricStat label="LTGP" value={fmtCentsMetric(card.metrics.ltgp)} active={openMetric === "ltgp"} onClick={() => toggle("ltgp")} />
        <BusinessMetricStat label="Capacity" value={fmtCapacityMetric(card.metrics.capacityPct)} active={openMetric === "capacity"} onClick={() => toggle("capacity")} />
      </div>

      {noteLines.length > 0 && (
        <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
          {noteLines.map((note) => (
            <div key={note} style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {note}
            </div>
          ))}
        </div>
      )}

      {openMetric && b && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
            display: "grid",
            gap: 6,
            fontSize: 13,
          }}
        >
          {openMetric === "gp30" && <Gp30Drilldown b={b} />}
          {openMetric === "cac" && <CacDrilldown b={b} />}
          {openMetric === "ltgp" && <LtgpDrilldown b={b} ltgpCents={card.metrics.ltgp} />}
          {openMetric === "capacity" && <CapacityDrilldown b={b} capacityPct={card.metrics.capacityPct} />}
        </div>
      )}
    </div>
  );
}

export function AgencyBusinessMetrics() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BusinessMetricsResponse | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/home/business-metrics");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load business metrics");
      setData(json);
    } catch (err) {
      console.error("Failed to fetch business metrics:", err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const total = data?.cards.find((card) => card.key === "total");

  return (
    <div className="section">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          <TrendingUp size={16} />
          Client Business Metrics
        </h2>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {data?.syncedAt
            ? `Last sync ${new Date(data.syncedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`
            : "Last 30 days · agency-wide"}
        </div>
      </div>

      {loading ? (
        <div className="glass-static metric-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Loader2 size={24} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
          <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 14 }}>Loading business metrics...</span>
        </div>
      ) : total ? (
        <div className="glass-static" style={{ padding: 18 }}>
          <div className="metric-grid metric-grid-3">
            <AgencyStat label="30-Day Gross Profit" value={fmtCentsMetric(total.metrics.gp30)} />
            <AgencyStat label="CAC" value={fmtCentsMetric(total.metrics.cac)} />
            <AgencyStat label="LTV" value={fmtCentsMetric(total.metrics.ltgp)} />
          </div>
        </div>
      ) : (
        <div className="glass-static" style={{ padding: 18, fontSize: 13, color: "var(--text-muted)" }}>
          Business metrics unavailable.
        </div>
      )}
    </div>
  );
}

function AgencyStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)" }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 26, fontWeight: 700, color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

function DrillHeader({ title, formula, source }: { title: string; formula: string; source: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-primary)" }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, fontFamily: "var(--font-mono, ui-monospace), monospace" }}>
        {formula}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
        Source: {source}
      </div>
    </div>
  );
}

function Gp30Drilldown({ b }: { b: BusinessMetricBreakdown }) {
  const coachingCalc = b.totalActiveEndClients > 0
    ? `$${Math.round((b.fulfillmentPayrollMonthlyCents + b.fulfillmentSoftwareMonthlyCents) / 100).toLocaleString()} ÷ ${b.totalActiveEndClients} active = $${Math.round(b.coachingCostPerNewClientCents / 100).toLocaleString()}/client/mo`
    : "—";
  return (
    <>
      <DrillHeader
        title="30-Day GP per new client"
        formula="AOV − coaching − fees − setter comm − closer comm"
        source="Sales tracker (AOV, commissions) · Mercury (coaching cost) · settings (fee %)"
      />
      <BreakdownRow label={`Sales this window (from sales tracker)`} value={`${b.newClientCount} sales totaling ${fmtCentsMetric(b.cohortRevenueCents)}`} />
      <BreakdownRow label="AOV (cash collected ÷ sales)" value={fmtCentsMetric(b.aovCents)} />
      <BreakdownRow label={`− Coaching cost per client / month 1`} value={fmtCentsMetric(-b.coachingCostPerNewClientCents)} />
      <div style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 12 }}>{coachingCalc}</div>
      <BreakdownRow label="− Payment fees (2.9% Stripe + 1% chargeback = 3.9%)" value={fmtCentsMetric(-b.feeDragPerNewClientCents)} />
      <BreakdownRow label="− Setter commission (per-row actual: 3% others, 5% Amara)" value={fmtCentsMetric(-b.setterCommissionsPerNewClientCents)} />
      <BreakdownRow label="− Closer commission (10% of cash collected)" value={fmtCentsMetric(-b.closerCommissionsPerNewClientCents)} />
      <BreakdownRow label="= Direct costs per new client" value={fmtCentsMetric(b.directCostsPerNewClientCents)} />
      <div style={{ height: 2 }} />
      <BreakdownRow label="→ 30-Day GP per new client" value={fmtCentsMetric(b.gp30Cents)} bold />
    </>
  );
}

function CacDrilldown({ b }: { b: BusinessMetricBreakdown }) {
  const cacPerClient = b.newClientCount > 0 ? Math.round(b.cacTotalCents / b.newClientCount) : 0;
  return (
    <>
      <DrillHeader
        title="CAC per new client"
        formula="(ad spend + acquisition software) ÷ new clients"
        source={`Ad spend: ${b.cacAdSpendSource} · Software: Mercury API (allowlist) · Denominator: sales tracker rows`}
      />
      <BreakdownRow label={`Ad spend (30d)`} value={fmtCentsMetric(b.cacAdSpendCents)} />
      <div style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 12 }}>From {b.cacAdSpendSource}</div>
      <div style={{ height: 4 }} />
      <BreakdownRow label="Acquisition software lines (30d)" value={fmtCentsMetric(b.cacMercurySoftwareCents)} />
      {b.cacAcquisitionLines.map((line) => (
        <div key={line.label} style={{ display: "flex", justifyContent: "space-between", paddingLeft: 16, fontSize: 12 }}>
          <span style={{ color: "var(--text-muted)" }}>
            {line.label} <span style={{ opacity: 0.7 }}>({line.splitNote})</span>
          </span>
          <span style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            {fmtCentsMetric(line.perClientCents)}
          </span>
        </div>
      ))}
      <div style={{ height: 4 }} />
      <BreakdownRow label="= Total CAC spend (30d)" value={fmtCentsMetric(b.cacTotalCents)} />
      <BreakdownRow label={`÷ New clients (from sales tracker)`} value={String(b.newClientCount)} />
      <div style={{ height: 2 }} />
      <BreakdownRow label="→ CAC per new client" value={fmtCentsMetric(cacPerClient)} bold />
    </>
  );
}

function LtgpDrilldown({ b, ltgpCents }: { b: BusinessMetricBreakdown; ltgpCents: number | null }) {
  const grossMarginPerSale = b.ltgpAovCents - b.ltgpDirectCostPerSaleCents;
  return (
    <>
      <DrillHeader
        title="LTGP per customer"
        formula="AOV × gross margin % × avg purchases per customer"
        source={`Sales tracker, ${b.ltgpWindowStart} → ${b.ltgpWindowEnd} (source of truth) · Stripe used for cross-check below`}
      />
      <BreakdownRow label="AOV (cash collected ÷ sales)" value={fmtCentsMetric(b.ltgpAovCents)} />
      <BreakdownRow label="− Direct costs per sale (coaching + fees + commissions)" value={fmtCentsMetric(-b.ltgpDirectCostPerSaleCents)} />
      <BreakdownRow label="= Gross profit per sale" value={fmtCentsMetric(grossMarginPerSale)} />
      <BreakdownRow label="Gross margin %" value={`${b.ltgpGrossMarginPct}%`} />
      <div style={{ height: 4 }} />
      <BreakdownRow label="Total sales in window" value={String(b.ltgpTotalPurchases)} />
      <BreakdownRow label="Unique customers in window" value={String(b.ltgpUniqueCustomers)} />
      <BreakdownRow label="Avg purchases per customer" value={b.ltgpAvgPurchasesPerCustomer.toFixed(2)} />
      <div style={{ height: 2 }} />
      <BreakdownRow
        label={`→ LTGP = ${fmtCentsMetric(grossMarginPerSale)} × ${b.ltgpAvgPurchasesPerCustomer.toFixed(2)}`}
        value={fmtCentsMetric(ltgpCents)}
        bold
      />
      <div style={{ height: 10 }} />
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)" }}>
        Stripe cross-check
      </div>
      <BreakdownRow label="Paying customers in Stripe (succeeded, ≥$200)" value={String(b.ltvCustomerCount)} />
      <BreakdownRow label="Mean Stripe lifetime revenue" value={fmtCentsMetric(b.ltvPerCustomerCents)} />
      <BreakdownRow label="Median Stripe lifetime revenue" value={fmtCentsMetric(b.ltvMedianCents)} />
      <BreakdownRow label="Avg observed tenure" value={`${b.avgTenureMonths.toFixed(1)} months`} />
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, fontStyle: "italic" }}>
        Sales tracker is source of truth. Stripe shown as sanity check — should be in the same ballpark. If they diverge a lot, a sales or a Stripe sync is off.
      </div>
    </>
  );
}

function CapacityDrilldown({ b, capacityPct }: { b: BusinessMetricBreakdown; capacityPct: number | null }) {
  return (
    <>
      <DrillHeader
        title="Fulfillment capacity"
        formula="active end-clients ÷ total coach seats"
        source="Supabase clients table (active count) · coaches.max_clients (pending from PM)"
      />
      <BreakdownRow label="Active end-clients" value={String(b.activeClients)} />
      <BreakdownRow label="Max coach seats" value={capacityPct === null ? "— (waiting on PM)" : "—"} />
      <div style={{ height: 2 }} />
      <BreakdownRow label="→ Capacity %" value={capacityPct === null ? "—" : `${capacityPct}%`} bold />
      {capacityPct === null && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, fontStyle: "italic" }}>
          Waiting on per-coach safe-max numbers from PM. Once provided, this shows current/max as a fraction + percentage.
        </div>
      )}
    </>
  );
}

function BreakdownRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: bold ? "var(--text-primary)" : "var(--text-muted)", fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ color: "var(--text-primary)", fontWeight: bold ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function BusinessMetricStat({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "12px 14px",
        borderRadius: 12,
        border: active ? "1px solid var(--accent)" : "1px solid rgba(255,255,255,0.06)",
        background: active ? "rgba(124,92,252,0.08)" : "rgba(255,255,255,0.02)",
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
        fontFamily: "inherit",
        transition: "border-color 0.15s ease, background 0.15s ease",
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)" }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
        {value}
      </div>
    </button>
  );
}

function fmtCentsMetric(value: number | null): string {
  if (value === null) return "—";
  return fmtDollars(Math.round(value / 100));
}

function fmtCapacityMetric(value: number | null): string {
  if (value === null) return "—";
  return `${value}%`;
}
