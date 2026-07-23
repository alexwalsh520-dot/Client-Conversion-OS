// ─────────────────────────────────────────────────────────────────────────
// SELF-CHECK — the accuracy gates, run nightly by cron. It reconciles v2
// against the primary sources, checks cross-window invariants, and scans the
// source data for anomalies. Everything it finds is REPORTED (an alert row +
// the returned report), never silently excluded from any count. Report, never
// referee.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { todayEt, rangeForPreset } from "./time";
import { ADSV2_SERVED_CLIENTS, FACTS_LOOKBACK_DAYS } from "./config";
import { startRun, finishRun, type Db } from "./db";

interface Finding {
  type: string;
  severity: "info" | "warn" | "error";
  clientKey: string | null;
  detail: Record<string, unknown>;
  dedupeKey: string;
}

export interface SelfCheckReport {
  etDay: string;
  findings: Finding[];
  gates: Record<string, unknown>;
}

export async function runSelfCheck(now: Date = new Date()): Promise<SelfCheckReport> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "selfcheck");
  const started = Date.now();
  const etDay = todayEt(now);
  const findings: Finding[] = [];
  const gates: Record<string, unknown> = {};
  const clients = [...ADSV2_SERVED_CLIENTS];
  const factFloor = rangeForPreset("last30", etDay).from;

  try {
    // ── Gate: zero unmarked (non-ET) spend rows in any served window ────────
    {
      const { count } = await db
        .from("ads_meta_insights_daily")
        .select("id", { count: "exact", head: true })
        .in("client_key", clients)
        .neq("raw_payload->>reporting_timezone", "America/New_York")
        .gte("date", factFloor);
      const unmarked = count || 0;
      gates.unmarkedSpendRows = unmarked;
      if (unmarked > 0) {
        findings.push({
          type: "unmarked_spend",
          severity: "error",
          clientKey: null,
          detail: { rows: unmarked, since: factFloor },
          dedupeKey: `unmarked_spend|${etDay}`,
        });
      }
    }

    // ── Anomaly: an appointment scheduled before it was created ─────────────
    {
      const { data } = await db
        .from("adsv2_booking_facts")
        .select("appointment_key, person_name, start_time, created_time, client_key")
        .in("client_key", clients)
        .gte("booked_et_day", factFloor)
        .not("created_time", "is", null);
      const bad = (data || []).filter(
        (r) => r.start_time && r.created_time && r.start_time < r.created_time,
      );
      gates.callBeforeBooking = bad.length;
      for (const r of bad.slice(0, 50)) {
        findings.push({
          type: "anomaly_call_before_booking",
          severity: "warn",
          clientKey: r.client_key,
          detail: { person: r.person_name, start: r.start_time, created: r.created_time },
          dedupeKey: `call_before_booking|${r.appointment_key}`,
        });
      }
    }

    // ── Anomaly: keywordless bookings on the sales calendars (capture gap) ──
    {
      const { count } = await db
        .from("adsv2_booking_facts")
        .select("id", { count: "exact", head: true })
        .in("client_key", clients)
        .eq("awaiting_review", true)
        .gte("booked_et_day", rangeForPreset("last7", etDay).from);
      const keywordless = count || 0;
      gates.keywordlessBookingsLast7 = keywordless;
      if (keywordless > 0) {
        findings.push({
          type: "keywordless_bookings",
          severity: "info",
          clientKey: null,
          detail: { last7: keywordless, note: "bookings on the sales calendar with no keyword; a capture gap to fix at source" },
          dedupeKey: `keywordless|${etDay}`,
        });
      }
    }

    // ── Gate: sales reconciliation (attributed collected <= tracker total) ──
    for (const preset of ["last7", "last30"] as const) {
      const r = rangeForPreset(preset, etDay);
      // Attributed collected (paid, not organic, not awaiting).
      const { data: attrRows } = await db
        .from("adsv2_sale_facts")
        .select("collected_usd_cents")
        .in("client_key", clients)
        .eq("is_organic", false)
        .eq("awaiting_review", false)
        .not("keyword_normalized", "is", null)
        .gte("sale_et_day", r.from)
        .lte("sale_et_day", r.to);
      const attributed = (attrRows || []).reduce((s, x) => s + Number(x.collected_usd_cents || 0), 0);
      // Sales tracker raw total for the same ET dates.
      const { data: trackerRows } = await db
        .from("sales_tracker_rows")
        .select("collected_revenue_cents")
        .gte("date", r.from)
        .lte("date", r.to);
      const trackerTotal = (trackerRows || []).reduce(
        (s, x) => s + Number(x.collected_revenue_cents || 0),
        0,
      );
      gates[`reconcile_${preset}`] = { attributedCents: attributed, trackerTotalCents: trackerTotal };
      if (attributed > trackerTotal) {
        findings.push({
          type: "reconcile_drift",
          severity: "error",
          clientKey: null,
          detail: { preset, attributedCents: attributed, trackerTotalCents: trackerTotal },
          dedupeKey: `reconcile_drift|${preset}|${etDay}`,
        });
      }
    }

    // ── Gate: cross-window invariants (nested windows never shrink) ─────────
    {
      const violations = await checkInvariants(db, etDay);
      gates.invariantViolations = violations.length;
      for (const v of violations) {
        findings.push({
          type: "invariant",
          severity: "error",
          clientKey: v.account,
          detail: v as unknown as Record<string, unknown>,
          dedupeKey: `invariant|${v.account}|${v.status}|${v.metric}|${etDay}`,
        });
      }
    }

    // Write alert rows (idempotent by dedupe_key).
    if (findings.length) {
      await db.from("adsv2_alerts").upsert(
        findings.map((f) => ({
          et_day: etDay,
          alert_type: f.type,
          client_key: f.clientKey,
          severity: f.severity,
          dedupe_key: f.dedupeKey,
          detail: f.detail as object,
        })),
        { onConflict: "dedupe_key" },
      );
    }

    await finishRun(db, runId, {
      status: "ok",
      rows: findings.length,
      durationMs: Date.now() - started,
      detail: gates,
    });
    return { etDay, findings, gates };
  } catch (err) {
    await finishRun(db, runId, {
      status: "error",
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

interface InvariantViolation {
  account: string;
  status: string;
  metric: string;
  smaller: { window: string; value: number };
  larger: { window: string; value: number };
}

// Additive metrics can never decrease as the window grows (1d subset of 3d
// subset of 7d subset of 30d). Read the precomputed snapshot totals and check.
async function checkInvariants(db: Db, etDay: string): Promise<InvariantViolation[]> {
  const additive = [
    "spendCents",
    "impressions",
    "clicks",
    "messages",
    "booked",
    "taken",
    "newClients",
    "collectedCents",
  ];
  const nested: Array<["today" | "last3" | "last7" | "last30", string]> = [
    ["today", "1d"],
    ["last3", "3d"],
    ["last7", "7d"],
    ["last30", "30d"],
  ];
  const accounts = ["all", "tyson", "jake"];
  const statuses = ["active", "finished", "all"];
  const out: InvariantViolation[] = [];

  for (const account of accounts) {
    for (const status of statuses) {
      const totals: Record<string, Record<string, number>> = {};
      for (const [preset, label] of nested) {
        const r = rangeForPreset(preset, etDay);
        const { data } = await db
          .from("adsv2_window_snapshots")
          .select("payload")
          .eq("account", account)
          .eq("status", status)
          .eq("level", "tree")
          .eq("date_from", r.from)
          .eq("date_to", r.to)
          .maybeSingle();
        const total = (data?.payload as { total?: Record<string, number> } | undefined)?.total;
        if (total) totals[label] = total;
      }
      const order = ["1d", "3d", "7d", "30d"].filter((l) => totals[l]);
      for (let i = 1; i < order.length; i++) {
        for (const m of additive) {
          const small = totals[order[i - 1]][m] ?? 0;
          const large = totals[order[i]][m] ?? 0;
          if (large + 1e-6 < small) {
            out.push({
              account,
              status,
              metric: m,
              smaller: { window: order[i - 1], value: small },
              larger: { window: order[i], value: large },
            });
          }
        }
      }
    }
  }
  return out;
}

export const SELFCHECK_LOOKBACK = FACTS_LOOKBACK_DAYS;
