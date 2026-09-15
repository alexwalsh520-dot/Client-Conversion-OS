import Link from "next/link";
import { notFound } from "next/navigation";
import { loadHub, fmtDay, fmtDayYear, money, goalSentence, type HubClient, type Signal } from "@/lib/coaching-v2/hub";
import { StatusChip, initials } from "../../components/bits";
import RenewalPanel from "../../components/RenewalPanel";
import ClientActions from "../../components/ClientActions";

function flag(s: Signal, c: HubClient): React.ReactNode {
  const em = (t: string) => <em>{t}</em>;
  switch (s.label) {
    case "Program":
      if (c.days !== null && c.days < 0 && c.asks[2].done) return <>Extended, but the end date still reads {em(`${-c.days} days ago`)}. Update it.</>;
      return c.days !== null && c.days < 0
        ? <>Program ended {em(`${-c.days} days ago`)} and no decision is recorded.</>
        : <>Program ends in {em(`${c.days} days`)} and the extension has not been asked.</>;
    case "Messages":
      return c.owedDays ? <>Client has been waiting {em(`${c.owedDays} day${c.owedDays === 1 ? "" : "s"}`)} for a reply.</> : <>Client has been quiet for {em(`${c.lastClientMsgDays} days`)}.</>;
    case "Check in score":
      return <>Last check in scored {em(`${c.score} out of 100`)}.</>;
    case "Check in":
      return <>No check in for {em(`${c.lastCheckDays} days`)}.</>;
    case "Coach contact":
      return s.value.startsWith("No call") ? <>No call or message from the coach {em("on record")}.</> : <>No call or message from the coach for {em(s.value.replace("None for ", ""))}.</>;
    case "Nutrition plan":
      return <>Nutrition plan has been waiting {em(`${c.nutritionWaitDays} days`)}.</>;
    default:
      return <>{s.label}: {s.value}</>;
  }
}

function primaryFor(c: HubClient): { label: string; action: "extend" | "reply" | "call" | "video" | "plan" } {
  if (c.status === "active" && c.days !== null && (c.days < 0 || (c.days <= 14 && !c.asks[2].done && !c.asks[2].asked))) return { label: "Extend program", action: "extend" };
  if (c.owedDays) return { label: "Reply in Everfit", action: "reply" };
  if (c.nutritionWaitDays !== null && c.nutritionWaitDays >= 4) return { label: "Review plan", action: "plan" };
  if ((c.score ?? 0) >= 80 && !c.asks[1].done && !c.asks[1].asked) return { label: "Ask for a video", action: "video" };
  return { label: "Log a call", action: "call" };
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hub = await loadHub();
  if (!hub) return null;
  const c = hub.clients.find((x) => x.id === Number(id));
  if (!c) notFound();

  const bad = c.signals.filter((s) => s.lvl !== "g");
  const ci = c.latestCheckin;
  const recent = c.messages.slice(0, 3);
  const scores = c.checkins.slice(0, 4).reverse();
  const showRenewal = c.status === "active" && c.days !== null && c.days <= 30;
  const goal = goalSentence(c);
  const pct = c.week && c.weeks ? Math.min(100, Math.round((100 * c.week) / c.weeks)) : null;
  const history = [
    ...c.messages.map((m) => ({ at: m.at, ty: "Message", who: m.sender === "client" ? c.name : c.coach, text: m.text, client: m.sender === "client" })),
    ...c.meetings.map((m) => ({ at: m.date, ty: "Call", who: c.coach, text: `${m.minutes ? m.minutes + " min. " : ""}${m.notes}`.trim(), client: false })),
    ...c.notes.map((n) => ({ at: n.at, ty: "Note", who: n.by, text: n.text, client: false })),
    ...c.checkins.map((k) => ({ at: k.submittedAt, ty: "Check in", who: c.name, text: `${k.score} out of 100. ${k.text}`.trim(), client: true })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);

  return (
    <>
      <Link href="/coaching-v2/clients" className="h2-crumb">‹ Clients</Link>
      <div className="h2-cph">
        <div className="id">
          <div className="h2-av">{initials(c.name)}</div>
          <div>
            <h1>{c.name}<StatusChip lvl={c.health} /></h1>
            <div className="meta">
              Coach <b>{c.coach || "–"}</b>
              <span className="sep">·</span>{c.program || "No program set"}
              <span className="sep">·</span>{c.stage}
              <span className="sep">·</span>{c.days === null ? "no end date" : c.days < 0 ? `ended ${-c.days} days ago` : `${c.days} days left`}
            </div>
          </div>
        </div>
        <ClientActions clientId={c.id} clientName={c.name} coach={c.coach} primary={primaryFor(c)} extendAllowed={!!c.endDate} />
      </div>

      <div className="h2-cp">
        <div>
          <div className="h2-blk">
            {goal && (
              <>
                <p className="h2-goal">{goal}</p>
                {pct !== null && (
                  <div className="h2-prog"><span>Week {c.week}</span><div className="bar"><i style={{ width: `${pct}%` }} /></div><span>of {c.weeks}{c.endDate ? ` · ends ${fmtDay(c.endDate)}` : ""}</span></div>
                )}
              </>
            )}
            <div className="h2-flags">
              {bad.length ? bad.map((s) => <div key={s.label} className={`f ${s.lvl}`}>{flag(s, c)}</div>) : <div className="ok">Nothing is flagged.</div>}
            </div>
          </div>

          <div className="h2-blk">
            <div className="h2-h">Latest check in</div>
            {ci ? (
              <div className="h2-ci">
                <div className="top">
                  <b>{ci.score}</b><span>out of 100</span><span>· {fmtDay(ci.submittedAt)}, {ci.daysAgo} day{ci.daysAgo === 1 ? "" : "s"} ago</span>
                  <span className="subs"><span>Coaching {ci.q1}</span><span>Strength {ci.q2}</span><span>Lifestyle {ci.q3}</span><span>Progress {ci.q4}</span></span>
                </div>
                {ci.text ? <p className="q">“{ci.text}”</p> : <p className="q h2-m" style={{ fontSize: 13 }}>No written answer.</p>}
                {c.convoId ? (
                  c.coachRepliedAfterCheckin ? <div className="ft">{c.coach} messaged in Everfit after this check in.</div> : <div className="ft r">No message from {c.coach} in Everfit since this check in.</div>
                ) : <div className="ft">No Everfit conversation matched yet, so follow through cannot be checked.</div>}
              </div>
            ) : <p className="h2-quiet">No check ins yet.</p>}
          </div>

          <div className="h2-blk">
            <div className="h2-h">Conversation</div>
            {recent.length ? (
              <div className="h2-conv">
                {recent.map((m, i) => (
                  <div key={i} className={`h2-m ${m.sender}`}>
                    <span className="w">{fmtDay(m.at)}</span>
                    <span className="t">{m.text}<span className="who">{m.sender === "client" ? c.name : c.coach}</span></span>
                  </div>
                ))}
                <div className="more">
                  {c.owedDays ? <span className="h2-r">Client has waited {c.owedDays} day{c.owedDays === 1 ? "" : "s"} for a reply.</span> : <span>Last message {c.messages[0].daysAgo} days ago.</span>}
                  <a className="h2-lk" href="https://app.everfit.io/" target="_blank" rel="noreferrer">Open in Everfit</a>
                  <a className="h2-lk" href="#history">All messages</a>
                </div>
              </div>
            ) : <p className="h2-quiet">No Everfit conversation matched to this name yet. The inbox capture matches by exact name.</p>}
          </div>

          {showRenewal && (
            <div className="h2-blk">
              <div className="h2-h">Renewal</div>
              <div className="h2-ret">
                <span className="kk">Program ends</span>
                <span className={`v ${c.days! < 0 ? "h2-r" : c.days! <= 14 ? "h2-a" : ""}`}>{c.days! < 0 ? `Ended ${-c.days!} days ago${c.asks[2].done ? ", extended" : ", no decision recorded"}` : `In ${c.days} days, ${fmtDay(c.endDate)}`}</span>
                {c.retained && (<><span className="kk">Detected</span><span className="v">{c.retained.detail}</span></>)}
                <span className="kk">Client said</span>
                <span className="v">{c.messages.find((m) => m.sender === "client")?.text ?? <span className="h2-m">Nothing captured</span>}</span>
                <RenewalPanel clientName={c.name} milestoneId={c.milestoneId} asked={c.asks[2].asked} done={c.asks[2].done} nextStep={c.retention.nextStep} note={c.retention.note} canMark />
              </div>
            </div>
          )}

          <details className="h2-dd" id="history">
            <summary><span className="ch">▸</span>History<span className="r">messages, calls, notes, check ins</span></summary>
            <div className="in h2-feed">
              {history.length ? history.map((e, i) => (
                <div key={i} className={`ev ${e.client ? "client" : ""}`}>
                  <span className="w">{fmtDay(e.at)}</span>
                  <span className="ty">{e.ty}</span>
                  <span className="b">{e.text}<span className="who h2-m" style={{ marginLeft: 6, fontSize: 12 }}>{e.who}</span></span>
                </div>
              )) : <p className="h2-quiet">Nothing on record yet.</p>}
            </div>
          </details>
        </div>

        <div className="h2-facts">
          <div>
            <div className="h2-h">Program</div>
            <div className="h2-fact">
              <span className="kk">Start</span><span className="v">{fmtDayYear(c.startDate)}</span>
              <span className="kk">End</span><span className={`v ${c.days !== null && c.days < 0 ? "h2-r" : c.days !== null && c.days <= 14 ? "h2-a" : ""}`}>{fmtDayYear(c.endDate)}</span>
              <span className="kk">Days left</span><span className={`v ${c.days !== null && c.days < 0 ? "h2-r" : ""}`}>{c.days === null ? "–" : c.days < 0 ? `Ended ${-c.days} days ago` : c.days}</span>
              <span className="kk">Stage</span><span className="v">{c.stage}</span>
              <span className="kk">Coach call</span><span className={`v ${(c.lastMeetDays ?? 0) > 14 ? "h2-a" : ""}`}>{c.lastMeetDays === null ? "none logged" : `${c.lastMeetDays} days ago`}</span>
            </div>
          </div>
          <div>
            <div className="h2-h">Check ins</div>
            {scores.length ? <div className="h2-sc">{scores.map((k, i) => <i key={k.id} className={i === scores.length - 1 ? "last" : ""} style={{ height: Math.max(3, Math.round((k.score / 100) * 36)) }} title={String(k.score)} />)}</div> : null}
            <div className="h2-fact">
              <span className="kk">Last</span><span className={`v ${ci && ci.score < 60 ? "h2-r" : ci && ci.score < 75 ? "h2-a" : ""}`}>{ci ? `${ci.score} out of 100, ${ci.daysAgo} days ago` : "None yet"}</span>
              <span className="kk">Trend</span><span className="v">{scores.length >= 2 ? (scores[scores.length - 1].score < scores[0].score ? `Down ${scores[0].score - scores[scores.length - 1].score} over ${scores.length}` : scores[scores.length - 1].score > scores[0].score ? `Up ${scores[scores.length - 1].score - scores[0].score} over ${scores.length}` : "Flat") : "–"}</span>
            </div>
          </div>
          <div>
            <div className="h2-h">Asks</div>
            <div className="h2-fact">
              {c.asks.map((a) => (
                <span key={a.key} style={{ display: "contents" }}>
                  <span className="kk">{a.label.replace(" testimonial", "")}</span>
                  <span className={`v ${a.done ? "m" : a.asked ? "" : a.dueDays !== null && a.dueDays < 0 ? "h2-r" : ""}`}>
                    {a.done ? `Done${a.doneDate ? " " + a.doneDate : ""}` : a.asked ? `Asked${a.askedDate ? " " + a.askedDate : ""}` : a.dueDate ? `${a.dueDays !== null && a.dueDays < 0 ? "Was due" : "Due"} ${fmtDay(a.dueDate)}` : "No date"}
                  </span>
                </span>
              ))}
            </div>
          </div>
          <div id="nutrition">
            <div className="h2-h">Nutrition</div>
            <div className="h2-fact">
              <span className="kk">Plan</span>
              <span className={`v ${c.nutritionWaitDays !== null && c.nutritionWaitDays >= 7 ? "h2-r" : c.nutritionWaitDays !== null && c.nutritionWaitDays >= 4 ? "h2-a" : ""}`}>
                {c.nutritionStatus === "done" ? "Delivered" : c.nutritionWaitDays !== null ? `Waiting ${c.nutritionWaitDays} days` : c.nutritionStatus || "No form linked"}
                {c.nutritionWaitDays !== null && <Link className="h2-lk" href="/coaching">Open queue</Link>}
              </span>
              {c.goal?.goalLb !== null && c.goal?.goalLb !== undefined && (<><span className="kk">Goal weight</span><span className="v">{Math.round(c.goal.goalLb)} lb{c.goal.startLb ? ` from ${Math.round(c.goal.startLb)}` : ""}</span></>)}
            </div>
          </div>
          <div>
            <div className="h2-h">Payment</div>
            <div className="h2-fact">
              <span className="kk">Paid</span><span className="v">{money(c.paid)}{c.platform ? ` · ${c.platform}` : ""}</span>
              <span className="kk">Closer</span><span className="v">{c.closer || "–"}</span>
              <span className="kk">Onboarded</span><span className="v">{c.onboardingDate ? fmtDayYear(c.onboardingDate) : c.onboardingStatus ?? "–"}</span>
              <span className="kk">Recordings</span>
              <span className="v">
                {c.salesLink ? <a className="h2-lk" style={{ marginLeft: 0 }} href={c.salesLink} target="_blank" rel="noreferrer">Sales</a> : <span className="m">Sales</span>}
                {" · "}
                {c.onboardingLink ? <a className="h2-lk" style={{ marginLeft: 0 }} href={c.onboardingLink} target="_blank" rel="noreferrer">Onboarding</a> : <span className="m">Onboarding</span>}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
