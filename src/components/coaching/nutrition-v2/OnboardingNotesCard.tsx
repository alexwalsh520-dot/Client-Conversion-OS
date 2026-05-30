"use client";

/**
 * Onboarding Notes card — Nutrition v2.
 *
 * Lives between the IntakeFormCard and the "Generate the plan in
 * Claude.ai" block. Optional free-text from the onboarding specialist
 * for whoever authors the meal plan. Editable any time (not just at
 * plan-generation), and surfaces in the Claude.ai prompt.
 *
 * States:
 *   - loading       → spinner while GET is in flight
 *   - empty         → "+ Add onboarding notes" CTA
 *   - viewing       → notes text + last-updated metadata + Edit / Delete
 *   - editing       → textarea + Save / Cancel
 *
 * Storage: PUT/DELETE /api/nutrition/v2/client/:id/onboarding-notes.
 * On save/delete the prompt regeneration will automatically pick up
 * the new value the next time the coach clicks "Copy prompt".
 */

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Save, StickyNote, Trash2, X } from "lucide-react";

const MAX_LENGTH = 4000;
const ENDPOINT = (clientId: number) =>
  `/api/nutrition/v2/client/${clientId}/onboarding-notes`;

interface NotesPayload {
  notes: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface Props {
  clientId: number;
}

function formatUpdated(updatedAt: string | null, updatedBy: string | null): string {
  if (!updatedAt) return "";
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return "";
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return updatedBy ? `Updated ${dateStr} by ${updatedBy}` : `Updated ${dateStr}`;
}

export default function OnboardingNotesCard({ clientId }: Props) {
  const [payload, setPayload] = useState<NotesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Load on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(ENDPOINT(clientId));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as NotesPayload;
        if (!cancelled) setPayload(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "load failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const startEdit = () => {
    setDraft(payload?.notes ?? "");
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft("");
    setError(null);
  };

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Notes can't be empty. Use the delete button to clear.");
      return;
    }
    if (trimmed.length > MAX_LENGTH) {
      setError(`Notes too long (max ${MAX_LENGTH} chars).`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(ENDPOINT(clientId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as NotesPayload;
      setPayload(data);
      setEditing(false);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete the onboarding notes for this client?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(ENDPOINT(clientId), { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setPayload({ notes: null, updatedAt: null, updatedBy: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setSaving(false);
    }
  };

  // Card wrapper styling mirrors IntakeFormCard so the surfaces match.
  const cardStyle: React.CSSProperties = {
    marginBottom: 14,
    padding: 12,
    background: "var(--hover-bg-subtle)",
    border: "1px solid var(--border-primary)",
    borderRadius: 8,
  };

  const headerRow = (right: React.ReactNode) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-primary)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <StickyNote size={14} style={{ color: "var(--accent)" }} />
        Onboarding notes
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400, marginLeft: 4 }}>
          (optional — included in the Claude.ai prompt)
        </span>
      </div>
      {right}
    </div>
  );

  if (loading) {
    return (
      <div style={cardStyle}>
        {headerRow(null)}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
          <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
          Loading…
        </div>
      </div>
    );
  }

  // Editing mode (used for both add and edit)
  if (editing) {
    return (
      <div style={cardStyle}>
        {headerRow(
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={cancelEdit}
              disabled={saving}
              style={iconBtnStyle}
              title="Cancel"
            >
              <X size={14} />
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                ...iconBtnStyle,
                background: "var(--accent)",
                color: "var(--bg-primary)",
                borderColor: "var(--accent)",
              }}
              title="Save"
            >
              {saving ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} />}
            </button>
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Anything the meal plan author should know. e.g. 'Wife has health-related dietary needs; avoid avocados and similar high-fat foods so meals work for both.'"
          maxLength={MAX_LENGTH}
          rows={5}
          style={{
            width: "100%",
            background: "var(--bg-card)",
            border: "1px solid var(--border-primary)",
            borderRadius: 6,
            padding: "8px 10px",
            color: "var(--text-primary)",
            fontSize: 13,
            lineHeight: 1.6,
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            fontSize: 10,
            color: "var(--text-muted)",
          }}
        >
          <span>{draft.length} / {MAX_LENGTH}</span>
          {error && <span style={{ color: "var(--danger)" }}>{error}</span>}
        </div>
      </div>
    );
  }

  // Empty state
  if (!payload?.notes) {
    return (
      <div style={cardStyle}>
        {headerRow(null)}
        <button
          onClick={startEdit}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            background: "transparent",
            border: "1px dashed var(--border-primary)",
            borderRadius: 6,
            color: "var(--text-secondary)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <Plus size={12} />
          Add onboarding notes
        </button>
        {error && (
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--danger)" }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // Viewing mode
  return (
    <div style={cardStyle}>
      {headerRow(
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={startEdit} style={iconBtnStyle} title="Edit">
            <Pencil size={13} />
          </button>
          <button
            onClick={handleDelete}
            disabled={saving}
            style={{ ...iconBtnStyle, color: "var(--danger)" }}
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
      <div
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          padding: "8px 10px",
          borderLeft: "2px solid var(--accent)",
          background: "var(--hover-bg-subtle)",
          borderRadius: "0 6px 6px 0",
        }}
      >
        {payload.notes}
      </div>
      {(payload.updatedAt || payload.updatedBy) && (
        <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-muted)" }}>
          {formatUpdated(payload.updatedAt, payload.updatedBy)}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--danger)" }}>
          {error}
        </div>
      )}
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "5px 8px",
  background: "transparent",
  border: "1px solid var(--border-primary)",
  borderRadius: 6,
  color: "var(--text-secondary)",
  fontSize: 12,
  cursor: "pointer",
};
