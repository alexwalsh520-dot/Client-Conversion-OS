import Link from "next/link";
import { redirect } from "next/navigation";
import { loadHub, coachRowsWindow, norm, isoDaysAgo } from "@/lib/coaching-v2/hub";
import { fetchFinancials, isRealRefund } from "@/lib/coaching-v2/financials";

export default async function CoachesPage({ searchParams }: { searchParams: Promise<{ win?: string }> }) {
  const hub = await loadHub();
  if (!hub) return null;
  if (hub.viewer.coach) redirect(`/coaching-v2/coaches/${encodeURIComponent(hub.viewer.coach)}`);
  const { win } = await searchParams;
  const windowDays = [7, 30, 90].includes(Number(win)) ? Number(win) : 30;

  // Refunds per coach come from the refunds sheet for the current month.
  const fin = await fetchFinancials(Number(hub.today.slice(5, 7)) - 1);
  const refundsByCoach: Record<string, number> = {};
  for (const r of fin.refunds.filter(isRealRefund)) {
    const client = hub.allActive.concat(hub.clients).find((c) => norm(c.name) === norm(r.clientName));
    const k = norm(client?.coach ?? "");
    if (k) refundsByCoach[k] = (refundsByCoach[k] ?? 0) + 1;
  }

  const rows = coachRowsWindow(hub, windowDays, refundsByCoach).sort((a, b) => b.clients - a.clients);
  const ranked = rows.filter((r) => r.clients > 0).map((r) => ({ ...r, s: (100 - r.atRiskPct) * 1.5 + r.coveragePct - r.clients / 2 - (r.replyHours ?? 0) })).sort((a, b) => b.s - a.s).slice(0, 3);
  const team = { clients: rows.reduce((s, r) => s + r.clients, 0), atRisk: rows.reduce((s, r) => s + r.atRisk, 0), owed: rows.reduce((s, r) => s + r.owed, 0), pastEnd: rows.reduce((s, r) => s + r.pastEnd, 0) };
  const due = hub.allActive.filter((c) => c.days !== null && c.days >= 0 && c.days <= 14);
  const asked = due.filter((c) => c.asks[2].asked || c.asks[2].done).length;
  const weekCut = isoDaysAgo(7);
  const reportsThisWeek = Object.values(hub.eod.byCoach).reduce((s, ds) => s + new Set(ds.filter((d) => d >= weekCut)).size, 0);

  return (
    <>
      <div className="h2-head">
        <div>
          <h1>Coaches</h1>
          <p className="h2-sub">Outcomes over the last {windowDays} days. This screen is the Monday review.</p>
        </div>
        <div className="h2-seg">
          {[7, 30, 90].map((w) => <Link key={w} href={`/coaching-v2/coaches?win=${w}`} className={windowDays === w ? "on" : ""}>{w} days</Link>)}
        </div>
      </div>

      <div className="h2-grid2" style={{ marginBottom: 14 }}>
        <div className="h2-panel">
          <h3>Next new client goes to</h3>
          {ranked.map((r, i) => (
            <div className="h2-rank" key={r.coach}>
              <span className="i">{i + 1}</span>
              <span><b style={{ fontWeight: 500 }}>{r.coach}</b> <span className="r">· {r.clients} clients</span></span>
              <span className="r">{r.atRiskPct}% at risk · {r.coveragePct}% coverage{r.replyHours !== null ? ` · replies in ${r.replyHours}h` : ""}</span>
            </div>
          ))}
          <p className="h2-quiet" style={{ margin: "8px 0 0" }}>Ranked by at risk share, coverage, caseload, and reply time. Ahmad writes the Monday post from this.</p>
        </div>
        <div className="h2-panel">
          <h3>Team this week</h3>
          <div className="h2-kv">
            <span className="k2">Clients at risk</span><span>{team.atRisk} of {team.clients}</span>
            <span className="k2">Replies owed</span><span>{team.owed} client{team.owed === 1 ? "" : "s"} waiting</span>
            <span className="k2">Renewals asked</span><span>{asked} of {due.length} due</span>
            <span className="k2">Reports submitted</span><span className={reportsThisWeek ? "" : "h2-r"}>{reportsThisWeek} of {rows.filter((r) => r.clients > 0).length * 5} expected</span>
          </div>
        </div>
      </div>

      <div className="h2-tw">
        <table className="h2-table">
          <thead>
            <tr><th>Coach</th><th className="num">Clients</th><th className="num">At risk</th><th className="num">Coverage</th><th className="num">Replies owed</th><th className="num">Reply time</th><th className="num">Retention</th><th className="num">Expired</th><th className="num">Refunds</th><th className="num">Asks made</th><th className="num">Calls / client</th><th className="num">Reports</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.coach} className="row">
                <td className="name"><Link href={`/coaching-v2/coaches/${encodeURIComponent(r.coach)}`}>{r.coach}</Link></td>
                <td className="num">{r.clients}</td>
                <td className={`num ${r.atRiskPct > 25 ? "h2-r" : ""}`}>{r.atRisk} <span className="h2-m">{r.atRiskPct}%</span></td>
                <td className={`num ${r.coveragePct < 60 ? "h2-r" : r.coveragePct < 80 ? "h2-a" : ""}`}>{r.coveragePct}%</td>
                <td className={`num ${r.owed > 2 ? "h2-r" : ""}`}>{r.owed || "–"}</td>
                <td className={`num ${(r.replyHours ?? 0) > 12 ? "h2-a" : ""}`}>{r.replyHours === null ? "–" : `${r.replyHours}h`}</td>
                <td className="num">{r.retentionPct === null ? "–" : `${r.retentionPct}%`}</td>
                <td className={`num ${r.pastEnd > 6 ? "h2-r" : ""}`}>{r.pastEnd || "–"}</td>
                <td className="num">{r.refunds === null ? "–" : r.refunds || "–"}</td>
                <td className="num">{r.asksPct === null ? "–" : `${r.asksPct}%`}</td>
                <td className="num">{r.callsPerClient === null ? "–" : r.callsPerClient}</td>
                <td className={`num ${(r.reportsPct ?? 0) === 0 ? "h2-r" : ""}`}>{r.reportsPct === null ? "–" : `${r.reportsPct}%`}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Team</td>
              <td className="num">{team.clients}</td>
              <td className="num">{team.atRisk}</td>
              <td className="num">{rows.length ? Math.round(rows.reduce((s, r) => s + r.coveragePct, 0) / rows.length) : 0}%</td>
              <td className="num">{team.owed}</td>
              <td className="num">–</td>
              <td className="num">–</td>
              <td className="num">{team.pastEnd}</td>
              <td className="num">{Object.values(refundsByCoach).reduce((s, n) => s + n, 0) || "–"}</td>
              <td className="num">–</td>
              <td className="num">–</td>
              <td className="num">–</td>
            </tr>
          </tbody>
        </table>
      </div>
      {fin.error && <p className="h2-quiet" style={{ marginTop: 10 }}>Refunds could not be read from the sheet. {fin.error}</p>}
    </>
  );
}
