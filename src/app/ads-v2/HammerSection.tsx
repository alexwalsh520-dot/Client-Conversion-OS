"use client";

// HAMMER THEM — three pieces with one job each, feeding one summary line.
//
//   1. Hammer card: the campaign's own inputs (spend, CPM, impressions,
//      audience) and its heartbeat, impressions per person over a rolling 72
//      hours, read straight from Meta's frequency field. Target band 15 to 20.
//   2. Funnel lift: DM-to-call, show rate, close rate for the 28 days BEFORE
//      launch next to the days SINCE launch, with the delta, and a daily chart
//      with a line on launch day. Numbers come from the same metrics slice the
//      cards use, so they always match the table.
//   3. Decision rules: four rows that turn the thresholds into a status and an
//      action, so nothing has to be interpreted.
//
// The hammer is indirect: it makes no DMs or calls itself, so it never sits in
// the campaign table. Hidden on share links and for Jake. Collapsible, and the
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
  /** Relative lift on a funnel rate that counts as "moved". */
  liftRel: 0.1,
  /** Days of running before "nothing moved" becomes a verdict. */
  verdictDays: 14,
  budgetStepUsd: 20,
} as const;

type Tone = "ok" | "warn" | "act" | "none";

interface Rates {
  msgToCall: number | null;
  showRate: number | null;
  closeRate: number | null;
}

function ratesOf(t: BaseMetrics | null): Rates {
  if (!t) return { msgToCall: null, showRate: null, closeRate: null };
  const d = derive(t);
  return { msgToCall: d.msgToCall, showRate: d.showRate, closeRate: d.closeRate };
}

function pct(v: number | null): string {
  return v == null || !Number.isFinite(v) ? "-" : `${(v * 100).toFixed(1)}%`;
}
function pts(a: number | null, b: number | null): string {
  if (a == null || b == null) return "-";
  const d = (b - a) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)} pts`;
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
function loadOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

function StatusChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`hm-chip tone-${tone}`}>{children}</span>;
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

  // 1. The campaign read.
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

  // 2. The funnel windows: 28 days before launch, and launch to today.
  const today = todayEt();
  const launch = hammer?.launchDay ?? null;
  const baselineTo = launch ? shiftDay(launch, -1) : shiftDay(today, -1);
  const baselineFrom = shiftDay(baselineTo, -(BASELINE_DAYS - 1));

  const fetchMetrics = useCallback(async (from: string, to: string): Promise<AdsV2MetricsPayload | null> => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(`/api/ads-v2/metrics?account=tyson&status=all&dateFrom=${from}&dateTo=${to}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as AdsV2MetricsPayload;
      if (!data.preparing) return data;
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

  const base = ratesOf(baseline?.total ?? null);
  const now = ratesOf(current?.total ?? null);
  const launched = hammer?.status === "live" || hammer?.status === "paused";
  const daysLive = launch ? Math.max(0, Math.round((Date.parse(today) - Date.parse(launch)) / 86400000)) + 1 : 0;

  // ── Decision rules ───────────────────────────────────────────────────────
  const freq = hammer?.last72?.frequency ?? null;
  const freqRule = useMemo(() => {
    if (!launched) return { tone: "none" as Tone, label: "Not launched", action: "Build and go live to start reading frequency." };
    if (freq == null) return { tone: "none" as Tone, label: "No read yet", action: "Meta has not reported a 72 hour window yet." };
    if (freq < HAMMER_RULES.freqMin)
      return { tone: "warn" as Tone, label: "Below target", action: `Increase daily budget by $${HAMMER_RULES.budgetStepUsd}.` };
    if (freq > HAMMER_RULES.freqMax)
      return { tone: "act" as Tone, label: "Above target", action: `Pull daily budget back by $${HAMMER_RULES.budgetStepUsd}.` };
    return { tone: "ok" as Tone, label: "On target", action: "Hold the budget." };
  }, [launched, freq]);

  const cpm = hammer?.last72?.cpmCents ?? null;
  const cpmRule = useMemo(() => {
    if (!launched || cpm == null) return { tone: "none" as Tone, label: "No read yet", action: "" };
    if (cpm > HAMMER_RULES.cpmHighCents)
      return { tone: "act" as Tone, label: "High", action: "Audience is stale or too small. Recreate the DM list fresh." };
    if (cpm < HAMMER_RULES.cpmLowCents)
      return { tone: "warn" as Tone, label: "Low", action: "Cheap impressions can be junk. Check watch time in Ads Manager." };
    return { tone: "ok" as Tone, label: "Healthy", action: "In the expected range for a warm list." };
  }, [launched, cpm]);

  const lifts = {
    msgToCall: rel(base.msgToCall, now.msgToCall),
    showRate: rel(base.showRate, now.showRate),
    closeRate: rel(base.closeRate, now.closeRate),
  };
  const anyUp = Object.values(lifts).some((v) => v != null && v > HAMMER_RULES.liftRel);
  const anyDown = Object.values(lifts).some((v) => v != null && v < -HAMMER_RULES.liftRel);
  const liftRule = useMemo(() => {
    if (!launched) return { tone: "none" as Tone, label: "Baseline only", action: "The 28 days before launch are locked in below." };
    if (!current) return { tone: "none" as Tone, label: "Loading", action: "" };
    if (daysLive < 7) return { tone: "none" as Tone, label: `Too early (day ${daysLive} of 7)`, action: "Read the lift after 7 days." };
    if (anyUp) return { tone: "ok" as Tone, label: "Lifting", action: "A funnel rate is up more than 10% vs baseline. Keep going." };
    if (anyDown) return { tone: "act" as Tone, label: "Down", action: "A funnel rate fell more than 10% vs baseline. Investigate." };
    return { tone: "warn" as Tone, label: "Flat", action: "No rate has moved 10% yet. Give it to day 14." };
  }, [launched, current, daysLive, anyUp, anyDown]);

  const contentRule = useMemo(() => {
    if (!launched || !current || daysLive < 7) return { tone: "none" as Tone, label: "Reading", action: "" };
    const showUp = lifts.showRate != null && lifts.showRate > HAMMER_RULES.liftRel;
    const closeUp = lifts.closeRate != null && lifts.closeRate > HAMMER_RULES.liftRel;
    if (showUp && closeUp) return { tone: "ok" as Tone, label: "Working", action: "Show rate and close rate are both up." };
    if (showUp) return { tone: "warn" as Tone, label: "Gets them to the call, not to yes", action: "Add testimonials that sell the decision to start, not just the result." };
    if (daysLive >= HAMMER_RULES.verdictDays && !anyUp)
      return { tone: "act" as Tone, label: "Nothing moved in 14 days", action: "The hammer is not the lever. Look at the setter conversation." };
    return { tone: "none" as Tone, label: "Reading", action: `Day ${daysLive}. Verdict at day ${HAMMER_RULES.verdictDays}.` };
  }, [launched, current, daysLive, lifts.showRate, lifts.closeRate, anyUp]);

  // ── Summary line ─────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (hammerErr && !hammer) return `Hammer read failed: ${hammerErr}`;
    if (!hammer) return "Reading the hammer campaign...";
    if (!launched) {
      return `Hammer is not launched. Baseline ${fmtMD(baselineFrom)} to ${fmtMD(baselineTo)}: DM to call ${pct(base.msgToCall)}, show ${pct(base.showRate)}, close ${pct(base.closeRate)}.`;
    }
    const state = hammer.status === "live" ? "ON" : "PAUSED";
    const f = freq == null ? "no frequency read yet" : `Frequency ${one(freq)} in 72h (${freqRule.label.toLowerCase()})`;
    const lift =
      current && daysLive >= 7
        ? `DM to call ${pts(base.msgToCall, now.msgToCall)}, show ${pts(base.showRate, now.showRate)}, close ${pts(base.closeRate, now.closeRate)} vs baseline.`
        : `Day ${daysLive}. Lift reads at day 7.`;
    const action =
      freqRule.tone === "ok" && (liftRule.tone === "ok" || liftRule.tone === "none") ? "No action needed." : freqRule.action;
    return `Hammer is ${state}. ${f}. ${lift} ${action}`;
  }, [hammer, hammerErr, launched, freq, freqRule, liftRule, current, daysLive, base, now, baselineFrom, baselineTo]);

  // ── Charts ───────────────────────────────────────────────────────────────
  const freqDays = (hammer?.days ?? []).slice(-7);
  const freqLabels = freqDays.map((d) => fmtMD(d.day));
  const freqValues = freqDays.map((d) => d.freq72);

  const unionDays: MetricsDay[] = useMemo(() => union?.days ?? [], [union]);
  const rolling = useMemo(() => {
    // 7-day rolling rates from the day series, so one quiet day does not spike.
    const out: { labels: string[]; dmToCall: (number | null)[]; close: (number | null)[] } = {
      labels: [],
      dmToCall: [],
      close: [],
    };
    for (let i = 0; i < unionDays.length; i++) {
      const w = unionDays.slice(Math.max(0, i - 6), i + 1);
      const msgs = w.reduce((s, d) => s + d.messages, 0);
      const booked = w.reduce((s, d) => s + d.booked, 0);
      const taken = w.reduce((s, d) => s + d.taken, 0);
      const wins = w.reduce((s, d) => s + d.newClients, 0);
      out.labels.push(fmtMD(unionDays[i].day));
      out.dmToCall.push(msgs ? booked / msgs : null);
      out.close.push(taken ? wins / taken : null);
    }
    return out;
  }, [unionDays]);
  const launchIndex = launch ? unionDays.findIndex((d) => d.day === launch) : -1;

  if (hidden) return null;

  const overallTone: Tone = !launched
    ? "none"
    : freqRule.tone === "act" || liftRule.tone === "act" || contentRule.tone === "act"
      ? "act"
      : freqRule.tone === "warn" || liftRule.tone === "warn"
        ? "warn"
        : "ok";

  return (
    <section className="hammer">
      <div className="hm-head">
        <div className="hm-head-left">
          <h2 className="metric-board-title">Hammer Them</h2>
          <StatusChip tone={overallTone}>
            {!hammer ? "Loading" : !launched ? "Not launched" : hammer.status === "live" ? "Live" : "Paused"}
          </StatusChip>
        </div>
        <button className="metric-board-btn" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide section" : "Show section"}
        </button>
      </div>
      <div className={`hm-summary tone-${overallTone}`}>{summary}</div>

      {open && (
        <>
          <div className="hm-grid">
            {/* 1. Hammer card */}
            <div className="panel chart-card hm-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">Hammer card</div>
                  <div className="chart-subtitle">
                    <span className="chart-big">{one(freq)}</span>
                    <span className="chart-sub-label">impressions per person, last 72 hours</span>
                  </div>
                </div>
                <StatusChip tone={freqRule.tone}>{freqRule.label}</StatusChip>
              </div>
              <div className="hm-stats">
                <div className="hm-stat">
                  <div className="hm-stat-label">Daily spend</div>
                  <div className="hm-stat-value mono">{usd(hammer?.today?.spendCents)}</div>
                  <div className="hm-stat-sub">budget {usd(hammer?.dailyBudgetCents)} across {hammer?.adsetsActive ?? 0} ad sets</div>
                </div>
                <div className="hm-stat">
                  <div className="hm-stat-label">CPM</div>
                  <div className="hm-stat-value mono">{usd(cpm, 2)}</div>
                  <div className="hm-stat-sub">last 72 hours</div>
                </div>
                <div className="hm-stat">
                  <div className="hm-stat-label">Impressions</div>
                  <div className="hm-stat-value mono">{int(hammer?.last72?.impressions)}</div>
                  <div className="hm-stat-sub">last 72 hours, {int(hammer?.last72?.reach)} people</div>
                </div>
                <div className="hm-stat">
                  <div className="hm-stat-label">Audience</div>
                  <div className="hm-stat-value mono">
                    {hammer?.audience ? `${int(hammer.audience.lower)} to ${int(hammer.audience.upper)}` : "-"}
                  </div>
                  <div className="hm-stat-sub">
                    {hammer?.audience ? `${hammer.audience.name}${hammer.audience.ready ? "" : " (not deliverable)"}` : "no list attached"}
                  </div>
                </div>
              </div>
              {freqDays.length > 0 ? (
                <LineChart
                  idBase="hm-freq"
                  labels={freqLabels}
                  series={[{ name: "Frequency, 72h", values: freqValues, color: "var(--gold)", isPrimary: true, fmt: one }]}
                  fmt={one}
                  band={{ from: HAMMER_RULES.freqMin, to: HAMMER_RULES.freqMax, label: `TARGET ${HAMMER_RULES.freqMin} TO ${HAMMER_RULES.freqMax}` }}
                  height={170}
                />
              ) : (
                <div className="hm-empty">{hammerErr ? hammerErr : "No campaign yet. The chart starts on launch day."}</div>
              )}
              <div className="hm-foot">{hammer?.campaignName ? `${hammer.campaignName} · ` : ""}checked {hammer ? new Date(hammer.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "-"}</div>
            </div>

            {/* 2. Funnel lift */}
            <div className="panel chart-card hm-card">
              <div className="chart-head">
                <div>
                  <div className="chart-title">Funnel lift</div>
                  <div className="chart-sub-label">
                    Baseline {fmtMD(baselineFrom)} to {fmtMD(baselineTo)}
                    {launched ? ` · since launch ${fmtMD(launch!)} to today` : " · since launch starts on launch day"}
                  </div>
                </div>
                <StatusChip tone={liftRule.tone}>{liftRule.label}</StatusChip>
              </div>
              <table className="hm-lift">
                <thead>
                  <tr>
                    <th></th>
                    <th>Baseline</th>
                    <th>Since launch</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["DM to call", base.msgToCall, now.msgToCall],
                      ["Show rate", base.showRate, now.showRate],
                      ["Close rate", base.closeRate, now.closeRate],
                    ] as [string, number | null, number | null][]
                  ).map(([label, b, c]) => {
                    const r = rel(b, c);
                    const tone: Tone = r == null ? "none" : r > HAMMER_RULES.liftRel ? "ok" : r < -HAMMER_RULES.liftRel ? "act" : "warn";
                    return (
                      <tr key={label}>
                        <td className="hm-lift-label">{label}</td>
                        <td className="mono">{pct(b)}</td>
                        <td className="mono">{launched ? pct(c) : "-"}</td>
                        <td className={`mono hm-delta tone-${tone}`}>{launched ? pts(b, c) : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rolling.labels.length > 1 ? (
                <LineChart
                  idBase="hm-lift"
                  labels={rolling.labels}
                  series={[
                    { name: "DM to call, 7 day", values: rolling.dmToCall, color: "var(--gold)", isPrimary: true, fmt: pct },
                    { name: "Close rate, 7 day", values: rolling.close, color: "var(--text-2)", dashed: true, fmt: pct },
                  ]}
                  fmt={(v) => `${Math.round(v * 100)}%`}
                  leftMax={1}
                  marker={launchIndex >= 0 ? { index: launchIndex, label: "LAUNCH" } : undefined}
                  height={170}
                />
              ) : (
                <div className="hm-empty">Loading the day series...</div>
              )}
              <div className="chart-legend">
                <span className="chart-legend-item">
                  <span className="chart-sw" style={{ background: "var(--gold)" }} />
                  DM to call, 7 day rolling
                </span>
                <span className="chart-legend-item">
                  <span className="chart-sw" style={{ background: "var(--text-2)" }} />
                  Close rate, 7 day rolling
                </span>
                <span className="chart-legend-item">Show rate has no day series, table only</span>
              </div>
            </div>
          </div>

          {/* 3. Decision rules */}
          <div className="panel hm-rules">
            <div className="chart-title">Decision rules</div>
            {[
              { name: "Frequency", rule: freqRule, read: freq == null ? "-" : `${one(freq)} per person in 72h, target ${HAMMER_RULES.freqMin} to ${HAMMER_RULES.freqMax}` },
              { name: "CPM", rule: cpmRule, read: cpm == null ? "-" : `${usd(cpm, 2)}, healthy $${HAMMER_RULES.cpmLowCents / 100} to $${HAMMER_RULES.cpmHighCents / 100}` },
              { name: "Lift", rule: liftRule, read: launched && current ? `DM to call ${pts(base.msgToCall, now.msgToCall)}, show ${pts(base.showRate, now.showRate)}, close ${pts(base.closeRate, now.closeRate)}` : "-" },
              { name: "Content", rule: contentRule, read: launched ? `day ${daysLive}` : "-" },
            ].map((row) => (
              <div className="hm-rule" key={row.name}>
                <div className="hm-rule-name">{row.name}</div>
                <StatusChip tone={row.rule.tone}>{row.rule.label}</StatusChip>
                <div className="hm-rule-read mono">{row.read}</div>
                <div className="hm-rule-action">{row.rule.action}</div>
              </div>
            ))}
            <div className="hm-foot">
              Frequency, CPM, impressions and audience come from Meta for the hammer campaign, cached 10 minutes. Baseline and since-launch rates are the same numbers as the Metrics cards for Tyson, all statuses. The hammer makes no DMs or calls of its own, so it never appears in the table above.
            </div>
          </div>
        </>
      )}
    </section>
  );
}
