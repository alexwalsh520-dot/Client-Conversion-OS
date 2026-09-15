import Link from "next/link";
import { loadHub, type HubClient } from "@/lib/coaching-v2/hub";
import { Dot } from "./components/bits";

type Group = {
  title: string;
  why: string;
  test: (c: HubClient) => boolean;
  text: (c: HubClient) => string;
  num: (c: HubClient) => string;
};

const GROUPS: Group[] = [
  {
    title: "Past end date",
    why: "No decision recorded. Extend, or close and log why.",
    test: (c) => c.days !== null && c.days < 0 && !c.asks[2].done,
    text: (c) => `Ended ${-(c.days ?? 0)} days ago`,
    num: (c) => `${-(c.days ?? 0)}d`,
  },
  {
    title: "Retention due",
    why: "Ends within 14 days and the extension has not been asked.",
    test: (c) => c.days !== null && c.days >= 0 && c.days <= 14 && !c.asks[2].done && !c.asks[2].asked,
    text: (c) => `Ends in ${c.days} days`,
    num: (c) => `${c.days}d`,
  },
  {
    title: "Waiting for a reply",
    why: "The client wrote in Everfit and nobody answered.",
    test: (c) => c.owedDays !== null && c.owedDays >= 1,
    text: (c) => `Waiting ${c.owedDays} day${c.owedDays === 1 ? "" : "s"}`,
    num: (c) => `${c.owedDays}d`,
  },
  {
    title: "Check ins nobody answered",
    why: "Submitted in the last 7 days, no coach message since.",
    test: (c) => !!c.latestCheckin && c.latestCheckin.daysAgo <= 6 && c.coachRepliedAfterCheckin === false && !!c.convoId,
    text: (c) => `${c.latestCheckin?.score} · “${short(c.latestCheckin?.text ?? "", 70)}”`,
    num: (c) => `${c.latestCheckin?.daysAgo}d`,
  },
  {
    title: "Slipping",
    why: "A check in or nutrition signal turned red.",
    test: (c) => c.health === "r",
    text: (c) => (c.lead ? `${c.lead.label} · ${c.lead.value}` : ""),
    num: (c) => (c.score !== null ? String(c.score) : "–"),
  },
  {
    title: "Waiting for a plan",
    why: "Nutrition plan pending for 4 days or more.",
    test: (c) => c.nutritionWaitDays !== null && c.nutritionWaitDays >= 4,
    text: (c) => `Plan waiting ${c.nutritionWaitDays} days`,
    num: (c) => `${c.nutritionWaitDays}d`,
  },
  {
    title: "Ready to ask",
    why: "Strong check in, no video testimonial asked yet.",
    test: (c) => (c.score ?? 0) >= 80 && !c.asks[1].done && !c.asks[1].asked && c.days !== null && c.days > 14 && c.days < 60,
    text: (c) => `Check in ${c.score}, no video ask`,
    num: (c) => String(c.score ?? ""),
  },
];

function short(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ by?: string }> }) {
  const hub = await loadHub();
  if (!hub) return null;
  const { by } = await searchParams;
  const manager = !hub.viewer.coach;
  const groupByCoach = manager && by === "coach";
  const mine = hub.active;

  const seen = new Set<number>();
  const built = GROUPS.map((g) => {
    const rows = mine.filter((c) => !seen.has(c.id) && g.test(c));
    rows.forEach((c) => seen.add(c.id));
    return { ...g, rows };
  }).filter((g) => g.rows.length);

  const reds = mine.filter((c) => c.health === "r").length;
  const expired = mine.filter((c) => c.days !== null && c.days < 0 && !c.asks[2].done).length;
  const due = mine.filter((c) => c.days !== null && c.days >= 0 && c.days <= 14 && !c.asks[2].done && !c.asks[2].asked).length;
  const owed = mine.filter((c) => c.owedDays !== null && c.owedDays >= 1).length;

  const dateLine = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const captured = hub.inboxCapturedAt
    ? new Date(hub.inboxCapturedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  const row = (c: HubClient, g: Group) => (
    <Link key={c.id} href={`/coaching-v2/clients/${c.id}`} className={`h2-li ${manager ? "" : "nocoach"}`}>
      <Dot lvl={c.health} />
      <span className="who">{c.name}</span>
      {manager && <span className="co">{c.coach || "–"}</span>}
      <span className="why">{g.text(c)}</span>
      <span className="num">{g.num(c)}</span>
    </Link>
  );

  return (
    <>
      <div className="h2-head">
        <div>
          <h1>Today</h1>
          <p className="h2-sub">
            {dateLine}
            {captured ? <> · inbox captured {captured}</> : <> · no Everfit inbox capture yet</>}
            {hub.viewer.coach ? <> · <b>{hub.viewer.coach}</b></> : null}
          </p>
        </div>
        {manager && (
          <div className="h2-seg">
            <Link href="/coaching-v2" className={groupByCoach ? "" : "on"}>By reason</Link>
            <Link href="/coaching-v2?by=coach" className={groupByCoach ? "on" : ""}>By coach</Link>
          </div>
        )}
      </div>

      <div className="h2-kpis">
        <div className="h2-kpi"><div className="l">At risk</div><div className="v r">{reds}</div><div className="d">of {mine.length} clients</div></div>
        <div className="h2-kpi"><div className="l">Past end date</div><div className="v">{expired}</div><div className="d">no decision recorded</div></div>
        <div className="h2-kpi"><div className="l">Retentions due</div><div className="v">{due}</div><div className="d">ask within 14 days</div></div>
        <div className="h2-kpi"><div className="l">Waiting for a reply</div><div className="v">{owed}</div><div className="d">from the Everfit inbox</div></div>
      </div>

      {groupByCoach
        ? hub.coaches.map((coach) => {
            const rows: [HubClient, Group][] = [];
            built.forEach((g) => g.rows.filter((c) => c.coach === coach).forEach((c) => rows.push([c, g])));
            if (!rows.length) return null;
            return (
              <div className="h2-sec" key={coach}>
                <h2>
                  {coach} <span className="n">{rows.length}</span>
                  <span className="why">{rows.filter((r) => r[0].health === "r").length} at risk</span>
                </h2>
                <div className="h2-list">{rows.map(([c, g]) => row(c, g))}</div>
              </div>
            );
          })
        : built.length
          ? built.map((g) => (
              <div className="h2-sec" key={g.title}>
                <h2>
                  {g.title} <span className="n">{g.rows.length}</span>
                  <span className="why">{g.why}</span>
                </h2>
                <div className="h2-list">{g.rows.map((c) => row(c, g))}</div>
              </div>
            ))
          : <div className="h2-list"><div className="h2-empty">Nothing needs you right now.</div></div>}
    </>
  );
}
