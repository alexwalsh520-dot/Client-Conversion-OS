"use client";

/**
 * "Batch Generate with AI" button for the Pending Meal Plans section.
 *
 * One click → fires AI generation for every pending plan whose client
 * is on day 4 or beyond. Each plan runs in its own background lambda
 * (same as the per-row button), so the coach gets a separate Slack DM
 * per plan as each one finishes (~3-5 min each, all roughly in parallel).
 *
 * Eligibility filter is day >= 4 because Saeed wants a small buffer
 * before the auto-trigger fires (a brand-new onboarding shouldn't
 * generate a plan within the first 3 days while the onboarding
 * specialist is still finalizing notes).
 *
 * Confirmation prompt shows the count + a rough cost estimate so the
 * coach doesn't accidentally fire 20 plans worth of Claude API calls.
 *
 * Implementation: pure client-side parallel fetch() to the existing
 * per-client test-generate-plan endpoint. No new backend needed; the
 * server queues each request independently into its own
 * nutrition_pipeline_runs row.
 */

import { useState } from "react";
import { Sparkles, Loader2, Check } from "lucide-react";

interface PendingClient {
  id: number;
  name: string;
  daysSinceOnboarding: number;
}

interface Props {
  pendingClients: PendingClient[];
  /** Optional override; default is day 4+ per product spec. */
  minDays?: number;
}

type ButtonState = "idle" | "queueing" | "done";

const DEFAULT_MIN_DAYS = 4;

export default function BatchGenerateWithAiButton({
  pendingClients,
  minDays = DEFAULT_MIN_DAYS,
}: Props) {
  const [state, setState] = useState<ButtonState>("idle");
  const [queuedCount, setQueuedCount] = useState(0);

  const eligible = pendingClients.filter(
    (c) => c.daysSinceOnboarding >= minDays,
  );

  const handleClick = async () => {
    if (state !== "idle") return;
    if (eligible.length === 0) return;

    const ok = confirm(
      `Generate AI plans for ${eligible.length} client${eligible.length === 1 ? "" : "s"} (day ${minDays}+)? Each plan is one Claude API call (~$0.30 per plan). You'll get one Slack DM per finished plan in the next 3-5 minutes.`,
    );
    if (!ok) return;

    setState("queueing");
    let successes = 0;
    // Fire all in parallel — the browser caps concurrent connections
    // per host (~6 in Chrome) but each request returns in ~1-2s, so
    // even 20 fire in well under 10 seconds total.
    await Promise.allSettled(
      eligible.map(async (c) => {
        try {
          const res = await fetch(
            `/api/nutrition/v2/admin/test-generate-plan?client_id=${c.id}`,
          );
          if (res.ok) successes++;
        } catch {
          // ignore — failed-to-queue rows are reported by their per-row
          // button next time the coach interacts
        }
      }),
    );
    setQueuedCount(successes);
    setState("done");

    // Hold the "done" message a bit longer than the per-row button so
    // the coach can see how many actually went through.
    setTimeout(() => setState("idle"), 60_000);
  };

  if (eligible.length === 0 && state === "idle") {
    return null;
  }

  const isBusy = state !== "idle";
  const label =
    state === "idle"
      ? `Batch generate ${eligible.length} (day ${minDays}+)`
      : state === "queueing"
        ? `Queueing ${eligible.length}...`
        : `Queued ${queuedCount} plan${queuedCount === 1 ? "" : "s"} · DMs coming`;

  const icon =
    state === "queueing" ? (
      <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
    ) : state === "done" ? (
      <Check size={13} />
    ) : (
      <Sparkles size={13} />
    );

  return (
    <button
      onClick={handleClick}
      disabled={isBusy}
      title={`Auto-generates plans for all pending clients on day ${minDays} or beyond. Each runs in its own background job; you get one Slack DM per finished plan.`}
      style={{
        padding: "6px 14px",
        borderRadius: 6,
        border: "1px solid var(--accent)",
        background: state === "done" ? "var(--accent)" : "transparent",
        color: state === "done" ? "var(--bg-primary)" : "var(--accent)",
        cursor: isBusy ? "default" : "pointer",
        fontSize: 12,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
        opacity: state === "queueing" ? 0.6 : 1,
        transition: "all 0.15s ease",
        marginLeft: 12,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
