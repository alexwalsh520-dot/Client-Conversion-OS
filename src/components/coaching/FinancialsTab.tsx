"use client";

import { useState, useEffect } from "react";
import { DollarSign, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, AlertTriangle, Loader2 } from "lucide-react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface RefundRow {
  clientName: string;
  date: string;
  type: string;
  amount: number;
  fault: string;
  reason: string;
  salesPerson: string;
  disputed: string;
}

interface RetentionRow {
  callNumber: string;
  date: string;
  clientName: string;
  paymentTotal: number;
  coach: string;
  isNew: string;
  offer: string;
  monthsSold: number;
}

export default function FinancialsTab() {
  const [monthIndex, setMonthIndex] = useState(new Date().getMonth());
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [retentions, setRetentions] = useState<RetentionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/coaching/financials?month=${monthIndex}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch");
        setRefunds(data.refunds || []);
        setRetentions(data.retentions || []);
      } catch (err) {
        console.error("Financials fetch error:", err);
        setError(err instanceof Error ? err.message : "Failed to load financial data");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [monthIndex]);

  const totalRefunds = refunds.reduce((s, r) => s + r.amount, 0);
  const totalRetention = retentions.reduce((s, r) => s + r.paymentTotal, 0);
  const netRevenue = totalRetention - totalRefunds;

  // Retention by coach
  const coachRetention = retentions.reduce<Record<string, number>>((acc, r) => {
    if (!r.coach) return acc;
    acc[r.coach] = (acc[r.coach] || 0) + r.paymentTotal;
    return acc;
  }, {});

  // Refunds by fault category
  const faultBreakdown = refunds.reduce<Record<string, { count: number; total: number }>>((acc, r) => {
    const fault = r.fault || "Unknown";
    if (!acc[fault]) acc[fault] = { count: 0, total: 0 };
    acc[fault].count++;
    acc[fault].total += r.amount;
    return acc;
  }, {});

  const fmtMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const prevMonth = () => setMonthIndex((m) => Math.max(0, m - 1));
  const nextMonth = () => setMonthIndex((m) => Math.min(11, m + 1));

  return (
    <div>
      {/* Month Selector */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 20 }}>
        <button
          onClick={prevMonth}
          disabled={monthIndex === 0}
          style={{
            background: "none", border: "none", cursor: monthIndex === 0 ? "default" : "pointer",
            color: monthIndex === 0 ? "var(--text-muted)" : "var(--text-primary)", padding: 4,
            opacity: monthIndex === 0 ? 0.3 : 1,
          }}
        >
          <ChevronLeft size={20} />
        </button>
        <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 18, minWidth: 160, textAlign: "center" }}>
          {MONTHS[monthIndex]} {new Date().getFullYear()}
        </span>
        <button
          onClick={nextMonth}
          disabled={monthIndex === 11}
          style={{
            background: "none", border: "none", cursor: monthIndex === 11 ? "default" : "pointer",
            color: monthIndex === 11 ? "var(--text-muted)" : "var(--text-primary)", padding: 4,
            opacity: monthIndex === 11 ? 0.3 : 1,
          }}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
          <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} />
          <div style={{ marginTop: 8, fontSize: 13 }}>Loading financial data...</div>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {error && (
        <div style={{ padding: 16, background: "rgba(217, 142, 142, 0.1)", borderRadius: 8, color: "var(--danger)", fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* KPIs */}
          <div className="metric-grid metric-grid-4" style={{ marginBottom: 20 }}>
            <div className="glass-static metric-card">
              <div className="metric-card-label">Retention Revenue</div>
              <div className="metric-card-value" style={{ color: "var(--success)" }}>{fmtMoney(totalRetention)}</div>
            </div>
            <div className="glass-static metric-card">
              <div className="metric-card-label">Total Refunded</div>
              <div className="metric-card-value" style={{ color: "var(--danger)" }}>{fmtMoney(totalRefunds)}</div>
            </div>
            <div className="glass-static metric-card">
              <div className="metric-card-label">Net</div>
              <div className="metric-card-value" style={{ color: netRevenue >= 0 ? "var(--accent)" : "var(--danger)" }}>
                {fmtMoney(netRevenue)}
              </div>
            </div>
            <div className="glass-static metric-card">
              <div className="metric-card-label">Refund Count</div>
              <div className="metric-card-value">{refunds.length}</div>
            </div>
          </div>

          {/* Retention by Coach */}
          {Object.keys(coachRetention).length > 0 && (
            <div className="section">
              <h2 className="section-title">
                <DollarSign size={16} />
                Retention by Coach
              </h2>
              <div className="glass-static" style={{ overflow: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Coach</th>
                      <th>Retention Revenue</th>
                      <th>Clients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(coachRetention)
                      .sort(([, a], [, b]) => b - a)
                      .map(([coach, total]) => (
                        <tr key={coach}>
                          <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{coach}</td>
                          <td style={{ color: "var(--success)", fontWeight: 600 }}>{fmtMoney(total)}</td>
                          <td>{retentions.filter((r) => r.coach === coach).length}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Flagship Retention Payments */}
          <div className="section">
            <h2 className="section-title">
              <TrendingUp size={16} />
              Flagship Retention Payments
            </h2>
            {retentions.length === 0 ? (
              <div className="glass-static" style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No retention payments recorded for {MONTHS[monthIndex]}.
              </div>
            ) : (
              <div className="glass-static" style={{ overflow: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Date</th>
                      <th>Payment</th>
                      <th>Coach</th>
                      <th>New?</th>
                      <th>Offer</th>
                      <th>Months Sold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retentions.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{r.clientName}</td>
                        <td style={{ fontSize: 12 }}>{r.date}</td>
                        <td style={{ color: "var(--success)", fontWeight: 600 }}>{fmtMoney(r.paymentTotal)}</td>
                        <td>{r.coach}</td>
                        <td>
                          <span style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: r.isNew?.toLowerCase() === "yes" ? "rgba(126, 201, 160, 0.15)" : "rgba(201, 169, 110, 0.15)",
                            color: r.isNew?.toLowerCase() === "yes" ? "var(--success)" : "var(--accent)",
                          }}>
                            {r.isNew || "-"}
                          </span>
                        </td>
                        <td style={{ fontSize: 12 }}>{r.offer}</td>
                        <td style={{ textAlign: "center" }}>{r.monthsSold || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Refund Fault Breakdown */}
          {Object.keys(faultBreakdown).length > 0 && (
            <div className="section">
              <h2 className="section-title">
                <AlertTriangle size={16} />
                Refunds by Fault Category
              </h2>
              <div className="glass-static" style={{ overflow: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Fault</th>
                      <th>Count</th>
                      <th>Total Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(faultBreakdown)
                      .sort(([, a], [, b]) => b.total - a.total)
                      .map(([fault, data]) => (
                        <tr key={fault}>
                          <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{fault}</td>
                          <td>{data.count}</td>
                          <td style={{ color: "var(--danger)", fontWeight: 600 }}>{fmtMoney(data.total)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cancellations & Refunds */}
          <div className="section">
            <h2 className="section-title">
              <TrendingDown size={16} />
              Cancellations &amp; Refunds
            </h2>
            {refunds.length === 0 ? (
              <div className="glass-static" style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No refunds or cancellations for {MONTHS[monthIndex]}.
              </div>
            ) : (
              <div className="glass-static" style={{ overflow: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Amount</th>
                      <th>Fault</th>
                      <th>Reason</th>
                      <th>Sales</th>
                      <th>Disputed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refunds.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{r.clientName}</td>
                        <td style={{ fontSize: 12 }}>{r.date}</td>
                        <td>
                          <span style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: r.type === "Refund" ? "rgba(217, 142, 142, 0.15)" : "rgba(201, 169, 110, 0.15)",
                            color: r.type === "Refund" ? "var(--danger)" : "var(--accent)",
                          }}>
                            {r.type}
                          </span>
                        </td>
                        <td style={{ color: "var(--danger)", fontWeight: 600 }}>{fmtMoney(r.amount)}</td>
                        <td style={{ fontSize: 12 }}>{r.fault}</td>
                        <td style={{ fontSize: 12, maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason}>
                          {r.reason}
                        </td>
                        <td style={{ fontSize: 12 }}>{r.salesPerson || "-"}</td>
                        <td>
                          <span style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: r.disputed?.toLowerCase() === "yes" ? "rgba(217, 142, 142, 0.15)" : "rgba(126, 201, 160, 0.1)",
                            color: r.disputed?.toLowerCase() === "yes" ? "var(--danger)" : "var(--text-muted)",
                          }}>
                            {r.disputed || "no"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
