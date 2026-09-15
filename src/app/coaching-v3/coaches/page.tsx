import { loadHubV3 } from "@/lib/coaching-v3/hub";
import { coachRowsV3 } from "@/lib/coaching-v3/coaches";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

function pctColor(pct: number | null): string {
  if (pct == null) return "var(--text-muted)";
  if (pct >= 60) return "var(--success)";
  if (pct >= 40) return "var(--warning)";
  return "var(--danger)";
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((today - d) / 86_400_000));
}

export default async function CoachesPage() {
  const hub = await loadHubV3();
  if (!hub) redirect("/api/auth/signin");
  const rows = await coachRowsV3(hub);

  return (
    <>
      <div className="h3-kpis">
        <div className="h3-kpi">
          <div className="l">Team retention this month</div>
          <div className={`v ${hub.monthRetention.retentionCount > 0 ? "g" : ""}`}>
            {hub.monthRetention.retentionCount === 0
              ? "0"
              : `$${Math.round(hub.monthRetention.retentionRevenue).toLocaleString("en-US")}`}
          </div>
          <div className="d">
            {hub.monthRetention.retentionCount} retention
            {hub.monthRetention.retentionCount === 1 ? "" : "s"} (Sales Tracker)
          </div>
        </div>
        <div className="h3-kpi">
          <div className="l">Coaches</div>
          <div className="v">{rows.length}</div>
          <div className="d">Active with clients on roster</div>
        </div>
        <div className="h3-kpi">
          <div className="l">At-risk clients</div>
          <div className="v r">{rows.reduce((s, r) => s + r.atRisk, 0)}</div>
          <div className="d">Check-in &lt; 60 or workout % &lt; 40</div>
        </div>
        <div className="h3-kpi">
          <div className="l">Past-end clients</div>
          <div className="v a">{rows.reduce((s, r) => s + r.pastEnd, 0)}</div>
          <div className="d">Program end date has passed</div>
        </div>
      </div>

      <div className="h3-list" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <Th>Coach</Th>
              <Th>Clients</Th>
              <Th>At risk</Th>
              <Th>Month retention</Th>
              <Th>Past end</Th>
              <Th>Last EOD</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const atRiskPct = r.clients > 0 ? Math.round((r.atRisk / r.clients) * 100) : 0;
              const eodAge = daysAgo(r.lastEodDate);
              return (
                <tr key={r.coach} style={{ borderTop: "1px solid var(--border-primary)" }}>
                  <Td>
                    <Link
                      href={`/coaching-v3/coaches/${encodeURIComponent(r.coach)}`}
                      style={{ fontWeight: 600, color: "var(--text-primary)" }}
                    >
                      {r.coach}
                    </Link>
                  </Td>
                  <Td>{r.clients}</Td>
                  <Td>
                    <span style={{ color: r.atRisk > 0 ? "var(--danger)" : "inherit" }}>
                      {r.atRisk} <span style={{ color: "var(--text-muted)" }}>({atRiskPct}%)</span>
                    </span>
                  </Td>
                  <Td>
                    <b style={{ color: r.monthRetentionRevenue > 0 ? "var(--success)" : "var(--text-muted)" }}>
                      ${Math.round(r.monthRetentionRevenue).toLocaleString("en-US")}
                    </b>
                    <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 11 }}>
                      {r.monthRetentionCount} ret · {r.monthRefundCount} ref
                    </span>
                  </Td>
                  <Td>
                    <span style={{ color: r.pastEnd > 0 ? "var(--danger)" : "inherit" }}>
                      {r.pastEnd}
                    </span>
                  </Td>
                  <Td>
                    {eodAge == null ? (
                      <span style={{ color: "var(--text-muted)" }}>never</span>
                    ) : (
                      <span
                        style={{
                          color: eodAge >= 3 ? "var(--danger)" : eodAge >= 1 ? "var(--warning)" : "inherit",
                        }}
                      >
                        {eodAge}d ago
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="h3-empty">
                  No coaches with active clients on roster.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "10px 14px",
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: 0.05,
        textTransform: "uppercase",
      }}
    >
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "10px 14px", fontVariantNumeric: "tabular-nums" }}>{children}</td>;
}
