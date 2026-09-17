import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadFinanceMonth } from "@/lib/coaching-v3/finance";
import { fetchFinancials, isRealRefund } from "@/lib/coaching-v2/financials";
import { getServiceSupabase } from "@/lib/supabase";
import PayrollEditor, { type PayrollRow } from "./PayrollEditor";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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
  const now = new Date();
  const currentMonthIndex = now.getMonth();
  const currentYear = now.getUTCFullYear();
  const monthIndex = m ? Math.max(0, Math.min(11, parseInt(m, 10) - 1)) : currentMonthIndex;

  // Load the selected month AND the trailing 6 months in parallel for the
  // charts. The Sales Tracker's tabs are named by month with no year, so we
  // stay within the current calendar year — capped at the current month for
  // months that haven't started yet. The selected month's own data comes
  // from the same batch when it falls in that window.
  const chartMonths = (() => {
    const start = Math.max(0, currentMonthIndex - 5);
    const out: number[] = [];
    for (let i = start; i <= currentMonthIndex; i++) out.push(i);
    return out;
  })();
  const monthsToLoad = Array.from(
    new Set<number>([monthIndex, ...chartMonths]),
  );
  const monthLoads = await Promise.all(monthsToLoad.map((idx) => fetchFinancials(idx)));
  const financeByIndex = new Map<number, (typeof monthLoads)[number]>();
  monthsToLoad.forEach((idx, i) => financeByIndex.set(idx, monthLoads[i]));

  const chartData = chartMonths.map((idx) => {
    const f = financeByIndex.get(idx);
    const retention = (f?.retentions ?? []).reduce((s, r) => s + (r.paymentTotal || 0), 0);
    const refund = (f?.refunds ?? [])
      .filter(isRealRefund)
      .reduce((s, r) => s + (r.amount || 0), 0);
    return { monthIndex: idx, label: MONTH_LABELS[idx], retention, refund };
  });

  const finance = await loadFinanceMonth(monthIndex);

  // Payroll still comes from expenses (unchanged from V2/V1).
  const targetMonth = `${currentYear}-${String(monthIndex + 1).padStart(2, "0")}`;
  const db = getServiceSupabase();
  const { data: expenses } = await db
    .from("expenses")
    .select("id, month, name, role, base, commissions, platform, comments, paid, payment_via, payment_cadence")
    .eq("month", targetMonth);
  const payroll: PayrollRow[] = (expenses ?? []).map((e) => ({
    id: e.id as number,
    month: (e.month as string) ?? targetMonth,
    name: (e.name as string) ?? "",
    role: (e.role as string) ?? "",
    base: Number(e.base) || 0,
    commissions: Number(e.commissions) || 0,
    platform: (e.platform as string) ?? "",
    cadence: (e.payment_cadence as string) ?? "",
    paid: !!e.paid,
    paymentVia: (e.payment_via as string) ?? "",
  }));
  payroll.sort((a, b) => b.base + b.commissions - (a.base + a.commissions));
  const payrollTotal = payroll.reduce((s, r) => s + r.base + r.commissions, 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 12px", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
          Money · {finance.monthName || targetMonth}
        </h2>
        <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
          Retention + refunds from Sales Tracker · payroll from expenses
        </span>
      </div>

      {/* Month nav — chip strip for the current year. Future months are shown
          but non-clickable since the Sales Tracker only has data through the
          current calendar month. */}
      <MonthNav
        selectedIndex={monthIndex}
        currentMonthIndex={currentMonthIndex}
        year={currentYear}
      />

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

      {/* Trailing 6 months — separate charts for retention and refund
          revenue so a spike in one doesn't compress the other visually. */}
      <section className="h3-sec">
        <h2>
          <span style={{ color: "var(--text-muted)" }}>Trailing 6 months</span>
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 12,
          }}
        >
          <MonthlyBarChart
            title="Retention revenue"
            data={chartData.map((d) => ({
              monthIndex: d.monthIndex,
              label: d.label,
              value: d.retention,
            }))}
            selectedIndex={monthIndex}
            color="var(--success)"
          />
          <MonthlyBarChart
            title="Refunds & cancellations"
            data={chartData.map((d) => ({
              monthIndex: d.monthIndex,
              label: d.label,
              value: d.refund,
            }))}
            selectedIndex={monthIndex}
            color="var(--danger)"
          />
        </div>
      </section>

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

      {/* Payroll — inline add / edit / delete via /api/coaching */}
      <PayrollEditor initialRows={payroll} month={targetMonth} />
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

// ---------------------------------------------------------------------------
// Month nav — 12 chips, current-year, prev/next arrows on the sides. Future
// months (past today's calendar month) render disabled since the Sales Tracker
// only has data through the current month.
// ---------------------------------------------------------------------------

function MonthNav({
  selectedIndex,
  currentMonthIndex,
  year,
}: {
  selectedIndex: number;
  currentMonthIndex: number;
  year: number;
}) {
  const prev = selectedIndex > 0 ? selectedIndex - 1 : null;
  const next =
    selectedIndex < currentMonthIndex ? selectedIndex + 1 : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        margin: "0 0 18px",
        overflowX: "auto",
      }}
    >
      <NavArrow href={prev != null ? `?m=${prev + 1}` : null} label="‹" />
      <div style={{ display: "flex", gap: 6, flex: 1, overflowX: "auto" }}>
        {MONTH_LABELS.map((label, i) => {
          const isFuture = i > currentMonthIndex;
          const isSelected = i === selectedIndex;
          const chip = (
            <span
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: isSelected ? 600 : 500,
                background: isSelected ? "var(--accent)" : "transparent",
                color: isSelected
                  ? "#000"
                  : isFuture
                    ? "var(--text-muted)"
                    : "var(--text-primary)",
                border: `1px solid ${isSelected ? "var(--accent)" : "var(--border-primary)"}`,
                opacity: isFuture ? 0.4 : 1,
                whiteSpace: "nowrap",
                display: "inline-block",
                cursor: isFuture || isSelected ? "default" : "pointer",
              }}
              title={`${label} ${year}`}
            >
              {label}
            </span>
          );
          if (isFuture || isSelected) return <span key={i}>{chip}</span>;
          return (
            <Link key={i} href={`?m=${i + 1}`} style={{ textDecoration: "none" }}>
              {chip}
            </Link>
          );
        })}
      </div>
      <NavArrow href={next != null ? `?m=${next + 1}` : null} label="›" />
    </div>
  );
}

function NavArrow({ href, label }: { href: string | null; label: string }) {
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 8,
    border: "1px solid var(--border-primary)",
    color: href ? "var(--text-primary)" : "var(--text-muted)",
    background: "transparent",
    fontSize: 16,
    lineHeight: 1,
    opacity: href ? 1 : 0.4,
    textDecoration: "none",
    flexShrink: 0,
  };
  if (!href) return <span style={style}>{label}</span>;
  return (
    <Link href={href} style={style}>
      {label}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Trailing-6-month bar chart — inline SVG so it renders server-side with no
// client bundle cost. Height/width scale to the container via a viewBox.
// ---------------------------------------------------------------------------

function MonthlyBarChart({
  title,
  data,
  selectedIndex,
  color,
}: {
  title: string;
  data: { monthIndex: number; label: string; value: number }[];
  selectedIndex: number;
  color: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  const W = 320;
  const H = 160;
  const padTop = 22;
  const padBottom = 28;
  const padLeft = 10;
  const padRight = 10;
  const chartH = H - padTop - padBottom;
  const chartW = W - padLeft - padRight;
  const slot = data.length > 0 ? chartW / data.length : 0;
  const barW = Math.max(18, slot * 0.55);
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-primary)",
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.08, textTransform: "uppercase", color: "var(--text-muted)" }}>
          {title}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          Total {money(total)}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 160, display: "block" }}
        role="img"
        aria-label={`${title}, trailing 6 months bar chart`}
      >
        {data.map((d, i) => {
          const h = (d.value / max) * chartH;
          const x = padLeft + i * slot + (slot - barW) / 2;
          const y = padTop + (chartH - h);
          const isSelected = d.monthIndex === selectedIndex;
          return (
            <g key={d.monthIndex}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(2, h)}
                rx={4}
                fill={color}
                opacity={isSelected ? 1 : 0.55}
              />
              <text
                x={x + barW / 2}
                y={y - 5}
                textAnchor="middle"
                fontSize={9.5}
                fill="var(--text-muted)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {d.value > 0 ? money(d.value) : ""}
              </text>
              <text
                x={x + barW / 2}
                y={H - 10}
                textAnchor="middle"
                fontSize={10.5}
                fontWeight={isSelected ? 600 : 400}
                fill={isSelected ? "var(--text-primary)" : "var(--text-muted)"}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
