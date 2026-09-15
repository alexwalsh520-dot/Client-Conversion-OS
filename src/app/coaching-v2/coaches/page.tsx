import Link from "next/link";
import { redirect } from "next/navigation";
import { loadHub, coachRows } from "@/lib/coaching-v2/hub";

export default async function CoachesPage() {
  const hub = await loadHub();
  if (!hub) return null;
  if (hub.viewer.coach) redirect(`/coaching-v2/coaches/${encodeURIComponent(hub.viewer.coach)}`);
  const rows = coachRows(hub.active, hub.coaches).sort((a, b) => b.clients - a.clients);
  const team = {
    clients: rows.reduce((s, r) => s + r.clients, 0),
    atRisk: rows.reduce((s, r) => s + r.atRisk, 0),
    owed: rows.reduce((s, r) => s + r.owed, 0),
    pastEnd: rows.reduce((s, r) => s + r.pastEnd, 0),
  };
  return (
    <>
      <div className="h2-head">
        <div>
          <h1>Coaches</h1>
          <p className="h2-sub">Right now, from the roster, check ins, calls, and the Everfit inbox</p>
        </div>
      </div>
      <p className="h2-quiet" style={{ margin: "-8px 0 14px" }}>Ranked by caseload. Coverage means a check in, a call, or a coach message in the last 14 days. Reply time is the median from the inbox where both messages carry a clock time.</p>
      <div className="h2-tw">
        <table className="h2-table">
          <thead>
            <tr><th>Coach</th><th className="num">Clients</th><th className="num">At risk</th><th className="num">Coverage</th><th className="num">Replies owed</th><th className="num">Reply time</th><th className="num">Retention</th><th className="num">Past end</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.coach} className="row">
                <td className="name"><Link href={`/coaching-v2/coaches/${encodeURIComponent(r.coach)}`}>{r.coach}</Link></td>
                <td className="num">{r.clients}</td>
                <td className={`num ${r.atRiskPct > 25 ? "h2-r" : ""}`}>{r.atRiskPct}%</td>
                <td className={`num ${r.coveragePct < 60 ? "h2-r" : r.coveragePct < 80 ? "h2-a" : ""}`}>{r.coveragePct}%</td>
                <td className={`num ${r.owed > 2 ? "h2-r" : ""}`}>{r.owed || "–"}</td>
                <td className={`num ${(r.replyHours ?? 0) > 12 ? "h2-a" : ""}`}>{r.replyHours === null ? "–" : `${r.replyHours}h`}</td>
                <td className="num">{r.retentionPct === null ? "–" : `${r.retentionPct}%`}</td>
                <td className={`num ${r.pastEnd > 6 ? "h2-r" : ""}`}>{r.pastEnd || "–"}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Team</td>
              <td className="num">{team.clients}</td>
              <td className="num">{team.clients ? Math.round((100 * team.atRisk) / team.clients) : 0}%</td>
              <td className="num">{rows.length ? Math.round(rows.reduce((s, r) => s + r.coveragePct, 0) / rows.length) : 0}%</td>
              <td className="num">{team.owed}</td>
              <td className="num">–</td>
              <td className="num">–</td>
              <td className="num">{team.pastEnd}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
