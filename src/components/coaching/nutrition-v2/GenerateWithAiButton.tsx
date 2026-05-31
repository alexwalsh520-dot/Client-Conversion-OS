"use client";

/**
 * "Generate with AI" button for the Nutrition tab's Pending Meal Plans table.
 *
 * Replaces the manual workflow (open Claude.ai, paste the prompt, wait,
 * download PDF, upload to CCOS, post to Slack) with a single click that:
 *   1. POSTs to /api/nutrition/v2/admin/test-generate-plan?client_id=N
 *   2. Server returns immediately with a queued run ID
 *   3. Server-side background work runs (~3-5 min): gather → Claude →
 *      render PDF → upload to private bucket → DM Saeed with download
 *
 * Button states:
 *   - idle     → "Generate with AI"
 *   - queueing → "Queueing..." (disabled, brief)
 *   - queued   → "Queued · DM coming" (disabled, persists ~30s then resets)
 *   - error    → alert + back to idle
 *
 * Per-client state lives in this component; multiple pending rows each
 * have their own button + state, so coaches can fire several in a row.
 */

import { useState } from "react";
import { Sparkles, Loader2, Check } from "lucide-react";

interface Props {
  clientId: number;
}

type ButtonState = "idle" | "queueing" | "queued";

export default function GenerateWithAiButton({ clientId }: Props) {
  const [state, setState] = useState<ButtonState>("idle");

  const handleClick = async (e: React.MouseEvent) => {
    // Don't let the click bubble up and toggle the row's expand state.
    e.stopPropagation();
    if (state !== "idle") return;

    setState("queueing");
    try {
      const res = await fetch(
        `/api/nutrition/v2/admin/test-generate-plan?client_id=${clientId}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Couldn't queue: ${data.error || `HTTP ${res.status}`}`);
        setState("idle");
        return;
      }
      setState("queued");
      // Reset after 30s so the coach could re-fire if needed (e.g., if
      // the DM never arrived they'd want to try again).
      setTimeout(() => setState("idle"), 30_000);
    } catch (err) {
      alert(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setState("idle");
    }
  };

  const isBusy = state !== "idle";
  const label =
    state === "idle"
      ? "Generate with AI"
      : state === "queueing"
        ? "Queueing..."
        : "Queued · DM coming";

  const icon =
    state === "queueing" ? (
      <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
    ) : state === "queued" ? (
      <Check size={12} />
    ) : (
      <Sparkles size={12} />
    );

  return (
    <button
      onClick={handleClick}
      disabled={isBusy}
      title="Auto-generates the plan via Claude API + DMs you the PDF when ready. Same prompt logic as the manual Claude.ai flow."
      style={{
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--accent)",
        background: state === "queued" ? "var(--accent)" : "transparent",
        color: state === "queued" ? "var(--bg-primary)" : "var(--accent)",
        cursor: isBusy ? "default" : "pointer",
        fontSize: 11,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
        opacity: state === "queueing" ? 0.6 : 1,
        transition: "all 0.15s ease",
      }}
    >
      {icon}
      {label}
    </button>
  );
}
