import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { loadFinanceMonth } from "@/lib/coaching-v3/finance";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtDay(iso: string): string {
  if (!iso) return "—";
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

/**
 * Money page. Admin-only — Sales Tracker data is not for coaches.
 * Retention + refund totals come from the same Google Sheets V1 uses (via
 * /api/coaching/financials), so numbers agree with the legacy Coaching tab.
 */
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
  const monthIndex = m ? Math.max(0, Math.min(11, parseInt(m, 10) - 1)) : new Date().getMonth();

  const finance = await loadFinanceMonth(monthIndex);

  // Payroll still comes from expenses (unchanged from V2/V1).
  const targetMonth = `${new Date().getUTCFullYear()}-${String(monthIndex + 1).padStart(2, "0")}`;
  const db = getServiceSupabase();
  const { data: expenses } = await db
    .from("expenses")
    .select("id, month, name, role, base, commissions, platform, comments, paid, payment_via, payment_cadence")
    .eq("month", targetMonth);
  const payroll = (expenses ?? []).map((e) => ({
    name: (e.name as string) ?? "",
    role: (e.role as string) ?? "",
    base: Number(e.base) || 0,
    commissions: Number(e.commissions) || 0,
    total: (Number(e.base) || 0) + (Number(e.commissions) || 0),
    paid: !!e.paid,
    cadence: (e.payment_cadence as string) ?? "",
  }));
  payroll.sort((a, b) => b.total - a.total);
  const payrollTotal = payroll.reduce((s, r) => s + r.total, 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 12px" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
          Money · {finance.monthName || targetMonth}
        </h2>
        <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
          Retention + refunds from Sales Tracker · payroll from expenses
        </span>
      </div>

      {finance.error && (
        <div className="h3-notice err">
          <i /> Sales Tracker unavailable: {finance.error}
        </div>
      )}

      <div className="h3-kpis">
        <div className="h3-kpi">
          <div className="l">Retentions this month</div>
          <div className={`v ${finance.retentionRevenue > 0 ? "g" : ""}`}>{money(finance.retentionRevenue)}</div>
          <div className="d">{finance.retentionCount} payments logged</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Refunds this month</div>
          <div className={`v ${finance.refundAmount > 0 ? "r" : ""}`}>{money(finance.refundAmount)}</div>
          <div className="d">{finance.refundCount} refund events</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Net retained</div>
          <div className="v">{money(finance.retentionRevenue - finance.refundAmount)}</div>
          <div className="d">Retention minus refund</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Payroll this month</div>
          <div className="v">{money(payrollTotal)}</div>
          <div className="d">{payroll.length} lines</div>
        </div>
      </div>

      {/* By coach */}
      {finance.byCoach.length > 0 && (
        <section className="h3-sec">
          <h2>
            <span className="n">{finance.byCoach.length}</span>
            By coach
          </h2>
          <div className="h3-list" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <Th>Coach</Th>
                  <Th style={{ textAlign: "right" }}>Retentions</Th>
                  <Th style={{ textAlign: "right" }}>Retention $</Th>
                  <Th style={{ textAlign: "right" }}>Refunds</Th>
                  <Th style={{ textAlign: "right" }}>Refund $</Th>
                </tr>
              </thead>
              <tbody>
                {finance.byCoach.map((c) => (
                  <tr key={c.coach} style={{ borderTop: "1px solid var(--border-primary)" }}>
                    <Td>{c.coach}</Td>
                    <Td style={{ textAlign: "right" }}>{c.retentionCount}</Td>
                    <Td style={{ textAlign: "right", color: c.retentionRevenue > 0 ? "var(--success)" : "inherit", fontWeight: 600 }}>
                      {money(c.retentionRevenue)}
                    </Td>
                    <Td style={{ textAlign: "right" }}>{c.refundCount}</Td>
                    <Td style={{ textAlign: "right", color: c.refundAmount > 0 ? "var(--danger)" : "inherit", fontWeight: 600 }}>
                      {money(c.refundAmount)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Retentions detail */}
      <section className="h3-sec">
        <h2>
          <span className="n">{finance.retentions.length}</span>
          Retention payments (Flagship Retention Payments)
        </h2>
        <div className="h3-list" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <Th>Client</Th>
                <Th>Coach</Th>
                <Th>Date</Th>
                <Th>Offer</Th>
                <Th style={{ textAlign: "right" }}>Months</Th>
                <Th style={{ textAlign: "right" }}>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {finance.retentions.map((r, i) => (
                <tr key={`${r.date}-${i}`} style={{ borderTop: "1px solid var(--border-primary)" }}>
                  <Td>{r.clientName}</Td>
                  <Td>{r.coach || "—"}</Td>
                  <Td>{fmtDay(r.date)}</Td>
                  <Td>{r.offer || "—"}</Td>
                  <Td style={{ textAlign: "right" }}>{r.monthsSold || "—"}</Td>
                  <Td style={{ textAlign: "right", color: "var(--success)", fontWeight: 600 }}>
                    {money(r.paymentTotal)}
                  </Td>
                </tr>
              ))}
              {finance.retentions.length === 0 && (
                <tr>
                  <td colSpan={6} className="h3-empty">
                    No retentions logged this month in the Sales Tracker yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Refunds detail */}
      <section className="h3-sec">
        <h2>
          <span className="n">{finance.refunds.length}</span>
          Refunds (Cancellations & Refunds sheet)
        </h2>
        <div className="h3-list" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <Th>Client</Th>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>Sales person</Th>
                <Th>Reason</Th>
                <Th style={{ textAlign: "right" }}>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {finance.refunds.map((r, i) => (
                <tr key={`${r.date}-${i}`} style={{ borderTop: "1px solid var(--border-primary)" }}>
                  <Td>{r.clientName}</Td>
                  <Td>{fmtDay(r.date)}</Td>
                  <Td>{r.type}</Td>
                  <Td>{r.salesPerson || "—"}</Td>
                  <Td style={{ maxWidth: 260, whiteSpace: "normal" }}>{r.reason || "—"}</Td>
                  <Td style={{ textAlign: "right", color: "var(--danger)", fontWeight: 600 }}>
                    {money(r.amount)}
                  </Td>
                </tr>
              ))}
              {finance.refunds.length === 0 && (
                <tr>
                  <td colSpan={6} className="h3-empty">
                    No refunds this month.
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
          <span className="n">{payroll.length}</span>
          Payroll · {targetMonth}
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
              {payroll.map((r) => (
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
              {payroll.length === 0 && (
                <tr>
                  <td colSpan={7} className="h3-empty">
                    No payroll lines for {targetMonth}.
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
