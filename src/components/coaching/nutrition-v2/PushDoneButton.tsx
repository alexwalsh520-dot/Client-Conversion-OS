"use client";

/**
 * Admin-only "Push Done" button for pending meal plan rows.
 *
 * Bypasses the 3-checkbox checklist and the PDF-upload requirement —
 * force-flips the client's nutrition_status to "done" so the row
 * drops out of the Pending Meal Plans table. Useful for plans
 * delivered out-of-band, stale legacy tasks, or anywhere the normal
 * upload+checklist workflow doesn't apply.
 *
 * Confirmation prompt before fire, since this is destructive (in the
 * sense that you lose the pending-task signal). On success, calls
 * onDone() so the parent refreshes the client list and the row
 * disappears.
 *
 * Server-side: /api/nutrition/v2/client/:id/push-done — admin role
 * check; non-admins get 403.
 */

import { useState } from "react";
import { CheckCircle, Loader2, FastForward } from "lucide-react";

interface Props {
  clientId: number;
  clientName: string;
  /** Called after a successful push-done so the parent can refetch
   *  the clients list and remove the row from Pending. */
  onDone?: () => void;
}

type ButtonState = "idle" | "pushing" | "done";

export default function PushDoneButton({ clientId, clientName, onDone }: Props) {
  const [state, setState] = useState<ButtonState>("idle");

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state !== "idle") return;

    const ok = confirm(
      `Push "${clientName}"'s meal plan task to done without uploading a PDF or completing the checklist?\n\nUse this only when the plan was delivered outside CCOS, or for stale legacy tasks. The row will disappear from Pending.`,
    );
    if (!ok) return;

    setState("pushing");
    try {
      const res = await fetch(
        `/api/nutrition/v2/client/${clientId}/push-done`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Push Done failed: ${data.error || `HTTP ${res.status}`}`);
        setState("idle");
        return;
      }
      setState("done");
      // Briefly show "Done" then refresh the parent so the row
      // disappears. Refresh is what actually removes the row; the
      // local "done" state is mostly cosmetic confirmation.
      setTimeout(() => {
        onDone?.();
        // Don't reset to idle — the row is going away anyway.
      }, 800);
    } catch (err) {
      alert(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setState("idle");
    }
  };

  const isBusy = state !== "idle";
  const label =
    state === "idle" ? "Push Done" : state === "pushing" ? "Pushing..." : "Done ✓";

  const icon =
    state === "pushing" ? (
      <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
    ) : state === "done" ? (
      <CheckCircle size={12} />
    ) : (
      <FastForward size={12} />
    );

  return (
    <button
      onClick={handleClick}
      disabled={isBusy}
      title="Admin override: marks the meal plan task as done without uploading a PDF or running the checklist. For out-of-band deliveries and stale legacy tasks."
      style={{
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--success)",
        background: state === "done" ? "var(--success)" : "transparent",
        color: state === "done" ? "var(--bg-primary)" : "var(--success)",
        cursor: isBusy ? "default" : "pointer",
        fontSize: 11,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
        opacity: state === "pushing" ? 0.6 : 1,
        transition: "all 0.15s ease",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
