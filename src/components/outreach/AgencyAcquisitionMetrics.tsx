"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import type { AgencyAcquisitionMetrics } from "@/lib/agency-acquisition-metrics";

function fmtDollars(cents: number): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const formatted = abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${dollars < 0 ? "-" : ""}$${formatted}`;
}

type CardKey = "gp30" | "cac" | "ltgp" | "capacity";

export default function AgencyAcquisitionMetricsStrip() {
  const [data, setData] = useState<AgencyAcquisitionMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<CardKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/outreach/agency-metrics", { cache: "no-store" });
      const raw = await res.text();
      let body: AgencyAcquisitionMetrics | { error?: string };
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error(`Couldn't load agency metrics (HTTP ${res.status}).`);
      }
      if (!res.ok) {
        throw new Error(("error" in body && body.error) || "Failed to load agency metrics");
      }
      setData(body as AgencyAcquisitionMetrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agency metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const newestGp30 = data?.gp30.perClient.find((c) => c.profitCents !== null) ?? null;

  const cards: Array<{
    key: CardKey;
    label: string;
    value: string;
    detail: string;
  }> = data
    ? [
        {
          key: "gp30",
          label: "30-Day GP",
          value: newestGp30 ? fmtDollars(newestGp30.profitCents!) : "—",
          detail: newestGp30
            ? `${newestGp30.label}: first 30 days after signing`
            : "Populates for clients signed going forward",
        },
        {
          key: "cac",
          label: "CAC",
          value:
            data.cac.perClientCents !== null
              ? fmtDollars(data.cac.perClientCents)
              : fmtDollars(data.cac.monthlyAvgCents),
          detail:
            data.cac.perClientCents !== null
              ? `Acquisition software ÷ ${data.cac.clientsSignedInWindow} client${data.cac.clientsSignedInWindow === 1 ? "" : "s"} signed`
              : "Acquisition software $/month (no clients signed in window)",
        },
        {
          key: "ltgp",
          label: "LTGP",
          value: fmtDollars(data.ltgp.profitCents),
          detail: `All money in minus costs${data.ltgp.dataSince ? ` since ${data.ltgp.dataSince}` : ""} (owner draws excluded)`,
        },
        {
          key: "capacity",
          label: "Capacity",
          value: `+${data.capacity.openSlots} slots`,
          detail: `${data.capacity.activeClients} active, ${data.capacity.onboardingClients} onboarding — room for ${data.capacity.openSlots} more`,
        },
      ]
    : [];

  return (
    <div className="section">
      <div className="glass-static" style={{ padding: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, marginBottom: 16 }}>
          Agency Economics
        </div>

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-secondary)", fontSize: 14, padding: "12px 0" }}>
            <Loader2 size={16} className="spin" /> Loading agency metrics...
          </div>
        )}

        {error && !loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--danger)", background: "var(--danger-soft)", borderRadius: 12, padding: "14px 16px", fontSize: 13 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {cards.map((card) => {
                const active = open === card.key;
                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => setOpen(active ? null : card.key)}
                    style={{
                      textAlign: "left",
                      border: `1px solid ${active ? "var(--accent)" : "var(--border-primary)"}`,
                      background: active ? "var(--accent-soft)" : "var(--hover-bg-subtle)",
                      borderRadius: 14,
                      padding: 16,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      minHeight: 110,
                      color: "inherit",
                      font: "inherit",
                    }}
                  >
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7, color: active ? "var(--accent)" : "var(--text-muted)", fontWeight: 600 }}>
                      {card.label}
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.6 }}>{card.value}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>{card.detail}</div>
                  </button>
                );
              })}
            </div>

            {open === "cac" && (
              <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 12, background: "var(--hover-bg-subtle)", fontSize: 12, color: "var(--text-secondary)" }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: "var(--text-primary)" }}>
                  Acquisition software — {fmtDollars(data.cac.totalCents)} total, ~{fmtDollars(data.cac.monthlyAvgCents)}/mo
                </div>
                {data.cac.items.length === 0 ? (
                  <div>No acquisition software charges found in Mercury yet.</div>
                ) : (
                  data.cac.items.map((item) => (
                    <div key={item.label} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                      <span>{item.label}</span>
                      <span>{fmtDollars(item.totalCents)}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {open === "ltgp" && (
              <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 12, background: "var(--hover-bg-subtle)", fontSize: 12, color: "var(--text-secondary)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>Money in (CoreShift)</span><span>{fmtDollars(data.ltgp.revenueCents)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>Costs (excl. owner draws)</span><span>-{fmtDollars(data.ltgp.costCents)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", color: "var(--text-muted)" }}>
                  <span>Owner draws excluded</span><span>{fmtDollars(data.ltgp.ownerDrawsExcludedCents)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0 0", fontWeight: 700, color: "var(--text-primary)", borderTop: "1px solid var(--border-primary)", marginTop: 6 }}>
                  <span>LTGP</span><span>{fmtDollars(data.ltgp.profitCents)}</span>
                </div>
              </div>
            )}

            {open === "gp30" && (
              <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 12, background: "var(--hover-bg-subtle)", fontSize: 12, color: "var(--text-secondary)" }}>
                {data.gp30.perClient.map((client) => (
                  <div key={client.key} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                    <span>{client.label}</span>
                    <span>{client.profitCents !== null ? fmtDollars(client.profitCents) : "—"} <span style={{ color: "var(--text-muted)" }}>({client.note})</span></span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
