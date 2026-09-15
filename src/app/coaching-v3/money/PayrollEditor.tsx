"use client";

/**
 * Client-side payroll editor for /coaching-v3/money.
 * Reuses V1's /api/coaching (upsert_expense, delete_expense) so V1 and V3
 * write to the same expenses table. No new endpoints.
 */

import { useState } from "react";
import { Plus, Pencil, Trash2, Check, X, Loader2 } from "lucide-react";

export interface PayrollRow {
  id?: number;
  month: string;     // "YYYY-MM"
  name: string;
  role: string;
  base: number;
  commissions: number;
  platform: string;
  cadence: string;   // payment_cadence
  paid: boolean;
  paymentVia: string; // payment_via
}

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

async function api(action: string, payload: unknown): Promise<Record<string, unknown>> {
  const res = await fetch("/api/coaching", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

interface Props {
  initialRows: PayrollRow[];
  month: string; // YYYY-MM
}

const CADENCES = ["Monthly", "Twice Monthly", "Weekly", "Bi-weekly", "One-time"];

export default function PayrollEditor({ initialRows, month }: Props) {
  const [rows, setRows] = useState<PayrollRow[]>(initialRows);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<PayrollRow>({
    month,
    name: "",
    role: "",
    base: 0,
    commissions: 0,
    platform: "",
    cadence: "Monthly",
    paid: false,
    paymentVia: "",
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<PayrollRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = rows.reduce((s, r) => s + r.base + r.commissions, 0);

  const save = async (r: PayrollRow) => {
    if (!r.name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    setBusy("save");
    try {
      const j = await api("upsert_expense", {
        id: r.id,
        month: r.month,
        name: r.name.trim(),
        role: r.role.trim(),
        base: Number(r.base) || 0,
        commissions: Number(r.commissions) || 0,
        platform: r.platform.trim(),
        comments: "",
        paid: r.paid,
        paymentVia: r.paymentVia.trim(),
        paymentCadence: r.cadence.trim(),
      });
      const saved = j.data as Record<string, unknown>;
      const savedRow: PayrollRow = {
        id: saved.id as number,
        month: saved.month as string,
        name: (saved.name as string) ?? "",
        role: (saved.role as string) ?? "",
        base: Number(saved.base) || 0,
        commissions: Number(saved.commissions) || 0,
        platform: (saved.platform as string) ?? "",
        cadence: (saved.payment_cadence as string) ?? "",
        paid: !!saved.paid,
        paymentVia: (saved.payment_via as string) ?? "",
      };
      if (r.id) {
        setRows((prev) => prev.map((x) => (x.id === r.id ? savedRow : x)));
        setEditingId(null);
        setEditDraft(null);
      } else {
        setRows((prev) => [...prev, savedRow].sort((a, b) => b.base + b.commissions - (a.base + a.commissions)));
        setAdding(false);
        setDraft({ ...draft, name: "", role: "", base: 0, commissions: 0, platform: "", paymentVia: "" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const del = async (id: number) => {
    if (!confirm("Delete this payroll line?")) return;
    setBusy(`del-${id}`);
    setError(null);
    try {
      await api("delete_expense", { id });
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const togglePaid = async (row: PayrollRow) => {
    setBusy(`paid-${row.id}`);
    setError(null);
    try {
      await api("upsert_expense", {
        id: row.id,
        month: row.month,
        name: row.name,
        role: row.role,
        base: row.base,
        commissions: row.commissions,
        platform: row.platform,
        paid: !row.paid,
      });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, paid: !r.paid } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="h3-sec">
      <h2>
        <span className="n">{rows.length}</span>
        Payroll · {month}
        <span className="why">Total {money(total)}</span>
      </h2>

      {error && <div className="h3-notice err" style={{ marginBottom: 10 }}><i />{error}</div>}

      <div className="h3-list" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th style={{ textAlign: "right" }}>Base</Th>
              <Th style={{ textAlign: "right" }}>Commissions</Th>
              <Th style={{ textAlign: "right" }}>Total</Th>
              <Th>Paid via</Th>
              <Th>Cadence</Th>
              <Th>Paid</Th>
              <Th style={{ width: 90 }}> </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isEditing = editingId === r.id && editDraft;
              const rowTotal = r.base + r.commissions;
              return (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border-primary)" }}>
                  {isEditing ? (
                    <EditRow
                      draft={editDraft!}
                      onChange={setEditDraft}
                      onSave={() => editDraft && save(editDraft)}
                      onCancel={() => { setEditingId(null); setEditDraft(null); }}
                      busy={busy === "save"}
                    />
                  ) : (
                    <>
                      <Td><b style={{ color: "var(--text-primary)" }}>{r.name}</b></Td>
                      <Td>{r.role || "—"}</Td>
                      <Td style={{ textAlign: "right" }}>{money(r.base)}</Td>
                      <Td style={{ textAlign: "right" }}>{money(r.commissions)}</Td>
                      <Td style={{ textAlign: "right", fontWeight: 700 }}>{money(rowTotal)}</Td>
                      <Td>{r.paymentVia || "—"}</Td>
                      <Td>{r.cadence || "—"}</Td>
                      <Td>
                        <button
                          className="h3-btn s"
                          onClick={() => togglePaid(r)}
                          disabled={busy === `paid-${r.id}`}
                          style={{ padding: "2px 8px", color: r.paid ? "var(--success)" : "var(--warning)" }}
                        >
                          {busy === `paid-${r.id}` ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : r.paid ? "paid" : "pending"}
                        </button>
                      </Td>
                      <Td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="h3-btn s"
                            onClick={() => { setEditingId(r.id!); setEditDraft({ ...r }); }}
                            title="Edit"
                            style={{ padding: "3px 6px" }}
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            className="h3-btn s r"
                            onClick={() => r.id && del(r.id)}
                            disabled={busy === `del-${r.id}`}
                            title="Delete"
                            style={{ padding: "3px 6px" }}
                          >
                            {busy === `del-${r.id}` ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={11} />}
                          </button>
                        </div>
                      </Td>
                    </>
                  )}
                </tr>
              );
            })}

            {adding && (
              <tr style={{ borderTop: "1px solid var(--border-primary)", background: "var(--hover-bg-subtle, rgba(148,163,184,0.04))" }}>
                <EditRow
                  draft={draft}
                  onChange={setDraft}
                  onSave={() => save(draft)}
                  onCancel={() => setAdding(false)}
                  busy={busy === "save"}
                />
              </tr>
            )}

            {rows.length === 0 && !adding && (
              <tr>
                <td colSpan={9} className="h3-empty">
                  No payroll lines yet for {month}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10 }}>
        {!adding && (
          <button className="h3-btn p" onClick={() => setAdding(true)}>
            <Plus size={12} /> Add payroll line
          </button>
        )}
      </div>
    </section>
  );

  function EditRow({
    draft,
    onChange,
    onSave,
    onCancel,
    busy,
  }: {
    draft: PayrollRow;
    onChange: (r: PayrollRow) => void;
    onSave: () => void;
    onCancel: () => void;
    busy: boolean;
  }) {
    return (
      <>
        <Td><Input value={draft.name} onChange={(v) => onChange({ ...draft, name: v })} placeholder="Name" autoFocus /></Td>
        <Td><Input value={draft.role} onChange={(v) => onChange({ ...draft, role: v })} placeholder="Role" /></Td>
        <Td style={{ textAlign: "right" }}><NumInput value={draft.base} onChange={(v) => onChange({ ...draft, base: v })} /></Td>
        <Td style={{ textAlign: "right" }}><NumInput value={draft.commissions} onChange={(v) => onChange({ ...draft, commissions: v })} /></Td>
        <Td style={{ textAlign: "right", fontWeight: 700 }}>{money(draft.base + draft.commissions)}</Td>
        <Td><Input value={draft.paymentVia} onChange={(v) => onChange({ ...draft, paymentVia: v })} placeholder="Upwork / Direct" /></Td>
        <Td>
          <select
            value={draft.cadence}
            onChange={(e) => onChange({ ...draft, cadence: e.target.value })}
            style={selectStyle}
          >
            {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Td>
        <Td>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={draft.paid}
              onChange={(e) => onChange({ ...draft, paid: e.target.checked })}
            />
            paid
          </label>
        </Td>
        <Td>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="h3-btn s p" onClick={onSave} disabled={busy} style={{ padding: "3px 6px" }}>
              {busy ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={11} />}
            </button>
            <button className="h3-btn s" onClick={onCancel} style={{ padding: "3px 6px" }}>
              <X size={11} />
            </button>
          </div>
        </Td>
      </>
    );
  }
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 7px",
  background: "var(--bg-input, var(--bg-card))",
  color: "var(--text-primary)",
  border: "1px solid var(--border-primary)",
  borderRadius: 5,
  fontSize: 12,
  fontFamily: "inherit",
  fontVariantNumeric: "tabular-nums",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  padding: "4px 6px",
};

function Input({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      style={inputStyle}
    />
  );
}

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      style={{ ...inputStyle, textAlign: "right" }}
    />
  );
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        padding: "10px 12px",
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: 0.05,
        textTransform: "uppercase",
        ...style,
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", ...style }}>{children}</td>;
}
