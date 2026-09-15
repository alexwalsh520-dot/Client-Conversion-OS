import Link from "next/link";
import { notFound } from "next/navigation";
import { loadHub, coachRows, byHealth, norm } from "@/lib/coaching-v2/hub";
import { Dot } from "../../components/bits";

export default async function CoachPage({ params }: { params: Promise<{ coach: string }> }) {
  const { coach: raw } = await params;
  const coach = decodeURIComponent(raw);
  const hub = await loadHub();
  if (!hub) return null;
  if (hub.viewer.coach && norm(hub.viewer.coach) !== norm(coach)) notFound();
  const cs = hub.active.filter((c) => norm(c.coach) === norm(coach)).sort(byHealth);
  if (!cs.length && !hub.coaches.some((x) => norm(x) === norm(coach))) notFound();
  const row = coachRows(cs, [coach])[0];

  const retentions = cs.filter((c) => c.days !== null && c.days <= 21).slice(0, 6);
  const unanswered = cs.filter((c) => c.latestCheckin && c.latestCheckin.daysAgo <= 6 && c.coachRepliedAfterCheckin === false && c.convoId).slice(0, 6);
  const praise = cs.filter((c) => (c.score ?? 0) >= 80).slice(0, 4);
  const owed = cs.filter((c) => c.owedDays !== null && c.owedDays >= 1).slice(0, 6);

  return (
    <>
      {!hub.viewer.coach && <Link href="/coaching-v2/coaches" className="h2-crumb">‹ Coaches</Link>}
      <div className="h2-head">
        <div>
          <h1>{coach}</h1>
          <p className="h2-sub">
            {row.clients} clients · <span className={row.atRisk ? "h2-r" : ""}>{row.atRisk} at risk</span> · {row.coveragePct}% coverage · {row.owed} repl{row.owed === 1 ? "y" : "ies"} owed{row.replyHours !== null ? `, median ${row.replyHours} hours` : ""} · {row.pastEnd} past end date
          </p>
        </div>
      </div>

      <div className="h2-sec">
        <h2 className="plain">1:1 prep</h2>
        <div className="h2-prep">
          <div>
            <div className="h2-h">Retentions</div>
            <ul>
              {retentions.length ? retentions.map((c) => (
                <li key={c.id}><b><Link href={`/coaching-v2/clients/${c.id}`}>{c.name}</Link></b> {c.days! < 0 ? `ended ${-c.days!} days ago` : `ends in ${c.days} days`}{c.asks[2].done ? ", extended" : c.asks[2].asked ? ", asked" : ", not asked"}{c.retention.note ? `. ${c.retention.note}` : ""}</li>
              )) : <li>None in the next three weeks.</li>}
            </ul>
          </div>
          <div>
            <div className="h2-h">Replies owed</div>
            <ul>
              {owed.length ? owed.map((c) => (
                <li key={c.id}><b><Link href={`/coaching-v2/clients/${c.id}`}>{c.name}</Link></b> waiting {c.owedDays} day{c.owedDays === 1 ? "" : "s"}: “{(c.messages.find((m) => m.sender === "client")?.text ?? "").slice(0, 70)}”</li>
              )) : <li>All answered.</li>}
            </ul>
          </div>
          <div>
            <div className="h2-h">Check ins with no reply</div>
            <ul>
              {unanswered.length ? unanswered.map((c) => (
                <li key={c.id}><b><Link href={`/coaching-v2/clients/${c.id}`}>{c.name}</Link></b> scored {c.score}{c.latestCheckin?.text ? `: “${c.latestCheckin.text.slice(0, 70)}”` : ""}</li>
              )) : <li>All answered.</li>}
            </ul>
          </div>
          <div>
            <div className="h2-h">Praise</div>
            <ul>
              {praise.length ? praise.map((c) => (
                <li key={c.id}><b><Link href={`/coaching-v2/clients/${c.id}`}>{c.name}</Link></b> check in {c.score}</li>
              )) : <li>Nothing above 80 this week.</li>}
            </ul>
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
