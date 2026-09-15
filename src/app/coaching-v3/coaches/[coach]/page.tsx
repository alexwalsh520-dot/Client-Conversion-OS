import { loadHubV3 } from "@/lib/coaching-v3/hub";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export default async function CoachDetailPage({ params }: { params: Promise<{ coach: string }> }) {
  const { coach } = await params;
  const target = decodeURIComponent(coach);
  const hub = await loadHubV3();
  if (!hub) redirect("/api/auth/signin");

  const mine = hub.clients.filter((c) => norm(c.coach || "Unassigned") === norm(target));

  const atRisk = mine.filter((c) => c.isAtRiskByBehavior);
  const retentionWindow = mine.filter((c) => c.retentionCycleOpen);

  return (
    <>
      <div style={{ margin: "0 0 12px" }}>
        <Link href="/coaching-v3/coaches" style={{ color: "var(--text-muted)", fontSize: 12 }}>
          ← All coaches
        </Link>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "6px 0 2px", color: "var(--text-primary)" }}>
          {target}
        </h2>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12.5 }}>
          {mine.length} client{mine.length === 1 ? "" : "s"} · 1:1 prep
        </p>
      </div>

      <div className="h3-kpis">
        <div className="h3-kpi">
          <div className="l">At risk</div>
          <div className="v r">{atRisk.length}</div>
          <div className="d">Check-in &lt; 50 or workout % &lt; 30</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Retention window</div>
          <div className="v a">{retentionWindow.length}</div>
          <div className="d">Open retention cycle</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Past end</div>
          <div className="v a">{mine.filter((c) => c.daysRemaining !== null && c.daysRemaining < 0).length}</div>
          <div className="d">Program end date has passed</div>
        </div>
      </div>

      {atRisk.length > 0 && (
        <Section title={`At-risk clients (${atRisk.length})`}>
          {atRisk.map((c) => {
            const parts: string[] = [];
            if (c.latestCheckInScore != null) parts.push(`Check-in ${c.latestCheckInScore}/100`);
            const wk = c.weeklyReports[0];
            if (wk?.workoutPct != null) parts.push(`Workouts ${Math.round(wk.workoutPct)}%`);
            return <ClientLine key={c.id} c={c} lead={parts.join(" · ") || "no recent data"} />;
          })}
        </Section>
      )}

      {retentionWindow.length > 0 && (
        <Section title={`Retention window (${retentionWindow.length})`}>
          {retentionWindow.map((c) => (
            <ClientLine
              key={c.id}
              c={c}
              lead={
                c.daysRemaining !== null
                  ? c.daysRemaining >= 0
                    ? `${c.daysRemaining}d left`
                    : `${-c.daysRemaining}d past end`
                  : "end date unknown"
              }
            />
          ))}
        </Section>
      )}

      {atRisk.length === 0 && retentionWindow.length === 0 && (
        <div className="h3-list">
          <div className="h3-empty">No open items. This coach is caught up.</div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="h3-sec">
      <h2>{title}</h2>
      <div className="h3-list">{children}</div>
    </section>
  );
}

function ClientLine({
  c,
  lead,
}: {
  c: {
    name: string;
    program: string;
    score: { bucket: string; score: number };
  };
  lead: string;
}) {
  const cls =
    c.score.bucket === "at_risk"
      ? "r"
      : c.score.bucket === "coin_flip"
        ? "a"
        : c.score.bucket === "likely"
          ? "g"
          : "u";
  return (
    <div className="h3-li">
      <span className={`dot ${cls}`} />
      <div className="main">
        <div className="row1">
          <span className="name">{c.name}</span>
          <span className="coach">{c.program}</span>
        </div>
        <div className="row2">
          <span>{lead}</span>
        </div>
      </div>
      <div className="aside">
        <div className={`pct ${cls}`}>{c.score.bucket === "unknown" ? "—" : c.score.score}</div>
        <div className="lbl">retain</div>
      </div>
    </div>
  );
}
