"use client";

// HAMMER THEM — the operational read for the Hammer Them remarketing campaign,
// in the page's own language: one campaign-table row, two Metrics cards, one
// before/since table, one next-action line. No prose.
//
//   Row: budget, spend, impressions, CPM, reach, frequency per person over a
//        rolling 72 hours (Meta's own number), audience size.
//   Cards: frequency over the last 7 days with the 15 to 20 target band, and
//        DM-to-call 7-day rolling with a line on launch day.
//   Table: DM-to-call, show rate, close rate for the 28 days before launch next
//        to the days since, from the same metrics slice the cards use.
//   Next action: the one rule that fires, in a few words.
//
// The hammer is indirect (no DMs or calls of its own), so it never joins the
// attribution table. Hidden on share links and for Jake. Collapsible, and the
// choice sticks in localStorage.

import { useCallback, useEffect, useMemo, useState } from "react";
import { derive } from "@/lib/ads-v2/metrics";
import { shiftDay, todayEt } from "@/lib/ads-v2/time";
import type { AdsV2Account, AdsV2MetricsPayload, BaseMetrics, MetricsDay } from "@/lib/ads-v2/types";
import type { HammerPayload } from "@/lib/ads-v2/hammer";
import { fmtMD } from "./format";
import LineChart from "./LineChart";

const OPEN_KEY = "ccos.adsv2.hammer.open";
const BASELINE_DAYS = 28;

// The decision rules, in one place. Frequency is per person over 72 hours.
export const HAMMER_RULES = {
  freqMin: 15,
  freqMax: 20,
  cpmLowCents: 3000,
  cpmHighCents: 5000,
  liftRel: 0.1,
  verdictDays: 14,
  budgetStepUsd: 20,
} as const;

function pct(v: number | null): string {
  return v == null || !Number.isFinite(v) ? "-" : `${(v * 100).toFixed(1)}%`;
}
function pts(a: number | null, b: number | null): string {
  if (a == null || b == null) return "-";
  const d = (b - a) * 100;
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
}
function rel(a: number | null, b: number | null): number | null {
  if (a == null || b == null || a === 0) return null;
  return (b - a) / a;
}
function usd(cents: number | null | undefined, decimals = 0): string {
  if (cents == null || !Number.isFinite(cents)) return "-";
  const v = cents / 100;
  return decimals ? `$${v.toFixed(decimals)}` : `$${Math.round(v).toLocaleString("en-US")}`;
}
function int(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "-" : Math.round(v).toLocaleString("en-US");
}
function one(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "-" : v.toFixed(1);
}
// Meta floors any small list at 1,000 and freezes the count on a list it
// calls out of date, so "1,000 to 1,000" really means "under 1,000".
function audienceText(h: HammerPayload | null): string {
  const a = h?.audience;
  if (!a) return "-";
  if (a.lower === a.upper && a.lower <= 1000) return "<1,000";
  return `${int(a.lower)}–${int(a.upper)}`;
}
function loadOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export default function HammerSection({ account, publicToken }: { account: AdsV2Account; publicToken?: string }) {
  const [open, setOpen] = useState<boolean>(() => loadOpen());
  const [hammer, setHammer] = useState<HammerPayload | null>(null);
  const [hammerErr, setHammerErr] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<AdsV2MetricsPayload | null>(null);
  const [current, setCurrent] = useState<AdsV2MetricsPayload | null>(null);
  const [union, setUnion] = useState<AdsV2MetricsPayload | null>(null);

  const hidden = !!publicToken || account === "jake";

  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* storage blocked; fine for this session */
    }
  }, [open]);

  // The campaign read.
  useEffect(() => {
    if (hidden) return;
    let alive = true;
    fetch("/api/ads-v2/hammer", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as HammerPayload & { error?: string };
        if (!alive) return;
        if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
        setHammer(j);
        if (j.error) setHammerErr(j.error);
      })
      .catch((e) => alive && setHammerErr(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      alive = false;
    };
  }, [hidden]);

  // The funnel windows: 28 days before launch, and launch to today.
  const today = todayEt();
  const launch = hammer?.launchDay ?? null;
  const baselineTo = launch ? shiftDay(launch, -1) : shiftDay(today, -1);
  const baselineFrom = shiftDay(baselineTo, -(BASELINE_DAYS - 1));

  const fetchMetrics = useCallback(async (from: string, to: string): Promise<AdsV2MetricsPayload | null> => {
    // The baseline is a custom window the server has usually never built, so
    // the first read says "preparing" and a background build follows. That
    // build can take a while on a cold window: keep asking for up to ~2 min.
    for (let attempt = 0; attempt < 48; attempt++) {
      const res = await fetch(`/api/ads-v2/metrics?account=tyson&status=all&dateFrom=${from}&dateTo=${to}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as AdsV2MetricsPayload;
        if (!data.preparing) return data;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    return null;
  }, []);

  useEffect(() => {
    if (hidden || !hammer) return;
    let alive = true;
    fetchMetrics(baselineFrom, baselineTo).then((d) => alive && setBaseline(d));
    fetchMetrics(baselineFrom, today).then((d) => alive && setUnion(d));
    (launch ? fetchMetrics(launch, today) : Promise.resolve(null)).then((d) => alive && setCurrent(d));
    return () => {
      alive = false;
    };
  }, [hidden, hammer, launch, baselineFrom, baselineTo, today, fetchMetrics]);

  const rates = (t: BaseMetrics | null | undefined) => {
    if (!t) return { msgToCall: null, showRate: null, closeRate: null };
    const d = derive(t);
    return { msgToCall: d.msgToCall, showRate: d.showRate, closeRate: d.closeRate };
  };
  const base = rates(baseline?.total);
  const hasSince = (current?.total?.messages ?? 0) > 0;
  const now = hasSince ? rates(current?.total) : rates(null);
  const launched = hammer?.status === "live" || hammer?.status === "paused";
  const live = hammer?.status === "live";
  const daysLive = launch ? Math.max(0, Math.round((Date.parse(today) - Date.parse(launch)) / 86400000)) + 1 : 0;

  // The one rule that fires. Frequency first (it is the heartbeat), then CPM,
  // then the day-14 verdict. Otherwise "hold".
  const freq = hammer?.last72?.frequency ?? null;
  const cpm = hammer?.last72?.cpmCents ?? null;
  const budgetUsd = (hammer?.dailyBudgetCents ?? 0) / 100;
  const action = useMemo((): { text: string; why: string } => {
    if (!launched) return { text: "Not launched", why: "" };
    if (freq == null) return { text: "Hold", why: "No 72h read yet" };
    // The frequency rule needs a full 72 hours of delivery. Before day 3 the
    // number is a partial window and no budget move is justified by it.
    if (daysLive < 3) return { text: "Hold", why: `Day ${daysLive}. First full 72h read ${launch ? fmtMD(shiftDay(launch, 2)) : ""}` };
    const target = `Frequency ${one(freq)}, target ${HAMMER_RULES.freqMin}–${HAMMER_RULES.freqMax}`;
    if (freq < HAMMER_RULES.freqMin) return { text: `Raise budget $${budgetUsd} → $${budgetUsd + HAMMER_RULES.budgetStepUsd}`, why: target };
    if (freq > HAMMER_RULES.freqMax) return { text: `Lower budget $${budgetUsd} → $${Math.max(1, budgetUsd - HAMMER_RULES.budgetStepUsd)}`, why: target };
    if (cpm != null && cpm > HAMMER_RULES.cpmHighCents) return { text: "Recreate the DM list", why: `CPM ${usd(cpm, 2)}, over $${HAMMER_RULES.cpmHighCents / 100}` };
    const lifts = [rel(base.msgToCall, now.msgToCall), rel(base.showRate, now.showRate), rel(base.closeRate, now.closeRate)];
    const anyUp = lifts.some((v) => v != null && v > HAMMER_RULES.liftRel);
    if (daysLive >= HAMMER_RULES.verdictDays && !anyUp) return { text: "Look at the setter conversation", why: `Day ${daysLive}, no funnel rate up 10%` };
    return { text: "Hold", why: target };
  }, [launched, freq, cpm, budgetUsd, base, now, daysLive, launch]);

  // Charts.
  const freqDays = (hammer?.days ?? []).slice(-7);
  const unionDays: MetricsDay[] = useMemo(() => union?.days ?? [], [union]);
  const rolling = useMemo(() => {
    const labels: string[] = [];
    const dmToCall: (number | null)[] = [];
    for (let i = 0; i < unionDays.length; i++) {
      const w = unionDays.slice(Math.max(0, i - 6), i + 1);
      const msgs = w.reduce((s, d) => s + d.messages, 0);
      const booked = w.reduce((s, d) => s + d.booked, 0);
      labels.push(fmtMD(unionDays[i].day));
      dmToCall.push(msgs ? booked / msgs : null);
    }
    return { labels, dmToCall };
  }, [unionDays]);
  const launchIndex = launch ? unionDays.findIndex((d) => d.day === launch) : -1;
  const latestDmToCall = rolling.dmToCall.length ? rolling.dmToCall[rolling.dmToCall.length - 1] : null;

  if (hidden) return null;

  const liftRows: [string, number | null, number | null][] = [
    ["DM to call", base.msgToCall, now.msgToCall],
    ["Show rate", base.showRate, now.showRate],
    ["Close rate", base.closeRate, now.closeRate],
  ];

  return (
    <section className="hammer">
      <div className="metric-board-head">
        <h2 className="metric-board-title">Hammer Them</h2>
        <div className="metric-board-actions">
          <button className="metric-board-btn" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {open && (
        <>
          <div className="panel">
            <table className="ads hm-table">
              <thead>
                <tr>
                  <th className="name-th">Campaign</th>
                  <th>Daily budget</th>
                  <th>Ad spend</th>
                  <th>Impressions</th>
                  <th>CPM</th>
                  <th>Reach</th>
                  <th>Frequency 72h</th>
                  <th>Audience</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="name-td">
                    <span className="hm-name">Hammer Them</span>
                    <span className={`status-pill ${live ? "" : "finished"}`}>
                      {!hammer ? "…" : live ? "Active" : launched ? "Paused" : "Not launched"}
                    </span>
                  </td>
                  <td className="num">{launched ? usd(hammer?.dailyBudgetCents) : "-"}</td>
                  <td className="num">{launched ? usd(hammer?.last72?.spendCents) : "-"}</td>
                  <td className="num">{launched ? int(hammer?.last72?.impressions) : "-"}</td>
                  <td className="num">{launched ? usd(cpm, 2) : "-"}</td>
                  <td className="num">{launched ? int(hammer?.last72?.reach) : "-"}</td>
                  <td className="num">{launched ? one(freq) : "-"}</td>
                  <td className="num">{audienceText(hammer)}</td>
                </tr>
              </tbody>
            </table>
            {hammerErr && <div className="hm-err">{hammerErr}</div>}
          </div>

          <div className="grid-charts metric-grid hm-charts">
            <div className="chart-column">
              <div className="panel chart-card">
                <div className="chart-head">
                  <div>
                    <div className="chart-title">
                      Frequency, 72h
                      <span
                        className="info-dot"
                        title="Meta's frequency for this campaign over the last 3 ad-account days: impressions per person reached. Target 15 to 20."
                      >
                        ⓘ
                      </span>
                    </div>
                    <div className="chart-subtitle">
                      <span className="chart-big">{one(freq)}</span>
                      <span className="chart-sub-label">Impressions per person, rolling 72 hours</span>
                    </div>
                  </div>
                </div>
                <LineChart
                  idBase="hm-freq"
                  labels={freqDays.map((d) => fmtMD(d.day))}
                  series={[
                    { name: "Frequency, 72h", values: freqDays.map((d) => d.freq72), color: "var(--gold)", isPrimary: true, fmt: one },
                  ]}
                  fmt={one}
                  band={{ from: HAMMER_RULES.freqMin, to: HAMMER_RULES.freqMax, label: `TARGET ${HAMMER_RULES.freqMin} TO ${HAMMER_RULES.freqMax}` }}
                />
                <div className="chart-legend">
                  <span className="chart-legend-item">
                    <span className="chart-sw" style={{ background: "var(--gold)" }} />
                    Frequency, 72h
                  </span>
                </div>
              </div>
            </div>
            <div className="chart-column">
              <div className="panel chart-card">
                <div className="chart-head">
                  <div>
                    <div className="chart-title">
                      DM to call
                      <span
                        className="info-dot"
                        title="Booked calls divided by DMs for Tyson, all statuses, over a rolling 7 days. The dashed line is launch day."
                      >
                        ⓘ
                      </span>
                    </div>
                    <div className="chart-subtitle">
                      <span className="chart-big">{pct(latestDmToCall)}</span>
                      <span className="chart-sub-label">7 day rolling</span>
                    </div>
                  </div>
                </div>
                <LineChart
                  idBase="hm-dm"
                  labels={rolling.labels}
                  series={[{ name: "DM to call", values: rolling.dmToCall, color: "var(--gold)", isPrimary: true, fmt: pct }]}
                  fmt={(v) => `${Math.round(v * 100)}%`}
                  leftMax={1}
                  marker={launchIndex >= 0 ? { index: launchIndex, label: "LAUNCH" } : undefined}
                />
                <div className="chart-legend">
                  <span className="chart-legend-item">
                    <span className="chart-sw" style={{ background: "var(--gold)" }} />
                    DM to call
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <table className="ads hm-table">
              <thead>
                <tr>
                  <th className="name-th"></th>
                  <th>Before</th>
                  <th>Since launch</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {liftRows.map(([label, b, c]) => {
                  const r = rel(b, c);
                  const readable = launched && r != null && daysLive >= 7;
                  const cls = !readable ? "dim" : r > HAMMER_RULES.liftRel ? "pos" : r < -HAMMER_RULES.liftRel ? "neg" : "dim";
                  return (
                    <tr key={label}>
                      <td className="name-td hm-label">{label}</td>
                      <td className="num">{pct(b)}</td>
                      <td className="num">{launched ? pct(c) : "-"}</td>
                      <td className={`num ${cls}`}>{launched ? pts(b, c) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <table className="ads hm-table">
              <tbody>
                <tr>
                  <td className="name-td hm-label">Next action</td>
                  <td className="hm-action-text">{action.text}</td>
                  <td className="num dim">{action.why}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
