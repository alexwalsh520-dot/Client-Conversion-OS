// ─────────────────────────────────────────────────────────────────────────
// THE TWELVE CHECKS. Each one fetches two numbers from two independent
// directions and hands them to a pure rule in rules.ts for the verdict.
//
// Nothing here writes a money number. Every check is read-only against the
// money system; the only writes in Build 3 are its own measurement rows.
// ─────────────────────────────────────────────────────────────────────────

import {
  CREATORS_BY_KEY,
  firstEnv,
  normalizeAdAccountId,
  type CreatorKey,
} from "@/lib/creators";
import { creatorCurrency } from "@/lib/fx/rates";
import { rangeForPreset, shiftDay, type PresetId } from "@/lib/ads-v2/time";
import type { AccuracyCheck, CheckContext, CheckOutcome } from "./types";
import {
  ASK_TWICE_TOLERANCE_NOTE,
  BOOKS_TOLERANCE_NOTE,
  BUDGET_PHOTO_TOLERANCE_NOTE,
  CASH_SHEET_TOLERANCE_NOTE,
  CHANGELOG_TOLERANCE_NOTE,
  FRESHNESS_TOLERANCE_NOTE,
  LEAK_TOLERANCE_NOTE,
  PURITY_TOLERANCE_NOTE,
  SETTER_TOLERANCE_NOTE,
  SPEND_META_TOLERANCE_NOTE,
  STAMP_TOLERANCE_NOTE,
  THERMOMETER_TOLERANCE_NOTE,
  classifyAskTwice,
  classifyBooksBalance,
  classifyBudgetPhotos,
  classifyCashVsSheet,
  classifyChangeLog,
  classifyFreshness,
  classifySetterCoverage,
  classifySpendVsMeta,
  classifyStampOrReason,
  classifyThermometers,
  classifyUnknownPurity,
  count,
  describeLeak,
  usd,
  type BooksMismatch,
  type FeedFreshness,
  type SpendComparison,
  type ThermometerComparison,
} from "./rules";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Currency map in the shape the counting functions expect. */
function currencyMap(clients: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of clients) map[c] = creatorCurrency(c);
  return map;
}

function hoursSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 3_600_000;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Books balance
// ─────────────────────────────────────────────────────────────────────────

/** The metrics recounted, mapped to the saved answer's own key names. */
const BOOKS_METRICS: Array<{ recount: string; saved: string; label: string; spendFeed: boolean }> = [
  { recount: "spend_cents", saved: "spendCents", label: "spend", spendFeed: true },
  { recount: "impressions", saved: "impressions", label: "impressions", spendFeed: true },
  { recount: "clicks", saved: "clicks", label: "clicks", spendFeed: true },
  { recount: "messages", saved: "messages", label: "DMs", spendFeed: false },
  { recount: "booked", saved: "booked", label: "bookings", spendFeed: false },
  { recount: "upcoming", saved: "upcoming", label: "upcoming calls", spendFeed: false },
  { recount: "showed_people", saved: "showedPeople", label: "showed", spendFeed: false },
  { recount: "taken_rows", saved: "taken", label: "calls taken", spendFeed: false },
  { recount: "taken_people", saved: "takenPeople", label: "people taken", spendFeed: false },
  { recount: "new_clients", saved: "newClients", label: "closes", spendFeed: false },
  { recount: "collected_usd_cents", saved: "collectedCents", label: "cash", spendFeed: false },
  { recount: "contracted_usd_cents", saved: "contractedCents", label: "contracted", spendFeed: false },
];

const BOOKS_WINDOWS: PresetId[] = ["today", "yesterday", "last7", "last30"];

interface RecountRow {
  client_key: string;
  spend_last_synced_at: string | null;
  facts_last_computed_at: string | null;
  [k: string]: unknown;
}

const booksBalance: AccuracyCheck = {
  key: "books_balance",
  name: "The books balance",
  toleranceNote: BOOKS_TOLERANCE_NOTE,
  budgetMs: 90_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const mismatches: BooksMismatch[] = [];
    let missingAnswers = 0;
    let comparisons = 0;
    const currency = currencyMap(ctx.clients);

    for (const preset of BOOKS_WINDOWS) {
      const r = rangeForPreset(preset, ctx.etDay);
      const { data: recountData, error: recountErr } = await ctx.db.rpc("warehouse_accuracy_recount", {
        p_clients: ctx.clients,
        p_from: r.from,
        p_to: r.to,
        p_currency: currency,
      });
      if (recountErr) throw new Error(`recount failed for ${preset}: ${recountErr.message}`);
      const byClient = new Map<string, RecountRow>();
      for (const row of (recountData || []) as RecountRow[]) byClient.set(row.client_key, row);

      for (const client of ctx.clients) {
        const { data: snap } = await ctx.db
          .from("adsv2_window_snapshots")
          .select("payload, computed_at")
          .eq("account", client)
          .eq("status", "all")
          .eq("level", "tree")
          .eq("date_from", r.from)
          .eq("date_to", r.to)
          .maybeSingle();
        if (!snap) {
          missingAnswers++;
          continue;
        }
        const saved = (snap.payload as { total?: Record<string, number> } | null)?.total || {};
        const mine = byClient.get(client);
        const savedAt = new Date(snap.computed_at as string).getTime();
        const spendFedAt = mine?.spend_last_synced_at
          ? new Date(mine.spend_last_synced_at).getTime()
          : 0;

        for (const m of BOOKS_METRICS) {
          const recount = Number(mine?.[m.recount] ?? 0);
          const savedValue = Number(saved[m.saved] ?? 0);
          comparisons++;
          if (recount !== savedValue) {
            mismatches.push({
              client,
              window: preset,
              metric: m.label,
              recount,
              saved: savedValue,
              fromSpendFeed: m.spendFeed,
              fedAfterAnswerSaved: spendFedAt > savedAt,
            });
          }
        }
      }
    }

    const verdict = classifyBooksBalance(mismatches, missingAnswers);
    return {
      status: verdict.status,
      leftLabel: "recounted from the facts",
      leftValue: `${count(comparisons - mismatches.length)} of ${count(comparisons)} numbers agree`,
      rightLabel: "the saved answer",
      rightValue: `${count(comparisons)} numbers checked across ${BOOKS_WINDOWS.length} windows`,
      diffValue: mismatches.length ? `${count(mismatches.length)} disagree` : "",
      whatToDo: verdict.status === "green" ? undefined : verdict.reason,
      detail: { mismatches: mismatches.slice(0, 50), missingAnswers, comparisons },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 2. Our spend vs Meta
// ─────────────────────────────────────────────────────────────────────────

async function metaSpendCents(
  adAccountId: string,
  token: string,
  from: string,
  to: string,
): Promise<number> {
  const url =
    `${GRAPH}/${adAccountId}/insights?fields=spend&level=account` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}` +
    `&access_token=${token}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Meta insights ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Array<{ spend?: string }> };
  const spend = (json.data || []).reduce((s, r) => s + (Number(r.spend || 0) || 0), 0);
  return Math.round(spend * 100);
}

const spendVsMeta: AccuracyCheck = {
  key: "spend_vs_meta",
  name: "Our spend matches Meta",
  toleranceNote: SPEND_META_TOLERANCE_NOTE,
  budgetMs: 60_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const yesterday = shiftDay(ctx.etDay, -1);
    const windows: Array<{ label: string; from: string; to: string }> = [
      { label: "yesterday", from: yesterday, to: yesterday },
      { label: "trailing 7 days", from: shiftDay(yesterday, -6), to: yesterday },
    ];
    const rows: SpendComparison[] = [];
    const detail: Record<string, unknown>[] = [];

    for (const w of windows) {
      const { data: ours, error } = await ctx.db.rpc("warehouse_accuracy_native_day_spend", {
        p_clients: ctx.clients,
        p_from: w.from,
        p_to: w.to,
      });
      if (error) throw new Error(`native-day spend failed: ${error.message}`);
      const ourByClient = new Map<string, number>();
      for (const r of (ours || []) as Array<{ client_key: string; spend_cents: number }>) {
        ourByClient.set(r.client_key, (ourByClient.get(r.client_key) || 0) + Number(r.spend_cents));
      }

      for (const client of ctx.clients) {
        const creator = CREATORS_BY_KEY[client as CreatorKey];
        const accountRaw = creator ? firstEnv(creator.adAccountEnv) || creator.defaultAdAccountId : null;
        const token = creator ? firstEnv(creator.tokenEnv) : null;
        const ourCents = ourByClient.get(client) || 0;
        if (!accountRaw || !token) {
          rows.push({ client, window: w.label, ourCents, metaCents: 0, configured: false });
          detail.push({ client, window: w.label, ourCents, meta: null, note: "no Meta key configured" });
          continue;
        }
        const metaCents = await metaSpendCents(
          normalizeAdAccountId(accountRaw),
          token,
          w.from,
          w.to,
        );
        rows.push({ client, window: w.label, ourCents, metaCents, configured: true });
        detail.push({ client, window: w.label, ourCents, metaCents, from: w.from, to: w.to });
      }
    }

    const verdict = classifySpendVsMeta(rows);
    const live = rows.filter((r) => r.configured);
    const ourTotal = live.reduce((s, r) => s + r.ourCents, 0);
    const metaTotal = live.reduce((s, r) => s + r.metaCents, 0);
    return {
      status: verdict.status,
      leftLabel: "our copy of Meta spend",
      leftValue: usd(ourTotal),
      rightLabel: "Meta, read fresh",
      rightValue: usd(metaTotal),
      diffValue: ourTotal === metaTotal ? "" : usd(ourTotal - metaTotal),
      whatToDo: verdict.status === "green" ? undefined : verdict.reason,
      detail: { comparisons: detail, note: "each creator's own currency, no conversion applied" },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 3. Our cash vs the sales sheet
// ─────────────────────────────────────────────────────────────────────────

const cashVsSheet: AccuracyCheck = {
  key: "cash_vs_sheet",
  name: "Our cash matches the sales sheet",
  toleranceNote: CASH_SHEET_TOLERANCE_NOTE,
  budgetMs: 45_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const r = rangeForPreset("last30", ctx.etDay);
    const { data, error } = await ctx.db.rpc("warehouse_accuracy_cash_vs_sheet", {
      p_from: r.from,
      p_to: r.to,
    });
    if (error) throw new Error(`cash vs sheet failed: ${error.message}`);
    const row = ((data || []) as Array<{
      facts_cents: number;
      tracker_cents: number;
      facts_rows: number;
      tracker_rows: number;
    }>)[0] || { facts_cents: 0, tracker_cents: 0, facts_rows: 0, tracker_rows: 0 };

    const input = {
      factsCents: Number(row.facts_cents),
      trackerCents: Number(row.tracker_cents),
      factsRows: Number(row.facts_rows),
      trackerRows: Number(row.tracker_rows),
    };
    const verdict = classifyCashVsSheet(input);
    return {
      status: verdict.status,
      leftLabel: "our sale rows",
      leftValue: `${usd(input.factsCents)} over ${count(input.factsRows)} calls`,
      rightLabel: "the sales sheet",
      rightValue: `${usd(input.trackerCents)} over ${count(input.trackerRows)} calls`,
      diffValue: input.factsCents === input.trackerCents ? "" : usd(input.factsCents - input.trackerCents),
      whatToDo: verdict.status === "green" ? undefined : verdict.reason,
      detail: {
        ...input,
        window: r,
        reminder:
          "cash on calls by call date; payments landing this month is a different question.",
      },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 4. Freshness
// ─────────────────────────────────────────────────────────────────────────

/** Each feed, and how long a gap between writes is still normal. */
const FEEDS: Array<{ name: string; maxHours: number }> = [
  { name: "Meta spend", maxHours: 26 },
  { name: "keyword DMs", maxHours: 26 },
  { name: "sales tracker", maxHours: 26 },
  { name: "bookings", maxHours: 26 },
  { name: "DM capture", maxHours: 72 },
  { name: "budget photos", maxHours: 26 },
  { name: "ad change capture", maxHours: 25 },
  { name: "people table", maxHours: 26 },
  { name: "ads table", maxHours: 26 },
  { name: "definitions table", maxHours: 26 },
  { name: "recorded calls", maxHours: 72 },
];

const freshness: AccuracyCheck = {
  key: "freshness",
  name: "Every feed is still arriving",
  toleranceNote: FRESHNESS_TOLERANCE_NOTE,
  budgetMs: 45_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const { data, error } = await ctx.db.rpc("warehouse_accuracy_freshness");
    if (error) throw new Error(`freshness failed: ${error.message}`);
    const lastWrite = new Map<string, string | null>();
    for (const r of (data || []) as Array<{ feed: string; last_write: string | null }>) {
      lastWrite.set(r.feed, r.last_write);
    }
    const feeds: FeedFreshness[] = FEEDS.map((f) => ({
      name: f.name,
      maxHours: f.maxHours,
      ageHours: hoursSince(lastWrite.get(f.name), ctx.now),
    }));
    const verdict = classifyFreshness(feeds);
    const oldest = feeds.reduce(
      (worst, f) => (f.ageHours === null ? f : worst.ageHours === null ? worst : f.ageHours > worst.ageHours ? f : worst),
      feeds[0],
    );
    return {
      status: verdict.status,
      leftLabel: "feeds on time",
      leftValue: `${count(feeds.filter((f) => f.ageHours !== null && f.ageHours <= f.maxHours).length)} of ${count(feeds.length)}`,
      rightLabel: "oldest feed",
      rightValue: oldest
        ? `${oldest.name} ${oldest.ageHours === null ? "never written" : `${oldest.ageHours.toFixed(1)}h ago`}`
        : "",
      diffValue: "",
      whatToDo: verdict.status === "green" ? undefined : verdict.reason,
      detail: { feeds },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 5. Stamp or reason
// ─────────────────────────────────────────────────────────────────────────

const stampOrReason: AccuracyCheck = {
  key: "stamp_or_reason",
  name: "Every row explains itself",
  toleranceNote: STAMP_TOLERANCE_NOTE,
  budgetMs: 45_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const { data, error } = await ctx.db.rpc("warehouse_accuracy_stamp_gaps");
    if (error) throw new Error(`stamp check failed: ${error.message}`);
    const rows = (data || []) as Array<{ table_name: string; rows: number; sample_ids: string[] }>;
    const total = rows.reduce((s, r) => s + Number(r.rows), 0);
    const verdict = classifyStampOrReason(total);
    return {
      status: verdict.status,
      leftLabel: "rows with neither a stamp nor a reason",
      leftValue: count(total),
      rightLabel: "allowed",
      rightValue: "0",
      diffValue: total === 0 ? "" : count(total),
      whatToDo: verdict.status === "green" ? undefined : verdict.reason,
      detail: { perTable: rows.map((r) => ({ table: r.table_name, rows: Number(r.rows), ids: r.sample_ids })) },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 6. Unknown-bucket purity
// ─────────────────────────────────────────────────────────────────────────

const unknownPurity: AccuracyCheck = {
  key: "unknown_purity",
  name: "No sale is hiding in the unknown bucket",
  toleranceNote: PURITY_TOLERANCE_NOTE,
  budgetMs: 60_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const { data, error } = await ctx.db.rpc("warehouse_accuracy_unknown_purity", {
      p_active_clients: ctx.clients,
    });
    if (error) throw new Error(`unknown purity failed: ${error.message}`);
    const rows = (data || []) as Array<{
      sale_id: string;
      sale_key: string;
      sale_et_day: string;
      missed_label: string;
    }>;
    const verdict = classifyUnknownPurity(rows.length);
    return {
      status: verdict.status,
      leftLabel: "explainable sales still marked unknown",
      leftValue: count(rows.length),
      rightLabel: "allowed",
      rightValue: "0",
      diffValue: rows.length === 0 ? "" : count(rows.length),
      whatToDo: verdict.status === "green" ? undefined : verdict.reason,
      detail: { offenders: rows.slice(0, 50) },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 7. Setter coverage
// ─────────────────────────────────────────────────────────────────────────

const setterCoverage: AccuracyCheck = {
  key: "setter_coverage",
  name: "No setter was dropped",
  toleranceNote: SETTER_TOLERANCE_NOTE,
  budgetMs: 45_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const { data, error } = await ctx.db.rpc("adsv2_count_facts_missing_setter");
    if (error) throw new Error(`setter check failed: ${error.message}`);
    const rows = (data || []) as Array<{ table_name: string; rows: number }>;
    const total = rows.reduce((s, r) => s + Number(r.rows), 0);
    const verdict = classifySetterCoverage(total);
    return {
      status: verdict.status,
      leftLabel: "rows missing a setter the source knows",
      leftValue: count(total),
      rightLabel: "allowed",
      rightValue: "0",
      diffValue: total === 0 ? "" : count(total),
      whatToDo: verdict.status === "green" ? undefined : verdict.reason,
      detail: { perTable: rows.map((r) => ({ table: r.table_name, rows: Number(r.rows) })) },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 8. Change-log continuity
// ─────────────────────────────────────────────────────────────────────────

const changeLogContinuity: AccuracyCheck = {
  key: "change_log_continuity",
  name: "The ad change log is being kept",
  toleranceNote: CHANGELOG_TOLERANCE_NOTE,
  budgetMs: 45_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const { data, error } = await ctx.db.rpc("warehouse_accuracy_change_log");
    if (error) throw new Error(`change log check failed: ${error.message}`);
    const row = ((data || []) as Array<{
      last_capture_at: string | null;
      duplicate_uids: number;
      total_changes: number;
    }>)[0] || { last_capture_at: null, duplicate_uids: 0, total_changes: 0 };

    const hours = hoursSince(row.last_capture_at, ctx.now);
    const duplicates = Number(row.duplicate_uids);
    const verdict = classifyChangeLog({ hoursSinceLastCapture: hours, duplicateUids: duplicates });
    return {
      status: verdict.status,
      leftLabel: "last successful capture",
      leftValue: hours === null ? "never" : `${hours.toFixed(1)} hours ago`,
      rightLabel: "duplicate change ids",
      rightValue: count(duplicates),
      diffValue: "",
      whatToDo: verdict.status === "green" ? undefined : verdict.reason,
      detail: { ...row, hoursSinceLastCapture: hours },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 9. Budget photos
// ─────────────────────────────────────────────────────────────────────────

const budgetPhotos: AccuracyCheck = {
  key: "budget_photos",
  name: "Every live dial was photographed today",
  toleranceNote: BUDGET_PHOTO_TOLERANCE_NOTE,
  budgetMs: 45_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const { data, error } = await ctx.db.rpc("warehouse_accuracy_budget_photos", {
      p_clients: ctx.clients,
      p_et_day: ctx.etDay,
    });
    if (error) throw new Error(`budget photos failed: ${error.message}`);
    const rows = (data || []) as Array<{
      client_key: string;
      entity_level: string;
      entity_id: string;
      entity_name: string | null;
      photographed: boolean;
    }>;
    const active = rows.length;
    const photographed = rows.filter((r) => r.photographed).length;
    const verdict = classifyBudgetPhotos({ active, photographed });
    return {
      status: verdict.status,
      leftLabel: "live dials",
      leftValue: count(active),
      rightLabel: "photographed today",
      rightValue: count(photographed),
      diffValue: active === photographed ? "" : count(active - photographed),
      whatToDo: verdict.status === "green" ? undefined : verdict.reason,
      detail: { missing: rows.filter((r) => !r.photographed).slice(0, 50) },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 10. Two thermometers (the frozen v1 tab, read only)
// ─────────────────────────────────────────────────────────────────────────

const twoThermometers: AccuracyCheck = {
  key: "two_thermometers",
  name: "The old tab agrees on spend",
  toleranceNote: THERMOMETER_TOLERANCE_NOTE,
  budgetMs: 60_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const yesterday = shiftDay(ctx.etDay, -1);
    const from = shiftDay(yesterday, -29);
    const { data: ours, error } = await ctx.db.rpc("warehouse_accuracy_recount", {
      p_clients: ctx.clients,
      p_from: from,
      p_to: yesterday,
      p_currency: currencyMap(ctx.clients),
    });
    if (error) throw new Error(`recount failed: ${error.message}`);
    const ourByClient = new Map<string, number>();
    for (const r of (ours || []) as Array<{ client_key: string; spend_cents: number }>) {
      ourByClient.set(r.client_key, Number(r.spend_cents));
    }

    const rows: ThermometerComparison[] = [];
    for (const client of ctx.clients) {
      const { data: v1 } = await ctx.db
        .from("ads_dashboard_snapshots")
        .select("payload, computed_at")
        .eq("account", client)
        .eq("date_from", from)
        .eq("date_to", yesterday)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const v1Dollars = (v1?.payload as { summary?: { adSpend?: number } } | null)?.summary?.adSpend;
      rows.push({
        client,
        ourCents: ourByClient.get(client) || 0,
        v1Cents: typeof v1Dollars === "number" ? Math.round(v1Dollars * 100) : null,
        v1AgeHours: hoursSince(v1?.computed_at as string | undefined, ctx.now),
      });
    }

    const verdict = classifyThermometers(rows);
    const ourTotal = rows.reduce((s, r) => s + r.ourCents, 0);
    const v1Total = rows.reduce((s, r) => s + (r.v1Cents ?? 0), 0);
    return {
      status: verdict.status,
      leftLabel: "the new numbers",
      leftValue: usd(ourTotal),
      rightLabel: "the old tab",
      rightValue: usd(v1Total),
      diffValue: ourTotal === v1Total ? "" : usd(ourTotal - v1Total),
      whatToDo: verdict.status === "green" ? undefined : verdict.reason,
      detail: { window: { from, to: yesterday }, perClient: rows },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 11. Ask twice
// ─────────────────────────────────────────────────────────────────────────

const askTwice: AccuracyCheck = {
  key: "ask_twice",
  name: "Ask twice, same answer",
  toleranceNote: ASK_TWICE_TOLERANCE_NOTE,
  budgetMs: 45_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const client = ctx.clients[0];
    const r = rangeForPreset("last7", ctx.etDay);
    const { data, error } = await ctx.db.rpc("warehouse_accuracy_ask_twice", {
      p_client: client,
      p_from: r.from,
      p_to: r.to,
    });
    if (error) throw new Error(`ask-twice read failed: ${error.message}`);
    const bySource = new Map<string, string>();
    for (const row of (data || []) as Array<{
      source: string;
      spend_cents: number | null;
      collected_cents: number | null;
    }>) {
      bySource.set(
        row.source,
        JSON.stringify({ spendCents: row.spend_cents, collectedCents: row.collected_cents }),
      );
    }
    const missing = JSON.stringify({ spendCents: null, collectedCents: null });
    const first = bySource.get("table") ?? missing;
    const second = bySource.get("table_again") ?? missing;
    const shortcut = bySource.get("warehouse_answers") ?? missing;
    const verdict = classifyAskTwice({
      firstAnswer: first,
      secondAnswer: second,
      shortcutAnswer: shortcut,
    });
    return {
      status: verdict.status,
      leftLabel: `${client}, trailing 7 days, asked once`,
      leftValue: first,
      rightLabel: "asked again, and through the warehouse shortcut",
      rightValue: second === shortcut ? second : `${second} / ${shortcut}`,
      diffValue: first === second && first === shortcut ? "" : "answers differ",
      whatToDo: verdict.status === "green" ? undefined : verdict.reason,
      detail: { client, window: r, first, second, shortcut },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// 12. Leak watch (informational)
// ─────────────────────────────────────────────────────────────────────────

const leakWatch: AccuracyCheck = {
  key: "leak_watch",
  name: "Bookings arriving with no keyword",
  toleranceNote: LEAK_TOLERANCE_NOTE,
  budgetMs: 45_000,
  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const last7 = rangeForPreset("last7", ctx.etDay);
    const prior7 = { from: shiftDay(last7.from, -7), to: shiftDay(last7.from, -1) };
    const countIn = async (from: string, to: string) => {
      const { count: n, error } = await ctx.db
        .from("adsv2_booking_facts")
        .select("id", { count: "exact", head: true })
        .in("client_key", ctx.clients)
        .eq("awaiting_review", true)
        .gte("booked_et_day", from)
        .lte("booked_et_day", to);
      if (error) throw new Error(`leak watch failed: ${error.message}`);
      return n || 0;
    };
    const a = await countIn(last7.from, last7.to);
    const b = await countIn(prior7.from, prior7.to);
    const verdict = describeLeak({ last7: a, prior7: b });
    return {
      status: verdict.status,
      leftLabel: "last 7 days",
      leftValue: count(a),
      rightLabel: "the 7 days before",
      rightValue: count(b),
      diffValue: a === b ? "" : `${a > b ? "+" : ""}${a - b}`,
      whatToDo: verdict.reason,
      detail: { last7: { ...last7, bookings: a }, prior7: { ...prior7, bookings: b } },
    };
  },
};

/** The twelve checks, in the order they read on the page. */
export const ACCURACY_CHECKS: readonly AccuracyCheck[] = [
  booksBalance,
  spendVsMeta,
  cashVsSheet,
  freshness,
  stampOrReason,
  unknownPurity,
  setterCoverage,
  changeLogContinuity,
  budgetPhotos,
  twoThermometers,
  askTwice,
  leakWatch,
];
