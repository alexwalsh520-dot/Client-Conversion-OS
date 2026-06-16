// Invoicing compute engine — Client Conversion / The Forge.
//
// Produces the 5-line invoice for a client over a date window, plus the
// per-source breakdown and the sanity ratios. All money math is validated
// against Matthew's manual process (June 1–14 2026 = $44,895.75).
//
// Data sources, all on America/New_York calendar boundaries:
//   ① Sales (20% of cash collected)  → Stripe balance transactions (LLP + Subs)
//   ② Coaching ($30 × program-months) → sales_tracker_rows, outcome=WIN only
//   ③ Ad spend                        → Meta hourly insights, re-bucketed PT→ET
//   ④ Software                        → flat $1,500
//   ⑤ Profit split (50%)              → (net deposited − ①–④) ÷ 2
// Whop completed-withdrawals enter both cash-collected and net as a manual input
// (Whop's payout view isn't exposed on the API key scope).

import { getServiceSupabase } from "@/lib/supabase";

export const SOFTWARE_FEE = 1500;
export const SALES_PCT = 0.2;
export const COACHING_PER_MONTH = 30;
const ET = "America/New_York";

// ---- client config (extend when Antwan's processors go live) ----
interface StripeAccount {
  label: string;
  envKey: string;
}
interface ClientConfig {
  key: string;
  label: string;
  stripe: StripeAccount[];
  metaAccountEnv: string;
  metaTokenEnv: string;
  offerMatch: string[]; // lowercase substrings that identify this client in the sales tracker
}
export const CLIENTS: Record<string, ClientConfig> = {
  tyson: {
    key: "tyson",
    label: "Tyson Sonnek",
    stripe: [
      { label: "Forge LLP", envKey: "STRIPE_KEY_TYSON_LLP" },
      { label: "Forge Subscriptions", envKey: "STRIPE_KEY_TYSON_SUBS" },
    ],
    metaAccountEnv: "META_AD_ACCOUNT_TYSON",
    metaTokenEnv: "META_ACCESS_TOKEN",
    offerMatch: ["tyson", "sonnek"],
  },
};

// ---------- types ----------
export interface StripeSourceResult {
  label: string;
  cash: number; // cash collected (gross charges − refunds), pre-fee
  net: number; // net deposited (gross − fees − refunds − disputes)
  ok: boolean;
  error?: string;
}
export interface InvoiceInputs {
  stripe: StripeSourceResult[];
  whop: number;
  adSpend: number;
  programMonths: number;
}
export interface InvoiceLines {
  sales: number;
  coaching: number;
  adSpend: number;
  software: number;
  profitSplit: number;
  total: number;
  cashCollected: number;
  netDeposited: number;
  netProfit: number;
  netProfitPct: number; // net profit ÷ cash collected
  totalPct: number; // total ÷ cash collected
}
export interface InvoiceResult {
  client: string;
  clientLabel: string;
  window: { from: string; to: string };
  period: { start: string; end: string; label: string; totalDays: number; elapsedDays: number; complete: boolean };
  inputs: InvoiceInputs;
  lines: InvoiceLines;
  forecast: InvoiceLines | null; // projection to period end at current run-rate
  warnings: string[];
}

// ---------- timezone helpers ----------
function pad(n: number) {
  return String(n).padStart(2, "0");
}
// Offset in minutes that the given IANA zone is ahead of UTC at `date`.
function zoneOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUTC - date.getTime()) / 60000;
}
// Unix seconds for `YYYY-MM-DD HH:00` wall-clock in `timeZone`.
function zonedEpochSeconds(dateStr: string, hour: number, timeZone: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const naiveUTC = Date.UTC(y, m - 1, d, hour, 0, 0);
  const offset = zoneOffsetMinutes(timeZone, new Date(naiveUTC));
  return (naiveUTC - offset * 60000) / 1000;
}
// ET calendar date (YYYY-MM-DD) of a given UTC-ms instant.
function etDateOf(utcMs: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(utcMs)
  );
}
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function daysInclusive(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000) + 1;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Invoice period that contains `dateStr`: [1–14] or [15–EOM].
export function periodFor(dateStr: string): { start: string; end: string; label: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (d <= 14) {
    return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-14`, label: `${MONTHS[m - 1]} 1–14, ${y}` };
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${y}-${pad(m)}-15`, end: `${y}-${pad(m)}-${pad(last)}`, label: `${MONTHS[m - 1]} 15–${last}, ${y}` };
}

// ---------- Stripe ----------
async function stripeWindow(envKey: string, label: string, fromDate: string, toDate: string): Promise<StripeSourceResult> {
  const key = process.env[envKey];
  if (!key) return { label, cash: 0, net: 0, ok: false, error: `${envKey} not set` };
  const gte = zonedEpochSeconds(fromDate, 0, ET);
  const lt = zonedEpochSeconds(addDays(toDate, 1), 0, ET); // exclusive end-of-day
  let gross = 0,
    refunds = 0,
    net = 0;
  let after: string | null = null;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const qs = new URLSearchParams({
        "created[gte]": String(gte),
        "created[lt]": String(lt),
        limit: "100",
      });
      if (after) qs.set("starting_after", after);
      const res = await fetch(`https://api.stripe.com/v1/balance_transactions?${qs}`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Stripe ${res.status}`);
      const data = (await res.json()) as {
        data: Array<{ id: string; type: string; amount: number; net: number }>;
        has_more: boolean;
      };
      for (const t of data.data) {
        if (t.type === "charge" || t.type === "payment") gross += t.amount;
        if (t.type.includes("refund")) refunds += t.amount; // already negative
        if (t.type !== "payout") net += t.net;
      }
      if (data.has_more && data.data.length) after = data.data[data.data.length - 1].id;
      else break;
    }
    return { label, cash: (gross + refunds) / 100, net: net / 100, ok: true };
  } catch (e) {
    return { label, cash: 0, net: 0, ok: false, error: e instanceof Error ? e.message : "stripe error" };
  }
}

// ---------- Meta ad spend, re-bucketed to Eastern ----------
async function metaSpendET(cfg: ClientConfig, fromDate: string, toDate: string): Promise<{ spend: number; ok: boolean; error?: string }> {
  const token = process.env[cfg.metaTokenEnv];
  const account = process.env[cfg.metaAccountEnv];
  if (!token || !account) return { spend: 0, ok: false, error: "Meta token/account not set" };
  try {
    // advertiser timezone (Tyson's account = Pacific); fetch to be safe
    let advTz = "America/Los_Angeles";
    try {
      const acctRes = await fetch(`https://graph.facebook.com/v21.0/${account}?fields=timezone_name&access_token=${token}`, {
        cache: "no-store",
      });
      const acct = (await acctRes.json()) as { timezone_name?: string };
      if (acct.timezone_name) advTz = acct.timezone_name;
    } catch {
      /* fall back to Pacific */
    }
    // Pull PT calendar days [from-1 .. to] hourly, then bucket each hour into its ET day.
    const since = addDays(fromDate, -1);
    const timeRange = JSON.stringify({ since, until: toDate });
    let url: string | null =
      `https://graph.facebook.com/v21.0/${account}/insights?fields=spend&time_increment=1` +
      `&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&limit=500` +
      `&time_range=${encodeURIComponent(timeRange)}&access_token=${token}`;
    const byEtDay: Record<string, number> = {};
    while (url) {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Meta ${res.status}`);
      const json = (await res.json()) as {
        data: Array<{ date_start: string; spend?: string; hourly_stats_aggregated_by_advertiser_time_zone?: string }>;
        paging?: { next?: string };
      };
      for (const row of json.data) {
        const spend = Number(row.spend || 0);
        const hr = Number((row.hourly_stats_aggregated_by_advertiser_time_zone || "00:00:00").slice(0, 2));
        const utcSec = zonedEpochSeconds(row.date_start, hr, advTz);
        const etDay = etDateOf(utcSec * 1000);
        byEtDay[etDay] = (byEtDay[etDay] || 0) + spend;
      }
      url = json.paging?.next || null;
    }
    let spend = 0;
    for (const [day, amt] of Object.entries(byEtDay)) {
      if (day >= fromDate && day <= toDate) spend += amt;
    }
    return { spend, ok: true };
  } catch (e) {
    return { spend: 0, ok: false, error: e instanceof Error ? e.message : "meta error" };
  }
}

// ---------- Coaching (program-months, WIN only) ----------
function parseMonths(raw: string | null): number {
  if (!raw) return 0;
  const s = raw.trim().toLowerCase();
  if (s.includes("month to month") || s === "monthly") return 1;
  const m = s.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}
async function coachingMonths(cfg: ClientConfig, fromDate: string, toDate: string): Promise<{ months: number; ok: boolean; error?: string }> {
  try {
    const db = getServiceSupabase();
    const { data, error } = await db
      .from("sales_tracker_rows")
      .select("offer,program_length,outcome,date")
      .gte("date", fromDate)
      .lte("date", toDate)
      .limit(10000);
    if (error) throw new Error(error.message);
    let months = 0;
    for (const r of (data || []) as Array<{ offer: string | null; program_length: string | null; outcome: string | null }>) {
      const offer = (r.offer || "").toLowerCase();
      if (!cfg.offerMatch.some((s) => offer.includes(s))) continue;
      if ((r.outcome || "").toUpperCase() !== "WIN") continue; // only actual sales
      months += parseMonths(r.program_length);
    }
    return { months, ok: true };
  } catch (e) {
    return { months: 0, ok: false, error: e instanceof Error ? e.message : "supabase error" };
  }
}

// ---------- line assembly ----------
export function linesFromInputs(i: InvoiceInputs): InvoiceLines {
  const stripeCash = i.stripe.reduce((s, a) => s + a.cash, 0);
  const stripeNet = i.stripe.reduce((s, a) => s + a.net, 0);
  const cashCollected = stripeCash + i.whop;
  const netDeposited = stripeNet + i.whop;
  const sales = cashCollected * SALES_PCT;
  const coaching = i.programMonths * COACHING_PER_MONTH;
  const adSpend = i.adSpend;
  const software = SOFTWARE_FEE;
  const netProfit = netDeposited - sales - coaching - adSpend - software;
  const profitSplit = netProfit / 2;
  const total = sales + coaching + adSpend + software + profitSplit;
  return {
    sales,
    coaching,
    adSpend,
    software,
    profitSplit,
    total,
    cashCollected,
    netDeposited,
    netProfit,
    netProfitPct: cashCollected ? (netProfit / cashCollected) * 100 : 0,
    totalPct: cashCollected ? (total / cashCollected) * 100 : 0,
  };
}

// ---------- main ----------
export async function computeInvoice(opts: {
  client: string;
  from: string; // YYYY-MM-DD (period start)
  to: string; // YYYY-MM-DD (as-of date, ≤ period end)
  whop?: number;
}): Promise<InvoiceResult> {
  const cfg = CLIENTS[opts.client];
  if (!cfg) throw new Error(`Unknown client: ${opts.client}`);
  const warnings: string[] = [];
  const whop = opts.whop ?? 0;

  const [stripe, meta, coaching] = await Promise.all([
    Promise.all(cfg.stripe.map((a) => stripeWindow(a.envKey, a.label, opts.from, opts.to))),
    metaSpendET(cfg, opts.from, opts.to),
    coachingMonths(cfg, opts.from, opts.to),
  ]);

  for (const s of stripe) if (!s.ok) warnings.push(`Stripe ${s.label}: ${s.error}`);
  if (!meta.ok) warnings.push(`Ad spend: ${meta.error}`);
  if (!coaching.ok) warnings.push(`Coaching: ${coaching.error}`);
  if (whop === 0) warnings.push("Whop withdrawals not entered (counted as $0).");

  const inputs: InvoiceInputs = { stripe, whop, adSpend: meta.spend, programMonths: coaching.months };
  const lines = linesFromInputs(inputs);

  const period = periodFor(opts.from);
  const totalDays = daysInclusive(period.start, period.end);
  const elapsedDays = daysInclusive(period.start, opts.to);
  const complete = opts.to >= period.end;

  let forecast: InvoiceLines | null = null;
  if (!complete && elapsedDays > 0) {
    const f = totalDays / elapsedDays;
    const projected: InvoiceInputs = {
      stripe: inputs.stripe.map((a) => ({ ...a, cash: a.cash * f, net: a.net * f })),
      whop: inputs.whop * f,
      adSpend: inputs.adSpend * f,
      programMonths: inputs.programMonths * f,
    };
    forecast = linesFromInputs(projected);
  }

  return {
    client: cfg.key,
    clientLabel: cfg.label,
    window: { from: opts.from, to: opts.to },
    period: { ...period, totalDays, elapsedDays, complete },
    inputs,
    lines,
    forecast,
    warnings,
  };
}
