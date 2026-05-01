"use client";

import { useState, useEffect } from "react";
import {
  Lock,
  Plus,
  Trash2,
  Edit3,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Calculator,
  Users,
  X,
  Check,
} from "lucide-react";
import type { Expense, Client } from "@/lib/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Props {
  expenses: Expense[];
  clients: Client[];
  onSaveExpense: (expense: Partial<Expense>) => Promise<void>;
  onDeleteExpense: (id: number) => Promise<void>;
}

const fmtMoney = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function getMonthStr(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export default function ExpensesTab({ expenses, clients, onSaveExpense, onDeleteExpense }: Props) {
  // ---- Passcode Gate ----
  const [unlocked, setUnlocked] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("expenses_unlocked") === "true") {
      setUnlocked(true);
    }
  }, []);

  const handlePasscode = () => {
    if (passcode === process.env.NEXT_PUBLIC_EXPENSES_PASSCODE) {
      setUnlocked(true);
      sessionStorage.setItem("expenses_unlocked", "true");
      setPasscodeError("");
    } else {
      setPasscodeError("Incorrect passcode");
    }
  };

  // ---- Month Selector ----
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const selectedMonth = getMonthStr(year, monthIndex);

  const prevMonth = () => {
    if (monthIndex === 0) { setMonthIndex(11); setYear((y) => y - 1); }
    else setMonthIndex((m) => m - 1);
  };
  const nextMonth = () => {
    if (monthIndex === 11) { setMonthIndex(0); setYear((y) => y + 1); }
    else setMonthIndex((m) => m + 1);
  };

  // ---- Expense Form ----
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", role: "", base: "", commissions: "", platform: "", comments: "" });

  const resetForm = () => {
    setForm({ name: "", role: "", base: "", commissions: "", platform: "", comments: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (e: Expense) => {
    setForm({
      name: e.name,
      role: e.role,
      base: String(e.base),
      commissions: String(e.commissions),
      platform: e.platform,
      comments: e.comments,
    });
    setEditingId(e.id || null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    await onSaveExpense({
      ...(editingId ? { id: editingId } : {}),
      month: selectedMonth,
      name: form.name.trim(),
      role: form.role.trim(),
      base: Number(form.base) || 0,
      commissions: Number(form.commissions) || 0,
      platform: form.platform.trim(),
      comments: form.comments.trim(),
    });
    resetForm();
  };

  // ---- Filtered Data ----
  const monthExpenses = expenses.filter((e) => e.month === selectedMonth);
  const totalExpenses = monthExpenses.reduce((sum, e) => sum + e.base + e.commissions, 0);

  // ---- Invoice Calculation ----
  const getActiveClientsForMonth = (): Client[] => {
    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);

    return clients.filter((c) => {
      // Post-status-simplification (migration 023): only "active"
      // counts as billable. Legacy paused/retained collapsed into
      // active; cancelled/refunded into completed.
      if (c.status !== "active") return false;
      if (!c.startDate) return false;
      const start = new Date(c.startDate);
      if (start > lastDay) return false;
      if (c.endDate) {
        const end = new Date(c.endDate);
        if (end < firstDay) return false;
      }
      return true;
    });
  };

  const activeClients = getActiveClientsForMonth();
  const invoiceAmount = activeClients.length * 30;

  // ---- Passcode Gate UI ----
  if (!unlocked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 80, gap: 16 }}>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 16, padding: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, maxWidth: 360, width: "100%" }}>
          <Lock size={32} style={{ color: "var(--text-muted)" }} />
          <h3 style={{ color: "var(--text-primary)", margin: 0, fontSize: 18 }}>Expenses</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, textAlign: "center" }}>
            Enter the passcode to view expense reports
          </p>
          <input
            type="password"
            value={passcode}
            onChange={(e) => { setPasscode(e.target.value); setPasscodeError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handlePasscode()}
            placeholder="Passcode"
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 8,
              border: passcodeError ? "1px solid var(--danger)" : "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 14,
              outline: "none",
            }}
          />
          {passcodeError && (
            <span style={{ color: "var(--danger)", fontSize: 12 }}>{passcodeError}</span>
          )}
          <button
            onClick={handlePasscode}
            style={{
              width: "100%", padding: "10px 0", borderRadius: 8, border: "none",
              background: "var(--accent)", color: "#000", fontWeight: 600, cursor: "pointer", fontSize: 14,
            }}
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  // ---- Main Content ----
  return (
    <div>
      {/* Month Selector */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 24 }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-primary)", padding: 4 }}>
          <ChevronLeft size={20} />
        </button>
        <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 18, minWidth: 180, textAlign: "center" }}>
          {MONTHS[monthIndex]} {year}
        </span>
        <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-primary)", padding: 4 }}>
          <ChevronRight size={20} />
        </button>
      </div>

      {/* ---- Section 1: Monthly Expense Table ---- */}
      <div className="section" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            <DollarSign size={16} />
            Monthly Expenses
          </h2>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8,
              border: "none", background: "var(--accent)", color: "#000", fontWeight: 600, cursor: "pointer", fontSize: 13,
            }}
          >
            <Plus size={14} /> Add Expense
          </button>
        </div>

        {/* Add/Edit Form */}
        {showForm && (
          <div className="glass-static" style={{ padding: 16, marginBottom: 16, borderRadius: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Waleed"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Role</label>
                <input
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  placeholder="e.g. Coach"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Base ($)</label>
                <input
                  type="number"
                  value={form.base}
                  onChange={(e) => setForm({ ...form, base: e.target.value })}
                  placeholder="0"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Commissions ($)</label>
                <input
                  type="number"
                  value={form.commissions}
                  onChange={(e) => setForm({ ...form, commissions: e.target.value })}
                  placeholder="0"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Platform</label>
                <input
                  value={form.platform}
                  onChange={(e) => setForm({ ...form, platform: e.target.value })}
                  placeholder="e.g. Upwork, Mercury"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Comments</label>
                <input
                  value={form.comments}
                  onChange={(e) => setForm({ ...form, comments: e.target.value })}
                  placeholder="e.g. 3 retentions, 2 video testimonials"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 13 }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={resetForm} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
                <X size={13} /> Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim()}
                style={{
                  padding: "6px 14px", borderRadius: 6, border: "none",
                  background: form.name.trim() ? "var(--accent)" : "rgba(255,255,255,0.1)",
                  color: form.name.trim() ? "#000" : "var(--text-muted)",
                  cursor: form.name.trim() ? "pointer" : "default", fontWeight: 600, fontSize: 13,
                  display: "flex", alignItems: "center", gap: 4,
                }}
              >
                <Check size={13} /> {editingId ? "Update" : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Expense Table */}
        <div className="glass-static" style={{ overflow: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Role</th>
                <th>Base</th>
                <th>Commissions</th>
                <th>Platform</th>
                <th>Comments</th>
                <th style={{ width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {monthExpenses.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
                    No expenses for {MONTHS[monthIndex]} {year}. Click &quot;Add Expense&quot; to start.
                  </td>
                </tr>
              ) : (
                monthExpenses.map((e, i) => (
                  <tr key={e.id}>
                    <td>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{e.name}</td>
                    <td>{e.role}</td>
                    <td>{fmtMoney(e.base)}</td>
                    <td>{e.commissions > 0 ? fmtMoney(e.commissions) : "—"}</td>
                    <td>{e.platform || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.comments || "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => startEdit(e)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }} title="Edit">
                          <Edit3 size={14} />
                        </button>
                        <button onClick={() => { if (confirm("Delete this expense?")) onDeleteExpense(e.id!); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", padding: 4 }} title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
              {monthExpenses.length > 0 && (
                <tr style={{ fontWeight: 700, borderTop: "2px solid rgba(255,255,255,0.1)" }}>
                  <td colSpan={3} style={{ textAlign: "right" }}>Total Expenses</td>
                  <td>{fmtMoney(monthExpenses.reduce((s, e) => s + e.base, 0))}</td>
                  <td>{fmtMoney(monthExpenses.reduce((s, e) => s + e.commissions, 0))}</td>
                  <td colSpan={3} style={{ fontWeight: 700, color: "var(--danger)" }}>{fmtMoney(totalExpenses)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Section 2: Invoice Calculation ---- */}
      <div className="section" style={{ marginBottom: 24 }}>
        <h2 className="section-title">
          <Calculator size={16} />
          Invoice Calculation — {MONTHS[monthIndex]} {year}
        </h2>
        <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Active Clients</div>
            <div className="metric-card-value">
              <Users size={18} style={{ marginRight: 6, opacity: 0.6 }} />
              {activeClients.length}
            </div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Rate per Client</div>
            <div className="metric-card-value">$30.00</div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total Invoice</div>
            <div className="metric-card-value" style={{ color: "var(--success)" }}>{fmtMoney(invoiceAmount)}</div>
          </div>
          <div className="glass-static metric-card">
            <div className="metric-card-label">Total Expenses</div>
            <div className="metric-card-value" style={{ color: "var(--danger)" }}>{fmtMoney(totalExpenses)}</div>
          </div>
        </div>
      </div>

    </div>
  );
}
