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

  const atRisk = mine.filter((c) => c.score.bucket === "at_risk");
  const retentionWindow = mine.filter((c) => c.retentionCycleOpen);
  const repliesOwed = mine.filter((c) => {
    if (!c.everfit?.lastClientMessageAt) return false;
    const days = Math.floor(
      (Date.now() - Date.parse(c.everfit.lastClientMessageAt)) / 86_400_000,
    );
    if (days < 2) return false;
    return c.lastCoachMessageDaysAgo === null || c.lastCoachMessageDaysAgo >= days;
  });

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
          <div className="d">Score under 40</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Retention window</div>
          <div className="v a">{retentionWindow.length}</div>
          <div className="d">Open retention cycle</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Replies owed</div>
          <div className="v a">{repliesOwed.length}</div>
          <div className="d">Client waiting ≥ 2d</div>
        </div>
      </div>

      {atRisk.length > 0 && (
        <Section title={`At-risk clients (${atRisk.length})`}>
          {atRisk.map((c) => (
            <ClientLine key={c.id} c={c} lead={`${c.score.score}% · ${c.score.reasons[0] ?? ""}`} />
          ))}
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

      {repliesOwed.length > 0 && (
        <Section title={`Owed a reply (${repliesOwed.length})`}>
          {repliesOwed.map((c) => {
            const days = c.everfit?.lastClientMessageAt
              ? Math.floor(
                  (Date.now() - Date.parse(c.everfit.lastClientMessageAt)) / 86_400_000,
                )
              : null;
            return (
              <ClientLine
                key={c.id}
                c={c}
                lead={days != null ? `waiting ${days}d` : "waiting"}
              />
            );
          })}
        </Section>
      )}

      {atRisk.length === 0 && retentionWindow.length === 0 && repliesOwed.length === 0 && (
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
  c: { name: string; program: string; latestCheckInScore: number | null; score: { bucket: string; score: number } };
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
          {c.latestCheckInScore != null && (
            <span className={c.latestCheckInScore < 60 ? "r" : c.latestCheckInScore < 75 ? "a" : ""}>
              Check-in {c.latestCheckInScore}/100
            </span>
          )}
        </div>
      </div>
      <div className="aside">
        <div className={`pct ${cls}`}>{c.score.bucket === "unknown" ? "—" : c.score.score}</div>
        <div className="lbl">retain</div>
      </div>
    </div>
  );
}
