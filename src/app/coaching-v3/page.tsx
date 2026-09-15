import { loadHubV3, type HubClientV3, type TodayBucket } from "@/lib/coaching-v3/hub";
import SyncBar from "./components/SyncBar";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const BUCKET_TITLE: Record<TodayBucket, string> = {
  past_end: "Past end date, no decision",
  retention_ask: "Retention window, not asked",
  zero_workouts: "Zero workouts last week",
  concerning_note: "Assistant flagged concern in latest note",
  silent_2wk: "Silent for two weeks straight",
};

const BUCKET_ORDER: TodayBucket[] = [
  "past_end",
  "retention_ask",
  "concerning_note",
  "zero_workouts",
  "silent_2wk",
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
  // Sheet-fed rows store workout completion as pct out of 100. Show as "80%"
  // instead of "80/100" to match how MAS's assistant reports it.
  if (assigned === 100) return `${done ?? 0}%`;
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
      <SyncBar latest={hub.latestSheetSync} />

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
          <div className={`v ${hub.monthRetention.retentionCount > 0 ? "g" : ""}`}>
            {hub.monthRetention.retentionCount === 0
              ? "0"
              : `$${Math.round(hub.monthRetention.retentionRevenue).toLocaleString("en-US")}`}
          </div>
          <div className="d">
            {hub.monthRetention.retentionCount} retention
            {hub.monthRetention.retentionCount === 1 ? "" : "s"} · ${" "}
            {Math.round(hub.monthRetention.refundAmount).toLocaleString("en-US")} refunded
          </div>
        </div>
        <div className="h3-kpi">
          <div className="l">Sheet sync freshness</div>
          <div className={`v ${!hub.latestSheetSync ? "r" : hub.latestSheetSync.isStale ? "a" : "g"}`}>
            {!hub.latestSheetSync ? "None" : hub.latestSheetSync.isStale ? "Stale" : "Fresh"}
          </div>
          <div className="d">
            {hub.latestSheetSync
              ? `${hub.latestSheetSync.clientsSeen} clients from ${hub.latestSheetSync.tabsRead.length} coaches`
              : "Pull from sheet to start"}
          </div>
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
                      {c.latestCheckInScore != null && (
                        <span className={c.latestCheckInScore < 60 ? "r" : c.latestCheckInScore < 75 ? "a" : ""}>
                          Check-in {c.latestCheckInScore}/100
                        </span>
                      )}
                    </div>
                    {c.weeklyReports[0]?.note && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11.5,
                          color: "var(--text-muted)",
                          fontStyle: "italic",
                          maxWidth: 720,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={c.weeklyReports[0].note}
                      >
                        {c.weeklyReports[0].weekLabel}: &ldquo;{c.weeklyReports[0].note}&rdquo;
                      </div>
                    )}
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
