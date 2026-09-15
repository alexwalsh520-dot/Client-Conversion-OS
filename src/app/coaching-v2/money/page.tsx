import Link from "next/link";
import { redirect } from "next/navigation";
import { loadHub, money, fmtDay } from "@/lib/coaching-v2/hub";
import { Dot } from "../components/bits";

export default async function MoneyPage() {
  const hub = await loadHub();
  if (!hub) return null;
  if (!hub.viewer.isAdmin) redirect("/coaching-v2");
  const rows = hub.active.filter((c) => c.days !== null && c.days <= 30).sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const past = rows.filter((c) => (c.days ?? 0) < 0).length;
  const notAsked = rows.filter((c) => (c.days ?? 0) >= 0 && (c.days ?? 0) <= 14 && !c.asks[2].done && !c.asks[2].asked).length;
  const extended = rows.filter((c) => c.asks[2].done);
  const byCoach = new Map<string, typeof rows>();
  for (const c of rows) byCoach.set(c.coach || "Unassigned", [...(byCoach.get(c.coach || "Unassigned") ?? []), c]);

  return (
    <>
      <div className="h2-head">
        <div>
          <h1>Money</h1>
          <p className="h2-sub">Retentions first. Refunds, commissions, and payroll still live in the Coaching tab for now.</p>
        </div>
        <Link href="/coaching" className="h2-btn">Open Financials and Expenses</Link>
      </div>

      <div className="h2-sec">
        <h2 className="plain">
          Retentions
          <span className="why">{rows.length} within 30 days or past the end · <span className="h2-r">{past} past</span> · {notAsked} due and not asked · {extended.length} extended, {money(extended.reduce((s, c) => s + c.paid, 0))} on the books</span>
        </h2>
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
                      <td className={c.asks[2].done ? "h2-m" : c.asks[2].asked ? "" : (c.days ?? 0) <= 14 ? "h2-r" : ""}>{c.asks[2].done ? "Extended" : c.asks[2].asked ? "Asked" : "Not asked"}</td>
                      <td className="w">{c.messages.find((m) => m.sender === "client")?.text ?? <span className="h2-m">–</span>}</td>
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
