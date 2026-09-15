import { loadHubV3, type HubClientV3, type TodayBucket } from "@/lib/coaching-v3/hub";
import SyncBar from "./components/SyncBar";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const BUCKET_TITLE: Record<TodayBucket, string> = {
  past_end: "Past end date, no decision",
  retention_ask: "Retention window, not asked",
  reply_owed: "Owed a reply ≥ 2 days",
  checkin_needs_reply: "Low check-in not answered",
  ghost: "Ghost, still active",
};

const BUCKET_ORDER: TodayBucket[] = [
  "past_end",
  "retention_ask",
  "reply_owed",
  "checkin_needs_reply",
  "ghost",
];

function healthDot(c: HubClientV3): "r" | "a" | "g" | "u" {
  if (c.score.bucket === "unknown") return "u";
  if (c.score.bucket === "at_risk") return "r";
  if (c.score.bucket === "coin_flip") return "a";
  return "g";
}

function workoutsCell(c: HubClientV3): string {
  const done = c.everfit?.workoutsCompleted7d;
  const assigned = c.everfit?.workoutsAssigned7d;
  if (assigned == null || assigned === 0) return "—";
  return `${done ?? 0}/${assigned}`;
}

export default async function TodayPage() {
  const hub = await loadHubV3();
  if (!hub) redirect("/api/auth/signin");

  const grouped = new Map<TodayBucket, HubClientV3[]>();
  for (const c of hub.clients) {
    for (const b of c.todayBuckets) {
      const arr = grouped.get(b) ?? [];
      arr.push(c);
      grouped.set(b, arr);
    }
  }
  for (const arr of grouped.values()) {
    arr.sort(
      (a, b) =>
        (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999) ||
        (a.score.score - b.score.score),
    );
  }

  const totalToday = new Set(hub.clients.flatMap((c) => (c.todayBuckets.length ? [c.id] : []))).size;

  return (
    <>
      <SyncBar latest={hub.latestSync} />

      <div className="h3-kpis">
        <div className="h3-kpi">
          <div className="l">Need attention today</div>
          <div className={`v ${totalToday > 0 ? "r" : "g"}`}>{totalToday}</div>
          <div className="d">Unique clients across all buckets</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Active roster</div>
          <div className="v">{hub.clients.length}</div>
          <div className="d">Every active client (this view)</div>
        </div>
        <div className="h3-kpi">
          <div className="l">This month retention</div>
          <div className={`v ${hub.monthRetention.pct == null ? "" : hub.monthRetention.pct >= 60 ? "g" : hub.monthRetention.pct >= 40 ? "a" : "r"}`}>
            {hub.monthRetention.pct == null ? "—" : `${hub.monthRetention.pct}%`}
          </div>
          <div className="d">
            {hub.monthRetention.retained} retained · {hub.monthRetention.lost} lost
          </div>
        </div>
        <div className="h3-kpi">
          <div className="l">V3 sync freshness</div>
          <div className={`v ${!hub.latestSync ? "r" : hub.latestSync.isStale ? "a" : "g"}`}>
            {!hub.latestSync ? "None" : hub.latestSync.isStale ? "Stale" : "Fresh"}
          </div>
          <div className="d">{hub.latestSync ? `${hub.latestSync.matchedCount}/${hub.latestSync.clientsCount} matched` : "Upload a JSON to start"}</div>
        </div>
      </div>

      {BUCKET_ORDER.map((b) => {
        const rows = grouped.get(b) ?? [];
        if (rows.length === 0) return null;
        return (
          <section key={b} className="h3-sec">
            <h2>
              <span className="n">{rows.length}</span>
              {BUCKET_TITLE[b]}
            </h2>
            <div className="h3-list">
              {rows.map((c) => (
                <div className="h3-li" key={`${b}-${c.id}`}>
                  <span className={`dot ${healthDot(c)}`} />
                  <div className="main">
                    <div className="row1">
                      <span className="name">{c.name}</span>
                      <span className="coach">{c.coach}</span>
                      {c.everfit?.isStale && (
                        <span className="bucket a" title="V3 sync data is stale">stale</span>
                      )}
                    </div>
                    <div className="row2">
                      {c.daysRemaining != null && (
                        <span className={c.daysRemaining < 0 ? "r" : c.daysRemaining <= 14 ? "a" : ""}>
                          {c.daysRemaining >= 0 ? `${c.daysRemaining}d left` : `${-c.daysRemaining}d past end`}
                        </span>
                      )}
                      <span>Workouts {workoutsCell(c)}</span>
                      {c.everfit?.lastClientMessageAt && (
                        <span>
                          Client last msg{" "}
                          {c.everfit.lastClientMessageAt
                            ? Math.max(
                                0,
                                Math.floor(
                                  (Date.now() - Date.parse(c.everfit.lastClientMessageAt)) /
                                    86_400_000,
                                ),
                              )
                            : "?"}
                          d ago
                        </span>
                      )}
                      {c.latestCheckInScore != null && (
                        <span className={c.latestCheckInScore < 60 ? "r" : c.latestCheckInScore < 75 ? "a" : ""}>
                          Check-in {c.latestCheckInScore}/100
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="aside">
                    <div className={`pct ${healthDot(c)}`}>
                      {c.score.bucket === "unknown" ? "—" : `${c.score.score}`}
                    </div>
                    <div className="lbl">retain</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {totalToday === 0 && (
        <div className="h3-list">
          <div className="h3-empty">Nothing needs a human today. Nice.</div>
        </div>
      )}
    </>
  );
}
