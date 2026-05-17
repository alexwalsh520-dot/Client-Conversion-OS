"use client";

/**
 * Taxonomy admin modal: add/view departments and per-department roles.
 * Read-only listing for now; only the create-new form is interactive.
 * Edit/delete can come later — most teams add taxonomy items rarely and
 * mostly want a way to GET them in.
 */

import { useState } from "react";
import { X, Plus } from "lucide-react";
import type { SopDepartment, SopRole } from "@/lib/sop/types";

interface Props {
  open: boolean;
  departments: SopDepartment[];
  roles: SopRole[];
  onClose: () => void;
  onChanged: () => void;
}

export default function SopTaxonomyModal({
  open,
  departments,
  roles,
  onClose,
  onChanged,
}: Props) {
  const [newDeptLabel, setNewDeptLabel] = useState("");
  const [newDeptError, setNewDeptError] = useState<string | null>(null);
  const [savingDept, setSavingDept] = useState(false);

  // Per-department new-role state. Keyed by department id so multiple
  // forms can co-exist without state conflicts.
  const [newRoleByDept, setNewRoleByDept] = useState<Record<number, { label: string; error: string | null; saving: boolean }>>({});

  if (!open) return null;

  function getRoleForm(deptId: number) {
    return newRoleByDept[deptId] ?? { label: "", error: null, saving: false };
  }
  function setRoleForm(deptId: number, patch: Partial<ReturnType<typeof getRoleForm>>) {
    setNewRoleByDept((prev) => ({
      ...prev,
      [deptId]: { ...getRoleForm(deptId), ...patch },
    }));
  }

  async function createDepartment() {
    setNewDeptError(null);
    const label = newDeptLabel.trim();
    if (!label) {
      setNewDeptError("Label is required.");
      return;
    }
    setSavingDept(true);
    try {
      const res = await fetch("/api/sop/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setNewDeptLabel("");
      onChanged();
    } catch (err) {
      setNewDeptError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSavingDept(false);
    }
  }

  async function createRole(deptId: number) {
    const form = getRoleForm(deptId);
    const label = form.label.trim();
    setRoleForm(deptId, { error: null });
    if (!label) {
      setRoleForm(deptId, { error: "Label is required." });
      return;
    }
    setRoleForm(deptId, { saving: true });
    try {
      const res = await fetch("/api/sop/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department_id: deptId, label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRoleForm(deptId, { label: "", saving: false, error: null });
      onChanged();
    } catch (err) {
      setRoleForm(deptId, { error: err instanceof Error ? err.message : "Create failed", saving: false });
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-static"
        style={{
          width: "100%",
          maxWidth: 640,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 24,
          borderRadius: 12,
          background: "var(--bg-secondary)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>
            Taxonomy
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 0, marginBottom: 16 }}>
          Departments are top-level groupings. Roles live inside a department and let you tag SOPs with the specific positions they apply to.
        </p>

        {/* New department */}
        <div
          style={{
            padding: 12,
            border: "1px solid var(--border-primary)",
            borderRadius: 8,
            marginBottom: 20,
            background: "var(--bg-glass)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Add a department
          </div>
          {newDeptError && (
            <div style={{ fontSize: 12, color: "var(--danger)", marginBottom: 6 }}>{newDeptError}</div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="input-field"
              placeholder="Department name (e.g. Operations)"
              value={newDeptLabel}
              onChange={(e) => setNewDeptLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createDepartment(); }}
              style={{ flex: 1, fontSize: 13 }}
            />
            <button
              className="btn-primary"
              onClick={createDepartment}
              disabled={savingDept}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: savingDept ? 0.5 : 1 }}
            >
              <Plus size={13} /> Add
            </button>
          </div>
        </div>

        {/* Existing departments + per-dept role manager */}
        <div style={{ display: "grid", gap: 16 }}>
          {departments.map((d) => {
            const deptRoles = roles.filter((r) => r.department_id === d.id);
            const form = getRoleForm(d.id);
            return (
              <div
                key={d.id}
                style={{
                  padding: 12,
                  border: "1px solid var(--border-primary)",
                  borderRadius: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>{d.label}</strong>
                </div>
                {d.description && (
                  <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "4px 0 8px" }}>
                    {d.description}
                  </p>
                )}

                {/* Role chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {deptRoles.length === 0 && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                      No roles yet
                    </span>
                  )}
                  {deptRoles.map((r) => (
                    <span
                      key={r.id}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: "var(--bg-glass)",
                        color: "var(--text-secondary)",
                        border: "1px solid var(--border-primary)",
                      }}
                    >
                      {r.label}
                    </span>
                  ))}
                </div>

                {/* Add role form */}
                {form.error && (
                  <div style={{ fontSize: 11, color: "var(--danger)", marginBottom: 6 }}>{form.error}</div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="input-field"
                    placeholder="Role name (e.g. Closer)"
                    value={form.label}
                    onChange={(e) => setRoleForm(d.id, { label: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") createRole(d.id); }}
                    style={{ flex: 1, fontSize: 12 }}
                  />
                  <button
                    className="btn-secondary"
                    onClick={() => createRole(d.id)}
                    disabled={form.saving}
                    style={{ fontSize: 12, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 4, opacity: form.saving ? 0.5 : 1 }}
                  >
                    <Plus size={12} /> Add role
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
