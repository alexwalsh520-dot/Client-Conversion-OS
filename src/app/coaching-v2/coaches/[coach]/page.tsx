import Link from "next/link";
import { notFound } from "next/navigation";
import { loadHub, coachRowsWindow, byHealth, norm } from "@/lib/coaching-v2/hub";
import { Dot } from "../../components/bits";
import DigestToggle from "../../components/DigestToggle";

export default async function CoachPage({ params }: { params: Promise<{ coach: string }> }) {
  const { coach: raw } = await params;
  const coach = decodeURIComponent(raw);
  const hub = await loadHub();
  if (!hub) return null;
  if (hub.viewer.coach && norm(hub.viewer.coach) !== norm(coach)) notFound();
  const cs = hub.allActive.filter((c) => norm(c.coach) === norm(coach)).sort(byHealth);
  if (!cs.length && !hub.coaches.some((x) => norm(x) === norm(coach))) notFound();
  const row = coachRowsWindow(hub, 30).find((r) => norm(r.coach) === norm(coach));
  if (!row) notFound();

  // last 28 days of end of day reports for this coach
  const withConvo = cs.filter((c) => c.convoId).length;
  const quiet = cs.filter((c) => c.convoId && (c.lastClientMsgDays ?? 0) >= 7).length;

  return (
    <>
      {!hub.viewer.coach && <Link href="/coaching-v2/coaches" className="h2-crumb">‹ Coaches</Link>}
      <div className="h2-head">
        <div>
          <h1>{coach}</h1>
          <p className="h2-sub">{row.clients} active clients</p>
        </div>
        {hub.viewer.isAdmin && <DigestToggle coach={coach} />}
      </div>

      <div className="h2-kpis">
        <div className="h2-kpi"><div className="l">At risk</div><div className={`v ${row.atRisk ? "r" : ""}`}>{row.atRisk}</div><div className="d">of {row.clients}</div></div>
        <div className="h2-kpi"><div className="l">Coverage 14d</div><div className="v">{row.coveragePct}%</div><div className="d">check in, call, or message</div></div>
        <div className="h2-kpi"><div className="l">Replies owed</div><div className="v">{row.owed}</div><div className="d">{row.replyHours !== null ? `median reply ${row.replyHours}h` : "reply time not measurable yet"}</div></div>
        <div className="h2-kpi"><div className="l">Commissions</div><div className="v">{row.commissionsCount}</div><div className="d">milestones this month</div></div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div className="h2-panel">
          <h3>Inbox{hub.inboxCapturedAt ? ` · captured ${new Date(hub.inboxCapturedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</h3>
          <div className="h2-kv">
            <span className="k2">Conversations</span><span>{withConvo} of {row.clients} clients matched</span>
            <span className="k2">Replies owed</span><span className={row.owed ? "h2-r" : ""}>{row.owed}</span>
            <span className="k2">Median reply time</span><span>{row.replyHours !== null ? `${row.replyHours} hours` : "–"}</span>
            <span className="k2">Quiet clients, 7 days</span><span>{quiet}</span>
          </div>
        </div>
      </div>

      <div className="h2-sec">
        <h2 className="plain">Clients, worst first <span className="n h2-m" style={{ fontWeight: 400 }}>{cs.length}</span></h2>
        <div className="h2-tw">
          <table className="h2-table">
            <thead><tr><th /><th>Client</th><th>Stage</th><th className="num">Days</th><th className="num">Check in</th><th>Why</th></tr></thead>
            <tbody>
              {cs.map((c) => (
                <tr key={c.id} className="row">
                  <td><Dot lvl={c.health} /></td>
                  <td className="name"><Link href={`/coaching-v2/clients/${c.id}`}>{c.name}</Link></td>
                  <td>{c.stage}</td>
                  <td className={`num ${(c.days ?? 0) < 0 ? "h2-r" : ""}`}>{c.days ?? "–"}</td>
                  <td className="num">{c.score ?? "–"}</td>
                  <td className="w">{c.lead ? `${c.lead.label} · ${c.lead.value}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
