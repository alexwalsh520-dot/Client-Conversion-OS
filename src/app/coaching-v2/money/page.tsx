import Link from "next/link";
import { loadHub, money, fmtDay, milestoneDate, norm } from "@/lib/coaching-v2/hub";
import { fetchFinancials, isRealRefund } from "@/lib/coaching-v2/financials";
import { getServiceSupabase } from "@/lib/supabase";
import { Dot } from "../components/bits";
import PayrollTable, { type ExpenseRow } from "../components/PayrollTable";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const hub = await loadHub();
  if (!hub) return null;
  const adminView = hub.viewer.isAdmin && !hub.viewer.viewingAs;
  const { m } = await searchParams;
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthIndex = Math.min(11, Math.max(0, m ? Number(m) - 1 : now.getUTCMonth()));
  const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

  const db = getServiceSupabase();
  const [fin, expQ] = adminView ? await Promise.all([
    fetchFinancials(monthIndex),
    db.from("expenses").select("id, month, name, role, base, commissions, platform, comments, paid, payment_via, payment_cadence").eq("month", monthKey).order("name"),
  ]) : [{ month: "", monthIndex, refunds: [], retentions: [] } as Awaited<ReturnType<typeof fetchFinancials>>, { data: [] as Record<string, unknown>[] }];
  const expenses: ExpenseRow[] = (expQ.data ?? []).map((r) => ({ id: r.id as number, month: r.month as string, name: (r.name as string) ?? "", role: (r.role as string) ?? "", base: Number(r.base) || 0, commissions: Number(r.commissions) || 0, platform: (r.platform as string) ?? "", comments: (r.comments as string) ?? "", paid: !!r.paid, paymentVia: (r.payment_via as string) ?? "", paymentCadence: (r.payment_cadence as string) ?? "" }));

  const refunds = fin.refunds.filter(isRealRefund);
  const refunded = refunds.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const handled = fin.refunds.length - refunds.length;
  const retentionRevenue = fin.retentions.reduce((s, r) => s + r.paymentTotal, 0);
  const payroll = expenses.reduce((s, r) => s + r.base + r.commissions, 0);
  const activeCount = hub.allActive.length;

  const renewalsByCoach = new Map<string, { n: number; rev: number }>();
  for (const r of fin.retentions) { const k = r.coach || "Unassigned"; const v = renewalsByCoach.get(k) ?? { n: 0, rev: 0 }; v.n++; v.rev += r.paymentTotal; renewalsByCoach.set(k, v); }
  const refundsByCause = new Map<string, { n: number; amt: number }>();
  for (const r of refunds) { const k = r.fault || "Not recorded"; const v = refundsByCause.get(k) ?? { n: 0, amt: 0 }; v.n++; v.amt += Number(r.amount) || 0; refundsByCause.set(k, v); }

  // Commissions: milestones completed this month, per coach, plus the payroll commission figure where one exists.
  const inMonth = (d: string | null) => { const x = milestoneDate(d); return !!x && x.startsWith(monthKey); };
  const commissions = hub.coaches.map((coach) => {
    const cs = hub.allActive.concat(hub.clients.filter((c) => c.status !== "active")).filter((c) => norm(c.coach) === norm(coach));
    const count = (key: string) => cs.reduce((s, c) => s + (c.asks.find((a) => a.key === key)?.done && inMonth(c.asks.find((a) => a.key === key)?.doneDate ?? null) ? 1 : 0), 0);
    const w = count("written"), v = count("video"), e = count("extension"), r = count("referral");
    const owed = expenses.find((x) => norm(x.name) === norm(coach))?.commissions ?? null;
    return { coach, w, v, e, r, total: w + v + e + r, owed };
  }).filter((c) => c.total > 0 || c.owed);

  const rows = (adminView ? hub.allActive : hub.active).filter((c) => c.days !== null && c.days <= 30).sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const detected = rows.filter((c) => c.retained && c.retained.by !== "milestone").length;
  const past = rows.filter((c) => (c.days ?? 0) < 0 && !c.asks[2].done).length;
  const notAsked = rows.filter((c) => (c.days ?? 0) >= 0 && (c.days ?? 0) <= 14 && !c.asks[2].done && !c.asks[2].asked).length;
  const byCoach = new Map<string, typeof rows>();
  for (const c of rows) byCoach.set(c.coach || "Unassigned", [...(byCoach.get(c.coach || "Unassigned") ?? []), c]);

  const prev = monthIndex > 0 ? `/coaching-v2/money?m=${monthIndex}` : null;
  const next = monthIndex < now.getUTCMonth() ? `/coaching-v2/money?m=${monthIndex + 2}` : null;

  return (
    <>
      <div className="h2-head">
        <div>
          <h1>{adminView ? "Money" : "Retentions"}</h1>
          <p className="h2-sub">{adminView ? `${MONTHS[monthIndex]} ${year} · renewals in, refunds out, commissions and payroll matched` : "Your clients within 30 days of the end. Renewals are detected from Stripe as they land."}</p>
        </div>
        {adminView && <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {prev ? <Link className="h2-btn s" href={prev}>‹</Link> : <span className="h2-btn s" style={{ opacity: 0.4 }}>‹</span>}
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{MONTHS[monthIndex]}</span>
          {next ? <Link className="h2-btn s" href={next}>›</Link> : <span className="h2-btn s" style={{ opacity: 0.4 }}>›</span>}
        </div>}
      </div>
      {fin.error && <div className="h2-notice"><i />The refunds and retention sheets could not be read. {fin.error}</div>}

      {adminView && (<>
      <div className="h2-kpis">
        <div className="h2-kpi"><div className="l">Renewal revenue</div><div className="v" style={{ color: "var(--success)" }}>{money(retentionRevenue)}</div><div className="d">{fin.retentions.length} retention payments</div></div>
        <div className="h2-kpi"><div className="l">Refunded</div><div className="v r">{money(refunded)}</div><div className="d">{refunds.length} refunds{handled ? `, ${handled} handled` : ""}</div></div>
        <div className="h2-kpi"><div className="l">Payroll</div><div className="v">{money(payroll)}</div><div className="d">{money(expenses.reduce((s, r) => s + r.commissions, 0))} of it commissions</div></div>
        <div className="h2-kpi"><div className="l">Cost per active client</div><div className="v">{activeCount ? money(payroll / activeCount) : "–"}</div><div className="d">payroll ÷ {activeCount} active</div></div>
      </div>

      <div className="h2-grid2" style={{ marginBottom: 12 }}>
        <div className="h2-panel"><h3>Renewals by coach</h3>
          <table className="h2-table"><thead><tr><th>Coach</th><th className="num">Renewals</th><th className="num">Revenue</th></tr></thead><tbody>
            {[...renewalsByCoach.entries()].sort((a, b) => b[1].rev - a[1].rev).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v.n}</td><td className="num">{money(v.rev)}</td></tr>)}
            {!renewalsByCoach.size && <tr><td colSpan={3} className="h2-empty">None on the sheet for this month.</td></tr>}
            {renewalsByCoach.size > 0 && <tr className="total"><td>Total</td><td className="num">{fin.retentions.length}</td><td className="num">{money(retentionRevenue)}</td></tr>}
          </tbody></table></div>
        <div className="h2-panel"><h3>Refunds by cause</h3>
          <table className="h2-table"><thead><tr><th>Cause</th><th className="num">Count</th><th className="num">Amount</th></tr></thead><tbody>
            {[...refundsByCause.entries()].sort((a, b) => b[1].amt - a[1].amt).map(([k, v]) => <tr key={k}><td className="w">{k}</td><td className="num">{v.n}</td><td className="num">{money(v.amt)}</td></tr>)}
            {!refundsByCause.size && <tr><td colSpan={3} className="h2-empty">No refunds this month.</td></tr>}
            {refundsByCause.size > 0 && <tr className="total"><td>Total</td><td className="num">{refunds.length}</td><td className="num">{money(refunded)}</td></tr>}
          </tbody></table></div>
      </div>
      <div className="h2-panel" style={{ marginBottom: 12 }}><h3>Commissions</h3>
          <table className="h2-table"><thead><tr><th>Coach</th><th className="num">Written</th><th className="num">Video</th><th className="num">Ext</th><th className="num">Ref</th><th className="num">Owed</th></tr></thead><tbody>
            {commissions.map((c) => <tr key={c.coach}><td>{c.coach}</td><td className="num">{c.w}</td><td className="num">{c.v}</td><td className="num">{c.e}</td><td className="num">{c.r}</td><td className="num">{c.owed === null ? "–" : money(c.owed)}</td></tr>)}
            {!commissions.length && <tr><td colSpan={6} className="h2-empty">No milestones completed this month yet.</td></tr>}
            {commissions.length > 0 && <tr className="total"><td>Total</td><td className="num">{commissions.reduce((s, c) => s + c.w, 0)}</td><td className="num">{commissions.reduce((s, c) => s + c.v, 0)}</td><td className="num">{commissions.reduce((s, c) => s + c.e, 0)}</td><td className="num">{commissions.reduce((s, c) => s + c.r, 0)}</td><td className="num">{money(commissions.reduce((s, c) => s + (c.owed ?? 0), 0))}</td></tr>}
          </tbody></table>
          <p className="h2-quiet" style={{ margin: "8px 0 0" }}>Counts come from milestone completion dates. Owed comes from the payroll row for that coach.</p>
      </div>
      <div className="h2-panel" style={{ marginBottom: 24 }}><h3>Payroll</h3><PayrollTable rows={expenses} /></div>
      </>)}

      <div className="h2-sec">
        <h2 className="plain">Retentions<span className="why">{rows.length} within 30 days or past the end · <span className="h2-r">{past} past</span> · {notAsked} due and not asked · {detected} detected from Stripe or a closed cycle</span></h2>
        {[...byCoach.entries()].map(([coach, cs]) => (
          <div key={coach} style={{ margin: "0 0 14px" }}>
            <div className="h2-h" style={{ margin: "0 0 6px" }}>{coach} <span className="h2-m" style={{ fontWeight: 400 }}>{cs.length}</span></div>
            <div className="h2-tw">
              <table className="h2-table">
                <thead><tr><th /><th>Client</th><th className="num">Ends</th><th>Ask</th><th>Client said</th><th>Next</th><th>Note</th></tr></thead>
                <tbody>
                  {cs.map((c) => (
                    <tr key={c.id} className="row">
                      <td><Dot lvl={c.health} /></td>
                      <td className="name"><Link href={`/coaching-v2/clients/${c.id}`}>{c.name}</Link></td>
                      <td className={`num ${(c.days ?? 0) < 0 ? "h2-r" : (c.days ?? 0) <= 7 ? "h2-a" : ""}`}>{(c.days ?? 0) < 0 ? `${-(c.days ?? 0)}d ago` : `${c.days}d · ${fmtDay(c.endDate)}`}</td>
                      <td className={c.asks[2].done ? "h2-m" : c.asks[2].asked ? "" : (c.days ?? 0) <= 14 ? "h2-r" : ""} title={c.retained?.detail}>{c.asks[2].done ? (c.retained?.by === "stripe" ? "Extended · Stripe" : c.retained?.by === "cycle" ? "Extended · cycle" : "Extended") : c.asks[2].asked ? "Asked" : "Not asked"}</td>
                      <td className="w">{c.messages.find((x) => x.sender === "client")?.text ?? <span className="h2-m">–</span>}</td>
                      <td>{c.retention.nextStep ?? <span className="h2-m">–</span>}</td>
                      <td className="w">{c.retention.note ?? <Link className="h2-lk" href={`/coaching-v2/clients/${c.id}`}>Add note</Link>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {!rows.length && <div className="h2-list"><div className="h2-empty">No client is within 30 days of their end date.</div></div>}
      </div>
    </>
  );
}
