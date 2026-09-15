import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { loadMoney } from "@/lib/coaching-v3/money";

export const dynamic = "force-dynamic";

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");
  if (session.user.role !== "admin") {
    return (
      <div className="h3-list">
        <div className="h3-empty">Money is admin only.</div>
      </div>
    );
  }

  const { m } = await searchParams;
  const view = await loadMoney(m);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 12px" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
          Money · {view.month}
        </h2>
      </div>

      <div className="h3-kpis">
        <div className="h3-kpi">
          <div className="l">Retentions this month</div>
          <div className="v g">{money(view.retentionsTotal)}</div>
          <div className="d">{view.retentions.length} payments ≥ $97</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Refunds this month</div>
          <div className="v r">{money(view.refundsTotal)}</div>
          <div className="d">{view.refunds.length} refund events</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Commissions (est.)</div>
          <div className="v">{money(view.commissionsEstimated)}</div>
          <div className="d">{view.commissions.reduce((s, r) => s + r.count, 0)} completed asks × $50</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Payroll this month</div>
          <div className="v">{money(view.payrollTotal)}</div>
          <div className="d">{view.payroll.length} lines from expenses</div>
        </div>
      </div>

      {/* Retentions board */}
      <section className="h3-sec">
        <h2>
          <span className="n">{view.retentions.length}</span>
          Retention sales
          <span className="why">Stripe payments this month, $97 or more, not subscription cycles</span>
        </h2>
        <div className="h3-list" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <Th>Client</Th>
                <Th>Coach</Th>
                <Th>Date</Th>
                <Th style={{ textAlign: "right" }}>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {view.retentions.map((r, i) => (
                <tr key={`${r.paidAt}-${i}`} style={{ borderTop: "1px solid var(--border-primary)" }}>
                  <Td>{r.clientName}</Td>
                  <Td>{r.coach}</Td>
                  <Td>{fmtDay(r.paidAt)}</Td>
                  <Td style={{ textAlign: "right", color: "var(--success)", fontWeight: 600 }}>
                    {money(r.amount)}
                  </Td>
                </tr>
              ))}
              {view.retentions.length === 0 && (
                <tr>
                  <td colSpan={4} className="h3-empty">
                    No retentions detected this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Refunds */}
      <section className="h3-sec">
        <h2>
          <span className="n">{view.refunds.length}</span>
          Refunds
        </h2>
        <div className="h3-list" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <Th>Client</Th>
                <Th>Coach</Th>
                <Th>Date</Th>
                <Th style={{ textAlign: "right" }}>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {view.refunds.map((r, i) => (
                <tr key={`${r.refundedAt}-${i}`} style={{ borderTop: "1px solid var(--border-primary)" }}>
                  <Td>{r.clientName ?? "—"}</Td>
                  <Td>{r.coach ?? "—"}</Td>
                  <Td>{fmtDay(r.refundedAt)}</Td>
                  <Td style={{ textAlign: "right", color: "var(--danger)", fontWeight: 600 }}>
                    {money(r.amount)}
                  </Td>
                </tr>
              ))}
              {view.refunds.length === 0 && (
                <tr>
                  <td colSpan={4} className="h3-empty">
                    No refunds this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Commissions estimated */}
      <section className="h3-sec">
        <h2>
          <span className="n">{view.commissions.length}</span>
          Commissions estimated
          <span className="why">Completed milestones × $50 rule of thumb</span>
        </h2>
        <div className="h3-list" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <Th>Coach</Th>
                <Th style={{ textAlign: "right" }}>Completed asks</Th>
                <Th style={{ textAlign: "right" }}>Estimated $</Th>
              </tr>
            </thead>
            <tbody>
              {view.commissions.map((r) => (
                <tr key={r.coach} style={{ borderTop: "1px solid var(--border-primary)" }}>
                  <Td>{r.coach}</Td>
                  <Td style={{ textAlign: "right" }}>{r.count}</Td>
                  <Td style={{ textAlign: "right", fontWeight: 600 }}>{money(r.estimated)}</Td>
                </tr>
              ))}
              {view.commissions.length === 0 && (
                <tr>
                  <td colSpan={3} className="h3-empty">
                    No completed asks this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Payroll */}
      <section className="h3-sec">
        <h2>
          <span className="n">{view.payroll.length}</span>
          Payroll
          <span className="why">From expenses table for {view.month}</span>
        </h2>
        <div className="h3-list" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th style={{ textAlign: "right" }}>Base</Th>
                <Th style={{ textAlign: "right" }}>Commissions</Th>
                <Th style={{ textAlign: "right" }}>Total</Th>
                <Th>Cadence</Th>
                <Th>Paid</Th>
              </tr>
            </thead>
            <tbody>
              {view.payroll.map((r) => (
                <tr key={r.name} style={{ borderTop: "1px solid var(--border-primary)" }}>
                  <Td>{r.name}</Td>
                  <Td>{r.role}</Td>
                  <Td style={{ textAlign: "right" }}>{money(r.base)}</Td>
                  <Td style={{ textAlign: "right" }}>{money(r.commissions)}</Td>
                  <Td style={{ textAlign: "right", fontWeight: 700 }}>{money(r.total)}</Td>
                  <Td>{r.cadence || "—"}</Td>
                  <Td>
                    <span style={{ color: r.paid ? "var(--success)" : "var(--warning)" }}>
                      {r.paid ? "paid" : "pending"}
                    </span>
                  </Td>
                </tr>
              ))}
              {view.payroll.length === 0 && (
                <tr>
                  <td colSpan={7} className="h3-empty">
                    No payroll lines for {view.month}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        padding: "10px 14px",
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: 0.05,
        textTransform: "uppercase",
        ...style,
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: "10px 14px", fontVariantNumeric: "tabular-nums", ...style }}>
      {children}
    </td>
  );
}
