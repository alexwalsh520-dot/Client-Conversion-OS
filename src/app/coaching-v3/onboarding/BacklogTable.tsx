"use client";

/**
 * V3 · Onboarding backlog tracker.
 *
 * Same shape as legacy `OnboardingBacklogTable`: 10 free-text columns,
 * inline-editable, autosaves on blur, small ✓ flash on success.
 *
 * Difference from legacy: initial rows and canEdit come from the parent
 * (V3 page already loaded them server-side), so no cold-start fetch here.
 * Add / delete / patch still hit /api/coaching/onboarding-backlog until
 * Phase 6 moves that endpoint into the V3 namespace.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, Check } from "lucide-react";

export type BacklogRow = {
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
};

const COLUMNS: Array<{ key: keyof BacklogRow; label: string; width: number; multiline?: boolean }> = [
  { key: "onboarder", label: "Onboarder", width: 100 },
  { key: "onboardee", label: "Onboardee", width: 140 },
  { key: "email", label: "Email", width: 200 },
  { key: "closer", label: "Closer", width: 90 },
  { key: "amount_paid", label: "Amount Paid", width: 100 },
  { key: "pif_status", label: "PIF?", width: 120 },
  { key: "reschedule_email", label: "Reschedule Email?", width: 130 },
  { key: "reminder_email", label: "Reminder Email?", width: 130 },
  { key: "closer_reachout", label: "Reach out with Closer", width: 140 },
  { key: "comments", label: "Comments", width: 260, multiline: true },
];

type SortDir = "asc" | "desc" | null;

export default function BacklogTable({
  initialRows,
  canEdit,
}: {
  initialRows: BacklogRow[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<BacklogRow[]>(initialRows);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [onboarderFilter, setOnboarderFilter] = useState("all");
  const [sortKey, setSortKey] = useState<keyof BacklogRow | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const onboarderOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const v = (r.onboarder ?? "").trim();
      if (v) s.add(v);
    }
    return [...s].sort();
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

  const cycleSort = (k: keyof BacklogRow) => {
    if (sortKey !== k) {
      setSortKey(k);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir(null);
    }
  };

  const handleAdd = async () => {
    if (!canEdit) return;
    setAdding(true);
    setErr(null);
    try {
      const res = await fetch("/api/coaching/onboarding-backlog", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows((prev) => [...prev, data.row as BacklogRow]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!canEdit) return;
    if (!confirm("Delete this row? This cannot be undone.")) return;
    const prev = rows;
    setRows((r) => r.filter((row) => row.id !== id));
    try {
      const res = await fetch(`/api/coaching/onboarding-backlog/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows(prev);
    }
  };

  const handleSave = useCallback(async (id: number, field: keyof BacklogRow, value: string) => {
    const res = await fetch(`/api/coaching/onboarding-backlog/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const updated = data.row as BacklogRow;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
  }, []);

  return (
    <div>
      <div style={{ padding: "10px 14px 0", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Onboarder:
          <select
            value={onboarderFilter}
            onChange={(e) => setOnboarderFilter(e.target.value)}
            style={{
              marginLeft: 6,
              padding: "3px 8px",
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-primary)",
              borderRadius: 4,
              fontSize: 11,
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
            className="h3-btn"
            onClick={() => {
              setSortKey(null);
              setSortDir(null);
            }}
          >
            Clear sort
          </button>
        )}
        {!canEdit && (
          <span
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)" }}
          >
            view only
          </span>
        )}
      </div>

      {err && (
        <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--danger)" }}>{err}</div>
      )}

      <div style={{ overflowX: "auto", maxHeight: 640, marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--bg-secondary)", zIndex: 1 }}>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => cycleSort(col.key)}
                  style={{
                    minWidth: col.width,
                    padding: "8px 10px",
                    textAlign: "left",
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                    cursor: "pointer",
                    userSelect: "none",
                    borderBottom: "1px solid var(--border-primary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {col.label}
                    {sortKey === col.key &&
                      (sortDir === "asc" ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                  </span>
                </th>
              ))}
              {canEdit && (
                <th style={{ width: 40, borderBottom: "1px solid var(--border-primary)" }} />
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
                    ? canEdit
                      ? "No backlog rows yet. Click Add Row to start."
                      : "Nothing in the backlog."
                    : "No rows match the current filter."}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <Row key={row.id} row={row} canEdit={canEdit} onSave={handleSave} onDelete={handleDelete} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div style={{ padding: "10px 14px" }}>
          <button className="h3-btn p" onClick={handleAdd} disabled={adding}>
            <Plus size={12} /> {adding ? "Adding…" : "Add row"}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({
  row,
  canEdit,
  onSave,
  onDelete,
}: {
  row: BacklogRow;
  canEdit: boolean;
  onSave: (id: number, field: keyof BacklogRow, value: string) => Promise<void>;
  onDelete: (id: number) => void;
}) {
  return (
    <tr>
      {COLUMNS.map((col) => (
        <td
          key={col.key}
          style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-primary)", verticalAlign: "top" }}
        >
          <EditableCell
            value={(row[col.key] ?? "").toString()}
            editable={canEdit}
            multiline={Boolean(col.multiline)}
            onSave={(v) => onSave(row.id, col.key, v)}
          />
        </td>
      ))}
      {canEdit && (
        <td
          style={{
            padding: "4px 8px",
            textAlign: "center",
            borderBottom: "1px solid var(--border-primary)",
            verticalAlign: "top",
          }}
        >
          <button
            onClick={() => onDelete(row.id)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
              display: "inline-flex",
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

function EditableCell({
  value,
  editable,
  multiline,
  onSave,
}: {
  value: string;
  editable: boolean;
  multiline: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [errored, setErrored] = useState(false);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => {
    if (tRef.current) clearTimeout(tRef.current);
  }, []);

  const commit = useCallback(async () => {
    if (draft === value) return;
    setSaving(true);
    setErrored(false);
    try {
      await onSave(draft);
      setSavedAt(Date.now());
      if (tRef.current) clearTimeout(tRef.current);
      tRef.current = setTimeout(() => setSavedAt(null), 1200);
    } catch {
      setErrored(true);
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }, [draft, value, onSave]);

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

  const baseStyle: React.CSSProperties = {
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
    minHeight: multiline ? 44 : 22,
    resize: multiline ? "vertical" : "none",
    outline: "none",
    transition: "background 200ms",
  };

  return (
    <div style={{ position: "relative" }}>
      {multiline ? (
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          disabled={saving}
          style={baseStyle}
        />
      ) : (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          disabled={saving}
          style={baseStyle}
        />
      )}
      {savedAt && (
        <span style={{ position: "absolute", top: 4, right: 4, color: "var(--success)", pointerEvents: "none" }}>
          <Check size={10} />
        </span>
      )}
    </div>
  );
}
