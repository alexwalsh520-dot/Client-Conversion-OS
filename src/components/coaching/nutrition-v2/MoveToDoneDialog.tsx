/**
 * Coach UI v2 — Move to Done dialog. Reuses the existing
 * POST /api/nutrition/complete endpoint with its 3-checkbox checklist.
 *
 * Inline within the panel (not a real modal — keeps the kanban single-flow).
 */

"use client";

import React, { useState } from "react";
import { CheckCircle } from "lucide-react";

interface MoveToDoneDialogProps {
  clientId: number;
  onComplete: () => void;
  onCancel: () => void;
  /** When true, hides the checklist and just confirms manual completion. */
  manualMode?: boolean;
}

export function MoveToDoneDialog({
  clientId,
  onComplete,
  onCancel,
  manualMode = false,
}: MoveToDoneDialogProps) {
  const [allergies, setAllergies] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const [tipsReviewed, setTipsReviewed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = manualMode || (allergies && delivered && tipsReviewed);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/nutrition/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          checklist: {
            allergies: manualMode ? true : allergies,
            delivered: manualMode ? true : delivered,
            tipsReviewed: manualMode ? true : tipsReviewed,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "complete failed");
      }
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        background: "rgba(34, 197, 94, 0.05)",
        border: "1px solid rgba(34, 197, 94, 0.25)",
        borderRadius: 6,
        padding: 12,
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--success, #22c55e)",
          fontWeight: 600,
          fontSize: 13,
          marginBottom: 10,
        }}
      >
        <CheckCircle size={14} />
        {manualMode ? "Mark Done (manual)" : "Move to Done"}
      </div>

      {!manualMode && (
        <div style={{ display: "grid", gap: 6, fontSize: 12, marginBottom: 10 }}>
          <label style={{ display: "flex", gap: 6, color: "var(--text-primary)" }}>
            <input
              type="checkbox"
              checked={allergies}
              onChange={(e) => setAllergies(e.target.checked)}
            />
            Allergies / dietary restrictions confirmed against intake
          </label>
          <label style={{ display: "flex", gap: 6, color: "var(--text-primary)" }}>
            <input
              type="checkbox"
              checked={delivered}
              onChange={(e) => setDelivered(e.target.checked)}
            />
            Plan delivered to client
          </label>
          <label style={{ display: "flex", gap: 6, color: "var(--text-primary)" }}>
            <input
              type="checkbox"
              checked={tipsReviewed}
              onChange={(e) => setTipsReviewed(e.target.checked)}
            />
            Tips / medical notes reviewed with client
          </label>
        </div>
      )}

      {manualMode && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
          This client will be marked as done with no automated PDF on record.
          The Done column will show a &quot;manual&quot; badge for the latest plan.
        </div>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={handleSubmit}
          disabled={!allChecked || submitting}
          style={{
            padding: "6px 14px",
            background: allChecked && !submitting ? "var(--success, #22c55e)" : "rgba(34,197,94,0.4)",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: allChecked && !submitting ? "pointer" : "not-allowed",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {submitting ? "Saving…" : "Confirm — Move to Done"}
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            padding: "6px 14px",
            background: "none",
            color: "var(--text-muted)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--danger, #ef4444)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
