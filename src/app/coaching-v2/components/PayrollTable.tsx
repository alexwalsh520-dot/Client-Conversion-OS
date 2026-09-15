"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ExpenseRow = { id: number; month: string; name: string; role: string; base: number; commissions: number; platform: string; comments: string; paid: boolean; paymentVia: string; paymentCadence: string };
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** The month's payroll ledger. The Paid box saves through upsert_expense, sending the whole row like the Expenses tab does. */
export default function PayrollTable({ rows }: { rows: ExpenseRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [local, setLocal] = useState(rows);
  async function toggle(r: ExpenseRow) {
    setBusy(r.id);
    const next = { ...r, paid: !r.paid };
    setLocal((l) => l.map((x) => (x.id === r.id ? next : x)));
    try {
      const res = await fetch("/api/coaching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upsert_expense", payload: next }) });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch { setLocal((l) => l.map((x) => (x.id === r.id ? r : x))); }
    finally { setBusy(null); }
  }
  const tb = local.reduce((s, r) => s + r.base, 0), tc = local.reduce((s, r) => s + r.commissions, 0);
  const paid = local.filter((r) => r.paid).length;
  return (
    <div className="h2-tw">
      <table className="h2-table">
        <thead><tr><th>Paid</th><th>Name</th><th>Role</th><th className="num">Base</th><th className="num">Commissions</th><th className="num">Total</th><th>Via</th></tr></thead>
        <tbody>
          {local.map((r) => (
            <tr key={r.id}>
              <td><input type="checkbox" checked={r.paid} disabled={busy === r.id} onChange={() => toggle(r)} /></td>
              <td className="name">{r.name}</td>
              <td className="h2-m">{r.role}</td>
              <td className="num">{money(r.base)}</td>
              <td className="num">{money(r.commissions)}</td>
              <td className="num">{money(r.base + r.commissions)}</td>
              <td className="h2-m">{r.paymentVia}</td>
            </tr>
          ))}
          {!local.length && <tr><td colSpan={7} className="h2-empty">No payroll rows for this month yet. Add them in the Coaching tab.</td></tr>}
          {local.length > 0 && <tr className="total"><td /><td>Paid {paid} of {local.length}</td><td /><td className="num">{money(tb)}</td><td className="num">{money(tc)}</td><td className="num">{money(tb + tc)}</td><td /></tr>}
        </tbody>
      </table>
    </div>
  );
}
