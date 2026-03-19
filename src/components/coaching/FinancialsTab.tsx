"use client";

import { DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import type { FinanceRecord, Client } from "@/lib/types";

interface Props {
  finances: FinanceRecord[];
  clients: Client[];
}

export default function FinancialsTab({ finances, clients }: Props) {
  // Aggregate stats
  const totalRevenue = finances.reduce((s, f) => s + f.amountPaid, 0);
  const totalRefunds = finances.reduce((s, f) => s + f.refundAmount, 0);
  const totalRetention = finances.reduce((s, f) => s + f.retentionRevenue, 0);
  const netRevenue = totalRevenue - totalRefunds + totalRetention;

  const refundRecords = finances.filter((f) => f.refundAmount > 0);
  const retentionRecords = finances.filter((f) => f.retentionRevenue > 0);

  // Revenue by coach
  const coachRevenue = finances.reduce<Record<string, { paid: number; refunds: number; retention: number }>>((acc, f) => {
    if (!f.coachName) return acc;
    if (!acc[f.coachName]) acc[f.coachName] = { paid: 0, refunds: 0, retention: 0 };
    acc[f.coachName].paid += f.amountPaid;
    acc[f.coachName].refunds += f.refundAmount;
    acc[f.coachName].retention += f.retentionRevenue;
    return acc;
  }, {});

  const fmtMoney = (n: number) => `$${n.toLocaleString()}`;

  return (
    <div>
      {/* KPIs */}
      <div className="metric-grid metric-grid-4" style={{ marginBottom: 20 }}>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Total Collected</div>
          <div className="metric-card-value">{fmtMoney(totalRevenue)}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Total Refunded</div>
          <div className="metric-card-value" style={{ color: "var(--danger)" }}>{fmtMoney(totalRefunds)}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Retention Revenue</div>
          <div className="metric-card-value" style={{ color: "var(--success)" }}>{fmtMoney(totalRetention)}</div>
        </div>
        <div className="glass-static metric-card">
          <div className="metric-card-label">Net Revenue</div>
          <div className="metric-card-value" style={{ color: "var(--accent)" }}>{fmtMoney(netRevenue)}</div>
        </div>
      </div>

      {/* Revenue by Coach */}
      <div className="section">
        <h2 className="section-title">
          <DollarSign size={16} />
          Revenue by Coach
        </h2>
        <div className="glass-static" style={{ overflow: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Coach</th>
                <th>Collected</th>
                <th>Refunded</th>
                <th>Retention</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(coachRevenue)
                .sort(([, a], [, b]) => (b.paid - b.refunds + b.retention) - (a.paid - a.refunds + a.retention))
                .map(([coach, data]) => (
                  <tr key={coach}>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{coach}</td>
                    <td>{fmtMoney(data.paid)}</td>
                    <td style={{ color: data.refunds > 0 ? "var(--danger)" : "var(--text-muted)" }}>{fmtMoney(data.refunds)}</td>
                    <td style={{ color: data.retention > 0 ? "var(--success)" : "var(--text-muted)" }}>{fmtMoney(data.retention)}</td>
                    <td style={{ fontWeight: 600, color: "var(--accent)" }}>{fmtMoney(data.paid - data.refunds + data.retention)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Retentions */}
      {retentionRecords.length > 0 && (
        <div className="section">
          <h2 className="section-title">
            <TrendingUp size={16} />
            Retentions
          </h2>
          {retentionRecords.map((record) => (
            <div key={record.id} className="glass-static" style={{ padding: 14, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{record.clientName}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>Coach: {record.coachName}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "var(--success)", fontWeight: 600 }}>{fmtMoney(record.retentionRevenue)}</div>
                  {record.retentionDate && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{record.retentionDate}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Refunds */}
      {refundRecords.length > 0 && (
        <div className="section">
          <h2 className="section-title">
            <TrendingDown size={16} />
            Refunds
          </h2>
          {refundRecords.map((record) => (
            <div key={record.id} className="glass-static" style={{ padding: 14, marginBottom: 8, borderLeft: "3px solid var(--danger)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: 14 }}>{record.clientName}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>Coach: {record.coachName}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "var(--danger)", fontWeight: 600 }}>-{fmtMoney(record.refundAmount)}</div>
                  {record.refundDate && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{record.refundDate}</div>
                  )}
                </div>
              </div>
              {record.refundReason && (
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>{record.refundReason}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Full Records */}
      <div className="section">
        <h2 className="section-title">All Finance Records</h2>
        <div className="glass-static" style={{ overflow: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Coach</th>
                <th>Paid</th>
                <th>Refund</th>
                <th>Retention</th>
                <th>Refund Date</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {finances.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{f.clientName}</td>
                  <td>{f.coachName}</td>
                  <td>{fmtMoney(f.amountPaid)}</td>
                  <td style={{ color: f.refundAmount > 0 ? "var(--danger)" : "var(--text-muted)" }}>
                    {f.refundAmount > 0 ? `-${fmtMoney(f.refundAmount)}` : "-"}
                  </td>
                  <td style={{ color: f.retentionRevenue > 0 ? "var(--success)" : "var(--text-muted)" }}>
                    {f.retentionRevenue > 0 ? fmtMoney(f.retentionRevenue) : "-"}
                  </td>
                  <td style={{ fontSize: 12 }}>{f.refundDate || "-"}</td>
                  <td style={{ fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.refundReason || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
