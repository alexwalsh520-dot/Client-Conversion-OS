/**
 * Server side read of the existing financials route (two Google Sheets by
 * month). We call the route with the caller's cookie so its auth applies.
 */
import { headers } from "next/headers";

export interface RefundRow { clientName: string; date: string; type: string; amount: number; fault: string; reason: string; salesPerson: string; disputed: string; }
export interface RetentionRow { clientName: string; date: string; paymentTotal: number; coach: string; isNew: string; offer: string; monthsSold: number; }
export interface Financials { month: string; monthIndex: number; refunds: RefundRow[]; retentions: RetentionRow[]; error?: string; }

export async function fetchFinancials(monthIndex: number): Promise<Financials> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  try {
    const res = await fetch(`${proto}://${host}/api/coaching/financials?month=${monthIndex}`, { headers: { cookie: h.get("cookie") ?? "" }, cache: "no-store" });
    const j = await res.json();
    if (!res.ok) return { month: "", monthIndex, refunds: [], retentions: [], error: j.error ?? "Financials unavailable" };
    const retentions = ((j.retentions ?? []) as Record<string, unknown>[]).map((r) => ({
      clientName: String(r.clientName ?? r.client ?? r.name ?? ""),
      date: String(r.date ?? ""),
      paymentTotal: Number(r.paymentTotal ?? r.payment ?? 0) || 0,
      coach: String(r.coach ?? ""),
      isNew: String(r.isNew ?? ""),
      offer: String(r.offer ?? ""),
      monthsSold: Number(r.monthsSold ?? 0) || 0,
    }));
    return { month: j.month ?? "", monthIndex, refunds: (j.refunds ?? []) as RefundRow[], retentions };
  } catch (e) {
    return { month: "", monthIndex, refunds: [], retentions: [], error: e instanceof Error ? e.message : "Financials unavailable" };
  }
}

/** Only real refunds count toward totals; "handled" rows are excluded, same as the Financials tab. */
export const isRealRefund = (r: RefundRow) => /^(refund|partial refund)$/i.test((r.type ?? "").trim());
