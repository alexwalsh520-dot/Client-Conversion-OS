/**
 * Nicole's onboarding backlog tracker — standalone, spreadsheet-like table.
 *
 * Lives in the Coaching Hub → Onboarding tab, above "Upcoming Onboardings."
 * Mirrors Nicole's Google Sheet 1-for-1: 10 free-text columns, editable
 * inline, autosave on blur. Nicole + admins can edit; other coaches can
 * view only.
 *
 * No joins to clients — it's a personal working log.
 */

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Check,
  ClipboardList,
  Loader2,
} from "lucide-react";

interface BacklogRow {
  id: number;
  onboarder: string;
  onboardee: string;
  email: string;
  closer: string;
  amount_paid: string;
  pif_status: string;
  reschedule_email: string;
  reminder_email: string;
  closer_reachout: string;
  comments: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

const COLUMNS: Array<{
  key: keyof BacklogRow;
  label: string;
  width: number;
  multiline?: boolean;
}> = [
  { key: "onboarder", label: "Onboarder", width: 100 },
  { key: "onboardee", label: "Onboardee", width: 140 },
  { key: "email", label: "Email", width: 200 },
  { key: "closer", label: "Closer", width: 90 },
  { key: "amount_paid", label: "Amount Paid", width: 100 },
  { key: "pif_status", label: "PIF?", width: 140 },
  { key: "reschedule_email", label: "Reschedule Email sent?", width: 140 },
  { key: "reminder_email", label: "Reminder Email?", width: 140 },
  { key: "closer_reachout", label: "Reach out with Closer", width: 140 },
  { key: "comments", label: "Comments", width: 260, multiline: true },
];

const INSTRUCTIONAL_BANNER =
  "We'll reach out with Tyson's account if we do not hear from them after the reminder email. Make sure you add the date for when you sent the original reschedule email and for the follow up email in. Make sure to check your calendar before sending them the reminder.";

type SortDir = "asc" | "desc" | null;

export default function OnboardingBacklogTable() {
  const [rows, setRows] = useState<BacklogRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addingRow, setAddingRow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [onboarderFilter, setOnboarderFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<keyof BacklogRow | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/coaching/onboarding-backlog");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setRows((data.rows as BacklogRow[]) ?? []);
        setCanEdit(Boolean(data.can_edit));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Onboarder filter options — union of canonical names + anything already
  // in the data (so old/legacy names don't disappear silently).
  const onboarderOptions = useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) {
      const v = (r.onboarder ?? "").trim();
      if (v) names.add(v);
    }
    return Array.from(names).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (onboarderFilter !== "all") {
      out = out.filter((r) => (r.onboarder ?? "").trim() === onboarderFilter);
    }
    if (sortKey && sortDir) {
      out = [...out].sort((a, b) => {
        const av = String(a[sortKey] ?? "").toLowerCase();
        const bv = String(b[sortKey] ?? "").toLowerCase();
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }
    return out;
  }, [rows, onboarderFilter, sortKey, sortDir]);

  const cycleSort = (key: keyof BacklogRow) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir(null);
    }
  };

  const handleAddRow = async () => {
    if (!canEdit) return;
    setAddingRow(true);
    try {
      const res = await fetch("/api/coaching/onboarding-backlog", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows((prev) => [...prev, data.row as BacklogRow]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingRow(false);
    }
  };

  const handleDeleteRow = async (id: number) => {
    if (!canEdit) return;
    if (!confirm("Delete this row? This cannot be undone.")) return;
    // Optimistic remove
    const prev = rows;
    setRows((r) => r.filter((row) => row.id !== id));
    try {
      const res = await fetch(`/api/coaching/onboarding-backlog/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows(prev); // revert
    }
  };

  const handleFieldSave = useCallback(
    async (id: number, field: keyof BacklogRow, value: string) => {
      // Server-side reflect. Optimistic UI already happened via local state.
      const res = await fetch(`/api/coaching/onboarding-backlog/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      // Response includes updated row; take its updated_at to keep in sync.
      const data = await res.json();
      const updated = data.row as BacklogRow;
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...updated } : r)),
      );
    },
    [],
  );

  if (loading) {
    return (
      <div style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
          <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
          Loading onboarding backlog…
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      <h2 className="section-title" style={{ marginBottom: 12 }}>
        <ClipboardList size={16} />
        Onboarding Backlog
        {!canEdit && (
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              color: "var(--text-muted)",
              fontWeight: 400,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            (view only)
          </span>
        )}
      </h2>

      {/* Instructional banner */}
      <div
        style={{
          padding: "10px 12px",
          background: "rgba(255, 179, 71, 0.08)",
          border: "1px solid rgba(255, 179, 71, 0.25)",
          borderRadius: 6,
          fontSize: 12,
          color: "var(--text-muted)",
          marginBottom: 12,
          lineHeight: 1.5,
        }}
      >
        {INSTRUCTIONAL_BANNER}
      </div>

      {/* Controls: filter + row count */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Onboarder:
          <select
            value={onboarderFilter}
            onChange={(e) => setOnboarderFilter(e.target.value)}
            style={{
              marginLeft: 6,
              padding: "3px 8px",
              background: "rgba(0,0,0,0.4)",
              color: "var(--text-primary)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            <option value="all">All ({rows.length})</option>
            {onboarderOptions.map((n) => (
              <option key={n} value={n}>
                {n} ({rows.filter((r) => (r.onboarder ?? "").trim() === n).length})
              </option>
            ))}
          </select>
        </label>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Showing {filtered.length} of {rows.length}
        </span>
        {sortKey && (
          <button
            onClick={() => {
              setSortKey(null);
              setSortDir(null);
            }}
            style={{
              fontSize: 11,
              padding: "2px 8px",
              background: "none",
              color: "var(--text-muted)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Clear sort
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: 8, fontSize: 11, color: "var(--danger, #ef4444)", marginBottom: 8 }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div
        className="glass-static"
        style={{
          overflow: "auto",
          maxHeight: 640,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead
            style={{
              position: "sticky",
              top: 0,
              background: "var(--bg-secondary, rgba(20,20,20,0.95))",
              zIndex: 1,
            }}
          >
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => cycleSort(col.key)}
                  style={{
                    minWidth: col.width,
                    padding: "8px 10px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                    cursor: "pointer",
                    userSelect: "none",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {col.label}
                    {sortKey === col.key && (
                      sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                    )}
                  </span>
                </th>
              ))}
              {canEdit && (
                <th style={{ width: 40, padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)" }} />
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length + (canEdit ? 1 : 0)}
                  style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}
                >
                  {rows.length === 0
                    ? "No backlog rows yet. Click Add Row to start."
                    : "No rows match the current filter."}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <BacklogTableRow
                  key={row.id}
                  row={row}
                  canEdit={canEdit}
                  onSave={handleFieldSave}
                  onDelete={handleDeleteRow}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div style={{ marginTop: 10 }}>
          <button
            onClick={handleAddRow}
            disabled={addingRow}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              background: "var(--accent, #6366f1)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: addingRow ? "wait" : "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Plus size={12} /> {addingRow ? "Adding…" : "Add Row"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row component — one <tr> with inline-editable cells
// ---------------------------------------------------------------------------

interface BacklogTableRowProps {
  row: BacklogRow;
  canEdit: boolean;
  onSave: (id: number, field: keyof BacklogRow, value: string) => Promise<void>;
  onDelete: (id: number) => void;
}

function BacklogTableRow({ row, canEdit, onSave, onDelete }: BacklogTableRowProps) {
  return (
    <tr>
      {COLUMNS.map((col) => (
        <td
          key={col.key}
          style={{
            padding: "4px 8px",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            verticalAlign: "top",
          }}
        >
          <EditableCell
            value={(row[col.key] ?? "").toString()}
            editable={canEdit}
            multiline={Boolean(col.multiline)}
            onSave={(value) => onSave(row.id, col.key, value)}
          />
        </td>
      ))}
      {canEdit && (
        <td style={{ padding: "4px 8px", verticalAlign: "top", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <button
            onClick={() => onDelete(row.id)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
              display: "inline-flex",
              alignItems: "center",
            }}
            title="Delete row"
          >
            <Trash2 size={12} />
          </button>
        </td>
      )}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Editable cell — click to edit, save on blur, ✓ flash on success
// ---------------------------------------------------------------------------

interface EditableCellProps {
  value: string;
  editable: boolean;
  multiline: boolean;
  onSave: (value: string) => Promise<void>;
}

function EditableCell({ value, editable, multiline, onSave }: EditableCellProps) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [errored, setErrored] = useState(false);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // If the row was updated by another edit path, sync down.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = useCallback(async () => {
    if (draft === value) return;
    setSaving(true);
    setErrored(false);
    try {
      await onSave(draft);
      setSavedAt(Date.now());
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = setTimeout(() => setSavedAt(null), 1200);
    } catch {
      setErrored(true);
      // Revert visual state on error
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }, [draft, value, onSave]);

  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  if (!editable) {
    return (
      <div
        style={{
          minHeight: 22,
          padding: "3px 4px",
          fontSize: 12,
          color: value ? "var(--text-primary)" : "var(--text-muted)",
          whiteSpace: multiline ? "pre-wrap" : "normal",
          wordBreak: "break-word",
        }}
      >
        {value || "—"}
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "3px 4px",
    fontSize: 12,
    fontFamily: "inherit",
    background: errored
      ? "rgba(239,68,68,0.1)"
      : savedAt
        ? "rgba(34,197,94,0.08)"
        : "transparent",
    color: "var(--text-primary)",
    border: "1px solid transparent",
    borderRadius: 3,
    boxSizing: "border-box",
    resize: multiline ? "vertical" : "none",
    minHeight: multiline ? 44 : 22,
    outline: "none",
    transition: "background 200ms",
  };

  const commonProps = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!multiline && e.key === "Enter") {
        (e.target as HTMLElement).blur();
      }
    },
    disabled: saving,
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      (e.target as HTMLInputElement | HTMLTextAreaElement).style.border =
        "1px solid rgba(99,102,241,0.4)";
    },
    onBlurCapture: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      (e.target as HTMLInputElement | HTMLTextAreaElement).style.border =
        "1px solid transparent";
    },
    style: inputStyle,
  };

  return (
    <div style={{ position: "relative" }}>
      {multiline ? (
        <textarea {...commonProps} rows={2} />
      ) : (
        <input type="text" {...commonProps} />
      )}
      {savedAt && (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            color: "var(--success, #22c55e)",
            pointerEvents: "none",
          }}
        >
          <Check size={10} />
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper style
// ---------------------------------------------------------------------------

const sectionStyle: React.CSSProperties = {
  marginBottom: 24,
  padding: 16,
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 8,
};
