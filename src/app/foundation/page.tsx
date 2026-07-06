// The one small window into the data foundation. Live server component: reads only
// the foundation tables, shows the structure, live counts, per-source freshness, real
// linkage coverage, and real stitched people so the whole thing can be trusted.

import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOLD = "#c9a96e";
const INK = "#09090b";
const PANEL = "#0f0f12";
const LINE = "#26262b";
const DIM = "#8a8a94";
const TEXT = "#e7e7ea";
const GOOD = "#6fce8f";
const WARN = "#e0794d";

type Wm = { source: string; cursor_value: string | null; last_run_at: string | null; rows_last_run: number | null };

const EVENT_TYPES = ["dm_in", "dm_out", "keyword_hit", "call_booked", "call_taken", "sale", "fathom_call"] as const;

async function headCount(
  sb: ReturnType<typeof getServiceSupabase>,
  table: string,
  eq?: [string, string | boolean],
): Promise<number> {
  let q = sb.from(table).select("*", { count: "exact", head: true });
  if (eq) q = q.eq(eq[0], eq[1]);
  const { count } = await q;
  return count ?? 0;
}

function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export default async function FoundationPage() {
  const sb = getServiceSupabase();

  const [aeTotal, personTotal, bookedP, takenP, { data: wmData }, byType, saleRows, closedPersons, { data: samples }] =
    await Promise.all([
      headCount(sb, "activity_events"),
      headCount(sb, "person_context"),
      headCount(sb, "person_context", ["booked", true]),
      headCount(sb, "person_context", ["taken", true]),
      sb.from("feed_watermarks").select("*").order("source"),
      Promise.all(EVENT_TYPES.map((t) => headCount(sb, "activity_events", ["event_type", t]))),
      sb.from("activity_events").select("amount_cents").eq("event_type", "sale"),
      sb.from("person_context").select("amount_cents, linked_via").eq("closed", true),
      sb
        .from("person_context")
        .select("person_key, client_key, first_keyword, story, linked_via, subscriber_ids, contact_ids")
        .eq("closed", true)
        .order("amount_cents", { ascending: false })
        .limit(4),
    ]);

  const typeCounts = Object.fromEntries(EVENT_TYPES.map((t, i) => [t, byType[i]]));
  const wms = (wmData ?? []) as Wm[];

  // real totals from the STREAM (the money truth), and how much of it links to a person
  const realCloses = (saleRows.data ?? []).length;
  const realCash = (saleRows.data ?? []).reduce((s, r) => s + (Number(r.amount_cents) || 0), 0);
  const closedList = closedPersons.data ?? [];
  const linkedCloses = closedList.length;
  const linkedCash = closedList.reduce((s, r) => s + (Number(r.amount_cents) || 0), 0);
  const cashCoverage = realCash > 0 ? Math.round((linkedCash / realCash) * 100) : 0;
  const via = { subscriber: 0, contact: 0, name: 0 } as Record<string, number>;
  for (const r of closedList) via[String(r.linked_via)] = (via[String(r.linked_via)] ?? 0) + 1;

  const now = Date.now();
  const fresh = (w: Wm) => (w.last_run_at ? Math.round((now - new Date(w.last_run_at).getTime()) / 60_000) : null);

  const wrap: React.CSSProperties = {
    background: INK, color: TEXT, minHeight: "100vh",
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    padding: "40px 28px 80px", lineHeight: 1.5,
  };
  const shell: React.CSSProperties = { maxWidth: 1040, margin: "0 auto" };
  const panel: React.CSSProperties = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 22 };
  const h2: React.CSSProperties = { fontSize: 13, letterSpacing: 1.4, textTransform: "uppercase", color: GOLD, margin: "0 0 14px", fontWeight: 700 };
  const mono: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 };

  const storeCols = {
    activity_events: ["client_key", "event_type", "subscriber_id", "contact_id", "display_name", "keyword_normalized", "occurred_at", "amount_cents", "actor", "summary", "source", "source_id", "payload"],
    person_context: ["person_key (PK)", "client_key", "display_name", "subscriber_ids[]", "contact_ids[]", "first_keyword", "dm_in/out_count", "qualified", "booking_readiness", "booked", "taken", "closed", "amount_cents", "setter/closer", "linked_via", "story"],
  };

  return (
    <div style={wrap}>
      <div style={shell}>
        <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: 2, color: DIM, textTransform: "uppercase" }}>CCOS</div>
        <h1 style={{ fontSize: 30, margin: "0 0 8px", fontWeight: 800 }}>Data Foundation</h1>
        <p style={{ color: DIM, maxWidth: 720, margin: "0 0 26px" }}>
          One stitched context layer under everything. Every DM, keyword hit, booking, call, and sale from six
          scattered tables becomes one append-only stream, plus one row per person that unifies their ManyChat and
          GHL identities into the whole story. It only ever adds new rows, and it never re-derives revenue.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
          <Stat label="Events stitched" value={aeTotal.toLocaleString()} />
          <Stat label="People" value={personTotal.toLocaleString()} />
          <Stat label="Closes" value={realCloses.toLocaleString()} sub={`${linkedCloses} tied to a person`} />
          <Stat label="Cash tracked" value={money(realCash)} sub={`${cashCoverage}% linked to a person`} />
        </div>

        {/* linkage coverage */}
        <div style={{ ...panel, marginBottom: 22 }}>
          <h2 style={h2}>Linkage coverage — how much attaches to a real person</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, ...mono }}>
            <Cover label="Closed cash on a person" val={`${money(linkedCash)} / ${money(realCash)}`} pct={cashCoverage} />
            <Cover label="Closes on a person" val={`${linkedCloses} / ${realCloses}`} pct={realCloses ? Math.round((linkedCloses / realCloses) * 100) : 0} />
            <div>
              <div style={{ color: DIM, marginBottom: 6 }}>People booked / taken</div>
              <div style={{ fontSize: 15, color: TEXT }}>{bookedP.toLocaleString()} booked · {takenP.toLocaleString()} taken</div>
            </div>
          </div>
          <div style={{ ...mono, color: DIM, marginTop: 14 }}>
            closes linked by: <b style={{ color: GOLD }}>{via.subscriber ?? 0}</b> ManyChat id ·
            {" "}<b style={{ color: GOLD }}>{via.contact ?? 0}</b> GHL contact ·
            {" "}<b style={{ color: GOLD }}>{via.name ?? 0}</b> exact name
          </div>
        </div>

        {/* identity graph */}
        <div style={{ ...panel, marginBottom: 22, overflowX: "auto" }}>
          <h2 style={h2}>How one person stitches together</h2>
          <IdentityGraph />
          <p style={{ ...mono, color: DIM, marginTop: 14, marginBottom: 0 }}>
            person = ManyChat subscriber ∪ GHL contact, merged by shared id or exact unique name
          </p>
        </div>

        {/* stores */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 22 }}>
          {(["activity_events", "person_context"] as const).map((name) => (
            <div key={name} style={panel}>
              <h2 style={h2}>{name}</h2>
              <div style={{ fontSize: 12.5, color: DIM, marginBottom: 12 }}>
                {name === "activity_events" ? `append-only stream · ${aeTotal.toLocaleString()} rows` : `one row per person · ${personTotal.toLocaleString()} rows`}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {storeCols[name].map((c) => (
                  <span key={c} style={{ ...mono, background: "#17171b", border: `1px solid ${LINE}`, borderRadius: 6, padding: "3px 8px", color: TEXT }}>{c}</span>
                ))}
              </div>
              {name === "activity_events" && (
                <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {EVENT_TYPES.map((t) => (
                    <span key={t} style={{ ...mono, color: DIM }}>{t} <b style={{ color: GOLD }}>{(typeCounts[t] ?? 0).toLocaleString()}</b></span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* freshness */}
        <div style={{ ...panel, marginBottom: 22 }}>
          <h2 style={h2}>Source freshness</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...mono, borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
              <thead>
                <tr style={{ color: DIM, textAlign: "left" }}>
                  <th style={{ padding: "6px 10px" }}>source</th><th style={{ padding: "6px 10px" }}>up to</th>
                  <th style={{ padding: "6px 10px" }}>last run</th><th style={{ padding: "6px 10px" }}>rows</th>
                </tr>
              </thead>
              <tbody>
                {wms.map((w) => {
                  const mins = fresh(w);
                  const stale = mins == null || mins > 180;
                  return (
                    <tr key={w.source} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td style={{ padding: "6px 10px", color: TEXT }}>{w.source}</td>
                      <td style={{ padding: "6px 10px", color: DIM }}>{fmt(w.cursor_value)}</td>
                      <td style={{ padding: "6px 10px", color: stale ? WARN : GOOD }}>{mins == null ? "never" : `${mins}m ago`}</td>
                      <td style={{ padding: "6px 10px", color: DIM }}>{w.rows_last_run ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* sample people */}
        <div style={panel}>
          <h2 style={h2}>Real stitched people</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {(samples ?? []).map((s) => (
              <div key={String(s.person_key)} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ ...mono, color: GOLD }}>{String(s.client_key)}</span>
                  {s.first_keyword && <span style={{ ...mono, color: DIM }}>· ad &lsquo;{String(s.first_keyword)}&rsquo;</span>}
                  <span style={{ ...mono, color: DIM }}>· linked via {String(s.linked_via)}</span>
                  <span style={{ ...mono, color: DIM }}>· {((s.subscriber_ids as string[]) ?? []).length} ManyChat + {((s.contact_ids as string[]) ?? []).length} GHL id</span>
                </div>
                <div style={{ fontSize: 14 }}>{String(s.story)}</div>
              </div>
            ))}
          </div>
        </div>

        <p style={{ ...mono, color: DIM, marginTop: 24 }}>
          read it: /api/foundation/context?stream=1 · ?subscriber_id=… · ?person=sub:… · ?ad=…&amp;client=… · ?freshness=1
          <br />money math (spend, ROAS, ad-level revenue) always comes from the canonical Ads attribution, never from here.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: TEXT }}>{value}</div>
      <div style={{ fontSize: 11.5, letterSpacing: 0.6, textTransform: "uppercase", color: DIM, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11.5, color: GOLD, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Cover({ label, val, pct }: { label: string; val: string; pct: number }) {
  return (
    <div>
      <div style={{ color: DIM, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 15, color: TEXT }}>{val}</div>
      <div style={{ height: 6, background: "#1c1c20", borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: GOLD }} />
      </div>
      <div style={{ color: GOLD, marginTop: 4 }}>{pct}%</div>
    </div>
  );
}

function IdentityGraph() {
  const nodes = [
    { x: 20, label: "DM in", sub: "subscriber_id" },
    { x: 175, label: "keyword_hit", sub: "= the ad" },
    { x: 330, label: "call_booked", sub: "ghl contact" },
    { x: 485, label: "call_taken", sub: "sales row" },
    { x: 640, label: "sale", sub: "collected $" },
    { x: 795, label: "fathom_call", sub: "transcript" },
  ];
  return (
    <svg viewBox="0 0 950 90" width="100%" height="90" role="img" aria-label="identity graph">
      {nodes.slice(0, -1).map((n, i) => (
        <line key={i} x1={n.x + 118} y1={40} x2={nodes[i + 1].x} y2={40} stroke={LINE} strokeWidth={2} />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          <rect x={n.x} y={20} width={118} height={40} rx={8} fill="#17171b" stroke={i === 1 ? GOLD : LINE} strokeWidth={i === 1 ? 1.5 : 1} />
          <text x={n.x + 59} y={38} textAnchor="middle" fill={TEXT} fontSize={12.5} fontFamily="ui-monospace, monospace" fontWeight={600}>{n.label}</text>
          <text x={n.x + 59} y={52} textAnchor="middle" fill={DIM} fontSize={9.5} fontFamily="ui-monospace, monospace">{n.sub}</text>
        </g>
      ))}
    </svg>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}
