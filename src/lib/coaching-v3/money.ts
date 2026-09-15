// /coaching-v3/money data. Reads only. Everything is scoped to the current
// calendar month; the caller can override with a YYYY-MM string.

import { getServiceSupabase } from "@/lib/supabase";

const norm = (s: string | null | undefined) =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export interface RetentionSaleRow {
  clientId: number | null;
  clientName: string;
  coach: string;
  paidAt: string;
  amount: number;
}

export interface RefundRow {
  clientName: string | null;
  coach: string | null;
  refundedAt: string;
  amount: number;
}

export interface CommissionRow {
  coach: string;
  count: number;
  estimated: number; // per-ask heuristic: $50 for a completed ask
}

export interface PayrollRow {
  name: string;
  role: string;
  base: number;
  commissions: number;
  total: number;
  paid: boolean;
  platform: string;
  cadence: string;
}

export interface MoneyView {
  month: string; // YYYY-MM
  retentions: RetentionSaleRow[];
  retentionsTotal: number;
  refunds: RefundRow[];
  refundsTotal: number;
  commissions: CommissionRow[];
  commissionsEstimated: number;
  payroll: PayrollRow[];
  payrollTotal: number;
}

function firstOfMonthIso(month: string): string {
  return `${month}-01T00:00:00Z`;
}
function firstOfNextMonthIso(month: string): string {
  const [y, m] = month.split("-").map((x) => parseInt(x, 10));
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  return `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00Z`;
}

/** ~$50 per completed milestone (Written/Video/Extension/Referral) is the
 *  team's working rule of thumb. Money page shows this as "estimated" — the
 *  authoritative number still lives in expenses.commissions written by
 *  payroll each month. */
const COMMISSION_PER_ASK = 50;

export async function loadMoney(month?: string): Promise<MoneyView> {
  const db = getServiceSupabase();
  const today = new Date();
  const targetMonth =
    month ??
    `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  const start = firstOfMonthIso(targetMonth);
  const end = firstOfNextMonthIso(targetMonth);

  const [paymentsQ, clientsQ, milestonesQ, expensesQ] = await Promise.all([
    db
      .from("stripe_payments")
      .select("email, contact_name, amount_cents, refunded_cents, paid_at, billing_reason, status")
      .gte("paid_at", start)
      .lt("paid_at", end),
    db.from("clients").select("id, name, email, coach_name"),
    db
      .from("coach_milestones")
      .select(
        "client_name, coach_name, trust_pilot_completion_date, video_testimonial_completion_date, retention_completion_date, referral_completion_date",
      ),
    db
      .from("expenses")
      .select(
        "id, month, name, role, base, commissions, platform, comments, paid, payment_via, payment_cadence",
      )
      .eq("month", targetMonth),
  ]);

  // Payments indexed by email + name for coach attribution.
  type ClientLite = { id: number; name: string; email: string | null; coach: string };
  const clientByEmail = new Map<string, ClientLite>();
  const clientByName = new Map<string, ClientLite[]>();
  for (const c of clientsQ.data ?? []) {
    const info: ClientLite = {
      id: c.id as number,
      name: (c.name as string) ?? "",
      email: (c.email as string) ?? null,
      coach: (c.coach_name as string) ?? "",
    };
    const e = norm(info.email);
    if (e) clientByEmail.set(e, info);
    const n = norm(info.name);
    if (n) {
      const arr = clientByName.get(n) ?? [];
      arr.push(info);
      clientByName.set(n, arr);
    }
  }

  const retentions: RetentionSaleRow[] = [];
  const refunds: RefundRow[] = [];

  for (const p of paymentsQ.data ?? []) {
    const status = String(p.status ?? "").toLowerCase();
    const isPaid = !status || /paid|succeeded|complete/.test(status);
    const amountCents = Number(p.amount_cents) || 0;
    const refundedCents = Number(p.refunded_cents) || 0;
    const reason = String(p.billing_reason ?? "");
    const paidAt = (p.paid_at as string) ?? "";
    const emailK = norm(p.email as string);
    const nameK = norm(p.contact_name as string);
    let match: ClientLite | null = null;
    if (emailK) match = clientByEmail.get(emailK) ?? null;
    if (!match && nameK) {
      const hits = clientByName.get(nameK) ?? [];
      if (hits.length === 1) match = hits[0];
    }
    // Retention detection: paid, $97+, NOT a recurring subscription cycle.
    const dollarAmount = (amountCents - refundedCents) / 100;
    if (
      isPaid &&
      dollarAmount >= 97 &&
      reason !== "subscription_cycle" &&
      paidAt
    ) {
      retentions.push({
        clientId: match?.id ?? null,
        clientName: match?.name ?? (p.contact_name as string) ?? (p.email as string) ?? "?",
        coach: match?.coach ?? "Unassigned",
        paidAt,
        amount: dollarAmount,
      });
    }
    // Refund: refunded_cents > 0 counts as a refund event in this month.
    if (refundedCents > 0 && paidAt) {
      refunds.push({
        clientName: match?.name ?? (p.contact_name as string) ?? null,
        coach: match?.coach ?? null,
        refundedAt: paidAt,
        amount: refundedCents / 100,
      });
    }
  }

  retentions.sort((a, b) => (a.paidAt > b.paidAt ? -1 : 1));
  refunds.sort((a, b) => (a.refundedAt > b.refundedAt ? -1 : 1));

  // Commissions estimated from milestone completions in the window.
  const commissionCount = new Map<string, number>();
  for (const m of milestonesQ.data ?? []) {
    const dates = [
      m.trust_pilot_completion_date,
      m.video_testimonial_completion_date,
      m.retention_completion_date,
      m.referral_completion_date,
    ] as (string | null)[];
    const coach = (m.coach_name as string) ?? "Unassigned";
    for (const d of dates) {
      if (!d) continue;
      const ym = /^(\d{4}-\d{2})/.exec(d)?.[1];
      if (ym !== targetMonth) continue;
      commissionCount.set(coach, (commissionCount.get(coach) ?? 0) + 1);
    }
  }
  const commissions: CommissionRow[] = [...commissionCount.entries()]
    .map(([coach, count]) => ({
      coach,
      count,
      estimated: count * COMMISSION_PER_ASK,
    }))
    .sort((a, b) => b.estimated - a.estimated);

  // Payroll from expenses.
  const payroll: PayrollRow[] = (expensesQ.data ?? []).map((e) => ({
    name: (e.name as string) ?? "",
    role: (e.role as string) ?? "",
    base: Number(e.base) || 0,
    commissions: Number(e.commissions) || 0,
    total: (Number(e.base) || 0) + (Number(e.commissions) || 0),
    paid: !!e.paid,
    platform: (e.platform as string) ?? (e.payment_via as string) ?? "",
    cadence: (e.payment_cadence as string) ?? "",
  }));
  payroll.sort((a, b) => b.total - a.total);

  return {
    month: targetMonth,
    retentions,
    retentionsTotal: retentions.reduce((s, r) => s + r.amount, 0),
    refunds,
    refundsTotal: refunds.reduce((s, r) => s + r.amount, 0),
    commissions,
    commissionsEstimated: commissions.reduce((s, r) => s + r.estimated, 0),
    payroll,
    payrollTotal: payroll.reduce((s, r) => s + r.total, 0),
  };
}
